import csv
import io
import json
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from openpyxl import Workbook
from sqlalchemy.orm import Session

from app.application.batches import (
    batch_read,
    classification_batch_read,
    required_field_batch_read,
    table_extraction_batch_read,
)
from app.application.definitions import checklist_data, schema_definition_data
from app.application.table_exports import PageSource, TableExportCollector, effective_tables, job_definition
from app.application.uploads import sorted_batch_items, sorted_module_items
from app.audit import log_audit_event
from app.core.errors import ConflictError, NotFoundError, UnprocessableError, ensure_found
from app.domain.status import ExportJobStatus
from app.domain.table_spec import TableTemplateDefinition, load_definition, select_tables
from app.models import (
    Batch,
    BatchItem,
    ClassificationBatch,
    ClassificationBatchItem,
    DocumentClassifier,
    ExportJob,
    ExportPreset,
    ExtractionJob,
    ExtractionResult,
    RequiredFieldCheckBatch,
    RequiredFieldCheckBatchItem,
    RequiredFieldChecklist,
    Schema,
    TableExtractionBatch,
    TableExtractionJob,
    TableTemplate,
    WorkflowRun,
)
from app.schemas import (
    ExportJobRead,
    ExportPresetCreate,
    ExportPresetRead,
    ExportPresetUpdate,
)
from app.workflows import (
    workflow_run_export_bundle,
    workflow_run_export_csv,
)

EXPORT_JOB_OWNER_TYPES = {"workflow_run", "batch", "classification_batch", "required_field_check_batch", "table_extraction_batch"}
ZIP_MIME_TYPE = "application/zip"


XLSX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@dataclass(frozen=True)
class ExportArtifact:
    content: bytes
    filename: str
    content_type: str


def extract_kie_cell_value(value: Any) -> Any:
    return value.get("value") if isinstance(value, dict) else value


def _add_kie_review_export_columns(
    row: dict[str, Any],
    column_prefix: str,
    value: Any,
    original_value: Any = None,
    reviewed_fields: set[str] | None = None,
    field_name: str | None = None,
) -> None:
    value_dict = value if isinstance(value, dict) else {}
    ai_review = value_dict.get("ai_review") if isinstance(value_dict.get("ai_review"), dict) else {}
    current = extract_kie_cell_value(value)
    original = extract_kie_cell_value(original_value) if original_value is not None else current
    row[column_prefix] = current
    row[f"{column_prefix}_original"] = original
    row[f"{column_prefix}_changed"] = current != original
    row[f"{column_prefix}_reviewed"] = field_name in reviewed_fields if reviewed_fields is not None and field_name else False
    row[f"{column_prefix}_warnings"] = value_dict.get("warnings", [])
    row[f"{column_prefix}_ai_review_enabled"] = bool(ai_review.get("enabled"))
    row[f"{column_prefix}_ai_review_status"] = ai_review.get("judgement_status")
    row[f"{column_prefix}_ai_corrected"] = bool(ai_review.get("corrected"))
    row[f"{column_prefix}_ai_review_reason"] = ai_review.get("judgement_reason")
    row[f"{column_prefix}_ai_review_confidence"] = ai_review.get("judgement_confidence")
    row[f"{column_prefix}_ai_initial_value"] = ai_review.get("initial_value")
    row[f"{column_prefix}_ai_initial_evidence"] = ai_review.get("initial_evidence")
    row[f"{column_prefix}_ai_correction_reason"] = ai_review.get("correction_reason")


def _kie_export_columns(field_name: str) -> list[str]:
    return [
        field_name,
        f"{field_name}_original",
        f"{field_name}_changed",
        f"{field_name}_reviewed",
        f"{field_name}_warnings",
        f"{field_name}_ai_review_enabled",
        f"{field_name}_ai_review_status",
        f"{field_name}_ai_corrected",
        f"{field_name}_ai_review_reason",
        f"{field_name}_ai_review_confidence",
        f"{field_name}_ai_initial_value",
        f"{field_name}_ai_initial_evidence",
        f"{field_name}_ai_correction_reason",
    ]


def _batch_export_row(item: BatchItem, field_names: list[str]) -> dict[str, Any]:
    job = item.job
    row: dict[str, Any] = {
        "filename": item.filename,
        "page_number": item.page_number,
        "document_id": item.document_id,
        "job_id": item.job_id,
        "status": job.status if job else "unknown",
        "error_message": job.error_message if job else None,
        "warnings": [],
    }
    for field_name in field_names:
        row[field_name] = None
    if not job or not job.result:
        return row

    output = job.result.corrected_output if job.result.corrected_output is not None else job.result.validated_output
    original_output = job.result.validated_output
    reviewed_fields = set(job.result.reviewed_fields or [])
    values = output.get("values", {})
    original_values = original_output.get("values", {}) if isinstance(original_output.get("values"), dict) else {}
    warnings: list[str] = []
    for field_name in field_names:
        value = values.get(field_name)
        if isinstance(value, dict):
            _add_kie_review_export_columns(row, field_name, value, original_values.get(field_name), reviewed_fields, field_name)
            warnings.extend(str(warning) for warning in value.get("warnings", []))
        else:
            _add_kie_review_export_columns(row, field_name, value, original_values.get(field_name), reviewed_fields, field_name)
    row["warnings"] = warnings
    return row


def _classification_batch_export_row(item: ClassificationBatchItem) -> dict[str, Any]:
    job = item.job
    row: dict[str, Any] = {
        "filename": item.filename,
        "page_number": item.page_number,
        "document_id": item.document_id,
        "job_id": item.job_id,
        "status": job.status if job else "unknown",
        "error_message": job.error_message if job else None,
        "classification_status": None,
        "class_name": None,
        "confidence": None,
        "reason": None,
        "evidence": [],
    }
    if not job or not job.result:
        return row
    output = job.result.corrected_output if job.result.corrected_output is not None else job.result.validated_output
    row["classification_status"] = output.get("status")
    row["class_name"] = output.get("class_name")
    row["confidence"] = output.get("confidence")
    row["reason"] = output.get("reason")
    row["evidence"] = output.get("evidence") if isinstance(output.get("evidence"), list) else []
    return row


def _required_field_batch_export_row(item: RequiredFieldCheckBatchItem, item_names: list[str]) -> dict[str, Any]:
    job = item.job
    row: dict[str, Any] = {
        "filename": item.filename,
        "page_number": item.page_number,
        "document_id": item.document_id,
        "job_id": item.job_id,
        "status": job.status if job else "unknown",
        "error_message": job.error_message if job else None,
        "overall_status": None,
    }
    for item_name in item_names:
        row[f"{item_name}_status"] = None
        row[f"{item_name}_evidence"] = None
    if not job or not job.result:
        return row
    output = job.result.corrected_output if job.result.corrected_output is not None else job.result.validated_output
    row["overall_status"] = output.get("overall_status")
    output_items = output.get("items") if isinstance(output.get("items"), list) else []
    by_name = {entry.get("item_name"): entry for entry in output_items if isinstance(entry, dict)}
    for item_name in item_names:
        entry = by_name.get(item_name, {})
        row[f"{item_name}_status"] = entry.get("status")
        row[f"{item_name}_evidence"] = entry.get("evidence")
    return row


def csv_cell(value: Any) -> Any:
    if value is None:
        return ""
    if isinstance(value, list):
        return ";".join(str(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False)
    return value


def _safe_filename_part(value: Any, fallback: str = "export") -> str:
    text_value = str(value or "").strip() or fallback
    text_value = re.sub(r'[\\/:*?"<>|\r\n\t]+', "_", text_value)
    text_value = re.sub(r"\s+", "_", text_value)
    text_value = text_value.strip("._ ")
    return (text_value or fallback)[:100]


def export_filename(module: str, name: Any, identifier: str, extension: str) -> str:
    return (
        "_".join(
            [
                _safe_filename_part(module, "module"),
                _safe_filename_part(name, "untitled"),
                _safe_filename_part(identifier, "job"),
            ]
        )
        + f".{extension}"
    )


def export_job_read(job: ExportJob) -> ExportJobRead:
    return ExportJobRead(
        id=job.id,
        owner_type=job.owner_type,
        owner_id=job.owner_id,
        format=job.format,
        status=job.status,
        filename=job.filename,
        content_type=job.content_type,
        size_bytes=job.size_bytes,
        error_message=job.error_message,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def queue_export_job(
    db: Session,
    *,
    owner_type: str,
    owner_id: str,
    format: str,
    retry_source_job_id: str | None = None,
) -> ExportJob:
    _validate_export_job_owner_exists(db, owner_type, owner_id)
    job = ExportJob(owner_type=owner_type, owner_id=owner_id, format=format, status=ExportJobStatus.QUEUED)
    db.add(job)
    db.flush()
    action = "retried" if retry_source_job_id else "created"
    message = f"Retried {owner_type} export {format.upper()}" if retry_source_job_id else f"Queued {owner_type} export {format.upper()}"
    metadata = {"owner_type": owner_type, "owner_id": owner_id, "format": format}
    if retry_source_job_id:
        metadata["retry_source_job_id"] = retry_source_job_id
    log_audit_event(
        db,
        entity_type="export_job",
        entity_id=job.id,
        action=action,
        message=message,
        metadata=metadata,
    )
    db.commit()
    db.refresh(job)
    return job


def _validate_export_job_owner_exists(db: Session, owner_type: str, owner_id: str) -> None:
    if owner_type not in EXPORT_JOB_OWNER_TYPES:
        raise UnprocessableError("Unsupported export owner type")
    owner_models: dict[str, tuple[Any, str]] = {
        "workflow_run": (WorkflowRun, "Workflow run not found"),
        "batch": (Batch, "Batch not found"),
        "classification_batch": (ClassificationBatch, "Classification batch not found"),
        "required_field_check_batch": (RequiredFieldCheckBatch, "Required field check batch not found"),
        "table_extraction_batch": (TableExtractionBatch, "Table extraction batch not found"),
    }
    owner_model = owner_models.get(owner_type)
    if not owner_model:
        raise UnprocessableError("Unsupported export owner type")
    model, not_found_detail = owner_model
    owner = db.get(model, owner_id)
    if not owner:
        raise NotFoundError(not_found_detail)


def build_export_artifact(
    db: Session,
    owner_type: str,
    owner_id: str,
    format: str,
    *,
    include_raw: bool = False,
    include_confidence: bool = False,
) -> ExportArtifact:
    """``include_raw`` / ``include_confidence`` only apply to table extraction exports."""
    if format not in {"json", "csv", "xlsx"}:
        raise UnprocessableError("Unsupported export format")
    if owner_type == "workflow_run":
        run = db.get(WorkflowRun, owner_id)
        if not run:
            raise NotFoundError("Workflow run not found")
        return _workflow_run_export_artifact(run, format)
    if owner_type == "batch":
        batch = db.get(Batch, owner_id)
        if not batch:
            raise NotFoundError("Batch not found")
        return _batch_export_artifact(db, batch, format)
    if owner_type == "classification_batch":
        batch = db.get(ClassificationBatch, owner_id)
        if not batch:
            raise NotFoundError("Classification batch not found")
        return _classification_batch_export_artifact(db, batch, format)
    if owner_type == "required_field_check_batch":
        batch = db.get(RequiredFieldCheckBatch, owner_id)
        if not batch:
            raise NotFoundError("Required field check batch not found")
        return _required_field_batch_export_artifact(db, batch, format)
    if owner_type == "table_extraction_batch":
        table_batch = db.get(TableExtractionBatch, owner_id)
        if not table_batch:
            raise NotFoundError("Table extraction batch not found")
        return table_batch_export_artifact(db, table_batch, format, include_raw=include_raw, include_confidence=include_confidence)
    raise UnprocessableError("Unsupported export owner type")


def _workflow_run_export_artifact(run: WorkflowRun, format: str) -> ExportArtifact:
    payload, table_collector = workflow_run_export_bundle(run)
    workflow_name = payload.get("workflow_name") or (run.workflow.name if run.workflow else "workflow")
    filename = export_filename("workflow", workflow_name, run.id, format)
    if format == "json":
        return ExportArtifact(_json_export_bytes(payload), filename, "application/json")
    if format == "xlsx":
        rows = payload.get("rows") if isinstance(payload.get("rows"), list) else []
        workbook = _xlsx_workbook(rows, _table_fieldnames(rows))
        if table_collector:
            # Table nodes: one sheet per (template, table key) next to the item sheet.
            table_collector.write_sheets(workbook, reserved={"Export"})
        return ExportArtifact(_workbook_bytes(workbook), filename, XLSX_MIME_TYPE)
    # CSV stays one flat file (one row per item); table rows are only in the XLSX/JSON exports.
    return ExportArtifact(csv_export_bytes(workflow_run_export_csv(run)), filename, "text/csv; charset=utf-8")


def _batch_export_artifact(db: Session, batch: Batch, format: str) -> ExportArtifact:
    schema = db.get(Schema, batch.schema_id)
    if not schema:
        raise NotFoundError("Schema not found")
    schema_data = schema_definition_data(schema)
    field_names = [field["key_name"] for field in schema_data.get("fields", [])]
    rows = [_batch_export_row(item, field_names) for item in sorted_batch_items(batch.items)]
    payload = {
        "batch_id": batch.id,
        "schema_id": batch.schema_id,
        "schema_name": schema.name,
        "status": batch_read(batch).status,
        "total_count": batch.total_count,
        "rows": rows,
    }
    field_columns = [column for field_name in field_names for column in _kie_export_columns(field_name)]
    fieldnames = ["filename", "page_number", "document_id", "job_id", "status", "error_message", *field_columns, "warnings"]
    filename = export_filename("KIE", schema.name, batch.id, format)
    return _tabular_export_artifact(payload, rows, fieldnames, filename, format)


def _classification_batch_export_artifact(db: Session, batch: ClassificationBatch, format: str) -> ExportArtifact:
    classifier = db.get(DocumentClassifier, batch.classifier_id)
    if not classifier:
        raise NotFoundError("Document classifier not found")
    rows = [_classification_batch_export_row(item) for item in sorted_module_items(batch.items)]
    payload = {
        "batch_id": batch.id,
        "classifier_id": batch.classifier_id,
        "classifier_name": classifier.name,
        "status": classification_batch_read(batch).status,
        "total_count": batch.total_count,
        "rows": rows,
    }
    fieldnames = [
        "filename",
        "page_number",
        "document_id",
        "job_id",
        "status",
        "error_message",
        "classification_status",
        "class_name",
        "confidence",
        "reason",
        "evidence",
    ]
    filename = export_filename("classification", classifier.name, batch.id, format)
    return _tabular_export_artifact(payload, rows, fieldnames, filename, format)


def _required_field_batch_export_artifact(db: Session, batch: RequiredFieldCheckBatch, format: str) -> ExportArtifact:
    checklist = db.get(RequiredFieldChecklist, batch.checklist_id)
    if not checklist:
        raise NotFoundError("Required field checklist not found")
    item_names = [item.get("item_name") for item in checklist_data(checklist).get("items", []) if item.get("item_name")]
    rows = [_required_field_batch_export_row(item, item_names) for item in sorted_module_items(batch.items)]
    payload = {
        "batch_id": batch.id,
        "checklist_id": batch.checklist_id,
        "checklist_name": checklist.name,
        "status": required_field_batch_read(batch).status,
        "total_count": batch.total_count,
        "rows": rows,
    }
    item_columns = [f"{name}_status" for name in item_names] + [f"{name}_evidence" for name in item_names]
    fieldnames = ["filename", "page_number", "document_id", "job_id", "status", "error_message", "overall_status", *item_columns]
    filename = export_filename("required_checker", checklist.name, batch.id, format)
    return _tabular_export_artifact(payload, rows, fieldnames, filename, format)


def _tabular_export_artifact(
    payload: dict[str, Any],
    rows: list[dict[str, Any]],
    fieldnames: list[str],
    filename: str,
    format: str,
) -> ExportArtifact:
    if format == "json":
        return ExportArtifact(_json_export_bytes(payload), filename, "application/json")
    if format == "xlsx":
        return ExportArtifact(xlsx_bytes(rows, fieldnames), filename, XLSX_MIME_TYPE)

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: csv_cell(row.get(key)) for key in fieldnames})
    return ExportArtifact(csv_export_bytes(output.getvalue()), filename, "text/csv; charset=utf-8")


def _json_export_bytes(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")


def csv_export_bytes(content: str) -> bytes:
    return f"\ufeff{content}".encode()


def xlsx_bytes(rows: list[dict[str, Any]], fieldnames: list[str]) -> bytes:
    return _workbook_bytes(_xlsx_workbook(rows, fieldnames))


def _xlsx_workbook(rows: list[dict[str, Any]], fieldnames: list[str]) -> Workbook:
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Export"
    if fieldnames:
        sheet.append(fieldnames)
    for row in rows:
        sheet.append([_xlsx_cell(row.get(field)) for field in fieldnames])
    return workbook


def _workbook_bytes(workbook: Workbook) -> bytes:
    output = io.BytesIO()
    workbook.save(output)
    return output.getvalue()


def _xlsx_cell(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, (str, int, float, bool, datetime)):
        return value
    if isinstance(value, list):
        return ";".join(str(item) for item in value)
    if isinstance(value, dict):
        return json.dumps(value, ensure_ascii=False, default=str)
    return str(value)


def _table_fieldnames(rows: list[dict[str, Any]]) -> list[str]:
    fieldnames: list[str] = []
    for row in rows:
        for key in row:
            if key not in fieldnames:
                fieldnames.append(key)
    return fieldnames


def export_preset_read(preset: ExportPreset) -> ExportPresetRead:
    return ExportPresetRead(
        id=preset.id,
        schema_id=preset.schema_id,
        name=preset.name,
        fields=preset.fields_json,
        created_at=preset.created_at,
        updated_at=preset.updated_at,
    )


def apply_export_preset(payload: dict[str, Any], preset: ExportPreset) -> dict[str, Any]:
    fields = [field for field in preset.fields_json or [] if field.get("include", True)]
    if not fields:
        return payload
    values = payload.get("values", {})
    next_values: dict[str, Any] = {}
    for field in fields:
        key_name = field.get("key_name")
        if not key_name or key_name not in values:
            continue
        output_key = field.get("column_name") or key_name
        next_values[output_key] = values[key_name]
    return {**payload, "values": next_values}


def create_export_preset(payload: ExportPresetCreate, db: Session) -> ExportPresetRead:
    if payload.schema_id:
        schema = db.get(Schema, payload.schema_id)
        ensure_found(schema, "Schema not found")
    preset = ExportPreset(
        schema_id=payload.schema_id,
        name=payload.name.strip(),
        fields_json=[field.model_dump() for field in payload.fields],
    )
    db.add(preset)
    db.flush()
    log_audit_event(
        db,
        entity_type="export_preset",
        entity_id=preset.id,
        action="created",
        message=f"Created export preset {preset.name}",
        metadata={"schema_id": preset.schema_id},
    )
    db.commit()
    db.refresh(preset)
    return export_preset_read(preset)


def update_export_preset(preset_id: str, payload: ExportPresetUpdate, db: Session) -> ExportPresetRead:
    preset = db.get(ExportPreset, preset_id)
    ensure_found(preset, "Export preset not found")
    if payload.schema_id:
        schema = db.get(Schema, payload.schema_id)
        ensure_found(schema, "Schema not found")
    if payload.name is not None:
        preset.name = payload.name.strip()
    if "schema_id" in payload.model_fields_set:
        preset.schema_id = payload.schema_id
    if payload.fields is not None:
        preset.fields_json = [field.model_dump() for field in payload.fields]
    log_audit_event(
        db,
        entity_type="export_preset",
        entity_id=preset.id,
        action="updated",
        message=f"Updated export preset {preset.name}",
        metadata={"schema_id": preset.schema_id},
    )
    db.commit()
    db.refresh(preset)
    return export_preset_read(preset)


def delete_export_preset(preset_id: str, db: Session) -> dict[str, str]:
    preset = db.get(ExportPreset, preset_id)
    ensure_found(preset, "Export preset not found")
    log_audit_event(
        db,
        entity_type="export_preset",
        entity_id=preset.id,
        action="deleted",
        message=f"Deleted export preset {preset.name}",
        metadata={"schema_id": preset.schema_id},
    )
    db.delete(preset)
    db.commit()
    return {"status": "deleted"}


@dataclass(frozen=True)
class ExtractionResultExport:
    """A single KIE result export: JSON is returned as a document, CSV/XLSX as a file."""

    filename: str
    json_payload: dict[str, Any] | None = None
    artifact: ExportArtifact | None = None


def export_extraction_result(result_id: str, format: str, preset_id: str | None, db: Session) -> ExtractionResultExport:
    result = db.get(ExtractionResult, result_id)
    if not result:
        raise NotFoundError("Extraction result not found")

    job = result.job or db.get(ExtractionJob, result.job_id)
    ensure_found(job, "Extraction result not found")
    schema = db.get(Schema, job.schema_id) if job else None
    payload = result.corrected_output if result.corrected_output is not None else result.validated_output
    original_payload = result.validated_output
    reviewed_fields = set(result.reviewed_fields or [])
    preset = db.get(ExportPreset, preset_id) if preset_id else None
    if preset_id:
        ensure_found(preset, "Export preset not found")
    export_payload = apply_export_preset(payload, preset) if preset else payload
    page_number = job.page_number if job else None
    export_payload = {**export_payload, "page_number": page_number}
    original_export_payload = apply_export_preset(original_payload, preset) if preset else original_payload
    log_audit_event(
        db,
        entity_type="extraction_result",
        entity_id=result.id,
        action="exported",
        message=f"Exported {format.upper()}",
        metadata={"format": format, "preset_id": preset_id},
    )
    db.commit()
    filename = export_filename("KIE", schema.name if schema else "schema", job.id if job else result_id, format)
    if format == "json":
        return ExtractionResultExport(filename=filename, json_payload=export_payload)

    fieldnames = [
        "page_number",
        "key_name",
        "value",
        "normalized_value",
        "page",
        "confidence",
        "evidence",
        "warnings",
        "original_value",
        "changed",
        "reviewed",
        "ai_review_enabled",
        "ai_review_status",
        "ai_corrected",
        "ai_review_reason",
        "ai_review_confidence",
        "ai_initial_value",
        "ai_initial_evidence",
        "ai_correction_reason",
    ]
    rows: list[dict[str, Any]] = []
    original_values = original_export_payload.get("values", {}) if isinstance(original_export_payload.get("values"), dict) else {}
    for key, value in export_payload.get("values", {}).items():
        value_dict = value if isinstance(value, dict) else {}
        original_value = original_values.get(key)
        ai_review = value_dict.get("ai_review") if isinstance(value_dict.get("ai_review"), dict) else {}
        current_cell = extract_kie_cell_value(value)
        original_cell = extract_kie_cell_value(original_value) if original_value is not None else current_cell
        rows.append(
            {
                "page_number": page_number,
                "key_name": key,
                "value": current_cell,
                "normalized_value": value_dict.get("normalized_value"),
                "page": value_dict.get("page"),
                "confidence": value_dict.get("confidence"),
                "evidence": value_dict.get("evidence"),
                "warnings": ";".join(value_dict.get("warnings", [])),
                "original_value": original_cell,
                "changed": current_cell != original_cell,
                "reviewed": key in reviewed_fields,
                "ai_review_enabled": bool(ai_review.get("enabled")),
                "ai_review_status": ai_review.get("judgement_status"),
                "ai_corrected": bool(ai_review.get("corrected")),
                "ai_review_reason": ai_review.get("judgement_reason"),
                "ai_review_confidence": ai_review.get("judgement_confidence"),
                "ai_initial_value": ai_review.get("initial_value"),
                "ai_initial_evidence": ai_review.get("initial_evidence"),
                "ai_correction_reason": ai_review.get("correction_reason"),
            }
        )
    if format == "xlsx":
        return ExtractionResultExport(filename=filename, artifact=ExportArtifact(xlsx_bytes(rows, fieldnames), filename, XLSX_MIME_TYPE))

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=fieldnames)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: csv_cell(row.get(key)) for key in fieldnames})
    artifact = ExportArtifact(csv_export_bytes(output.getvalue()), filename, "text/csv; charset=utf-8")
    return ExtractionResultExport(filename=filename, artifact=artifact)


# --- table extraction -------------------------------------------------------------------------


def _table_artifact(
    collector: TableExportCollector,
    payload: dict[str, Any],
    module_name: str,
    identifier: str,
    format: str,
) -> ExportArtifact:
    if format == "json":
        return ExportArtifact(_json_export_bytes(payload), export_filename("table", module_name, identifier, "json"), "application/json")
    if format == "xlsx":
        return ExportArtifact(collector.xlsx_bytes(), export_filename("table", module_name, identifier, "xlsx"), XLSX_MIME_TYPE)
    return ExportArtifact(collector.csv_zip_bytes(), export_filename("table", module_name, identifier, "zip"), ZIP_MIME_TYPE)


def _table_page_payload(source: PageSource, job: TableExtractionJob | None, item_status: str | None = None) -> dict[str, Any]:
    result = job.result if job else None
    return {
        "filename": source.filename,
        "page_number": source.page_number,
        "document_id": source.document_id,
        "job_id": source.job_id,
        "status": item_status or (job.status if job else "unknown"),
        "error_message": job.error_message if job else None,
        "result_id": result.id if result else None,
        "reviewed": bool(result.reviewed) if result else False,
        "corrected": bool(result is not None and result.corrected_tables is not None),
        "tables": effective_tables(result),
    }


def _collect_table_job(collector: TableExportCollector, source: PageSource, job: TableExtractionJob | None) -> None:
    if job is None:
        collector.add_failure(source, "job_missing", "Table extraction job not found")
        return
    if job.result is None:
        if job.status == "failed":
            collector.add_failure(source, "job_failed", job.error_message or "Table extraction failed")
        elif job.status == "canceled":
            collector.add_failure(source, "job_canceled", job.error_message or "Table extraction was canceled")
        else:
            collector.add_failure(source, "no_result", f"No result yet (status {job.status})")
        return
    collector.add_tables(source, effective_tables(job.result), job_definition(job))


def table_batch_export_artifact(
    db: Session,
    batch: TableExtractionBatch,
    format: str,
    *,
    include_raw: bool = False,
    include_confidence: bool = False,
) -> ExportArtifact:
    """xlsx: one sheet per TableSpec + 검토_칸 + 검증_위반 · csv: zip of per-table CSVs · json: TableResults per page."""
    template = db.get(TableTemplate, batch.template_id)
    template_name = template.name if template else batch.template_id
    collector = TableExportCollector(include_raw=include_raw, include_confidence=include_confidence)
    collector.declare(load_definition(batch.definition_snapshot))
    pages: list[dict[str, Any]] = []
    read = table_extraction_batch_read(batch)
    status_by_item = {item.id: item.status for item in read.items}
    for item in sorted_module_items(batch.items):
        source = PageSource(item.filename, item.page_number, item.document_id, item.job_id)
        _collect_table_job(collector, source, item.job)
        pages.append(_table_page_payload(source, item.job, status_by_item.get(item.id)))
    payload = {
        "batch_id": batch.id,
        "template_id": batch.template_id,
        "template_name": template_name,
        "template_version": batch.template_version,
        "status": read.status,
        "total_count": batch.total_count,
        "pages": pages,
    }
    return _table_artifact(collector, payload, template_name, batch.id, format)


def table_job_export_artifact(
    db: Session,
    job_id: str,
    format: str,
    *,
    include_raw: bool = False,
    include_confidence: bool = False,
) -> ExportArtifact:
    """Export of one page (review screen): same formats as the batch export."""
    if format not in {"json", "csv", "xlsx"}:
        raise UnprocessableError("Unsupported export format")
    job = db.get(TableExtractionJob, job_id)
    ensure_found(job, "Table extraction job not found")
    if job.result is None:
        raise ConflictError("Table extraction job has no result to export yet")
    template = db.get(TableTemplate, job.template_id)
    template_name = template.name if template else job.template_id
    document = job.document
    source = PageSource(document.filename if document else None, job.page_number, job.document_id, job.id)
    collector = TableExportCollector(include_raw=include_raw, include_confidence=include_confidence)
    definition = job_definition(job)
    if definition is not None:
        try:
            collector.declare(TableTemplateDefinition(tables=select_tables(definition, job.table_keys)))
        except ValueError:
            collector.declare(definition)
    _collect_table_job(collector, source, job)
    payload = {
        "template_id": job.template_id,
        "template_name": template_name,
        "template_version": job.template_version,
        **_table_page_payload(source, job),
    }
    log_audit_event(
        db,
        entity_type="table_extraction_job",
        entity_id=job.id,
        action="exported",
        message=f"Exported table extraction job {format.upper()}",
        metadata={"format": format, "include_raw": include_raw, "include_confidence": include_confidence},
    )
    db.commit()
    return _table_artifact(collector, payload, template_name, job.id, format)
