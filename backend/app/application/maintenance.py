import shutil
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.core.errors import ensure_found
from app.models import (
    AuditEvent,
    Batch,
    BatchItem,
    ClassificationBatch,
    ClassificationBatchItem,
    ClassificationJob,
    ClassificationResult,
    Document,
    DocumentPage,
    ExportJob,
    ExtractionJob,
    ExtractionResult,
    RawExtraction,
    RequiredFieldCheckBatch,
    RequiredFieldCheckBatchItem,
    RequiredFieldCheckJob,
    RequiredFieldCheckResult,
    Schema,
    TableExtractionBatch,
    TableExtractionBatchItem,
    TableExtractionJob,
    TableExtractionResult,
    TableTemplate,
    WorkflowRun,
    WorkflowRunItem,
)
from app.schemas import (
    ArchiveSearchResult,
    AuditEventRead,
)
from app.storage import delete_storage_ref, is_s3_ref


def archive_search(
    db: Session,
    *,
    q: str | None,
    status: str | None,
    schema_id: str | None,
    document_type: str | None,
    limit: int,
) -> list[ArchiveSearchResult]:
    normalized_q = (q or "").strip().lower()
    if schema_id:
        schema = db.get(Schema, schema_id)
        ensure_found(schema, "Schema not found")
    documents = db.query(Document).order_by(Document.created_at.desc()).limit(200).all()
    results: list[ArchiveSearchResult] = []
    for document in documents:
        if document_type and document.document_type != document_type:
            continue
        jobs = db.query(ExtractionJob).filter(ExtractionJob.document_id == document.id).order_by(ExtractionJob.created_at.desc()).all()
        if not jobs:
            if status or schema_id:
                continue
            haystack = " ".join(filter(None, [document.filename, document.document_type, document.language])).lower()
            if normalized_q and normalized_q not in haystack:
                continue
            results.append(
                ArchiveSearchResult(
                    document_id=document.id,
                    filename=document.filename,
                    document_type=document.document_type,
                    language=document.language,
                    created_at=document.created_at,
                    matched_text=document.filename,
                )
            )
            if len(results) >= limit:
                return results
            continue

        for job in jobs:
            if status and job.status != status:
                continue
            if schema_id and job.schema_id != schema_id:
                continue
            schema_name = job.schema.name if job.schema else None
            matched_text = _job_search_text(document, job, schema_name)
            if normalized_q and normalized_q not in matched_text.lower():
                continue
            results.append(
                ArchiveSearchResult(
                    document_id=document.id,
                    filename=document.filename,
                    document_type=document.document_type,
                    language=document.language,
                    job_id=job.id,
                    result_id=job.result_id,
                    schema_id=job.schema_id,
                    schema_name=schema_name,
                    status=job.status,
                    matched_text=matched_text[:240],
                    created_at=job.created_at,
                )
            )
            if len(results) >= limit:
                return results
    return results


def _job_search_text(document: Document, job: ExtractionJob, schema_name: str | None) -> str:
    parts = [document.filename, document.document_type or "", document.language or "", schema_name or "", job.status]
    if job.result:
        payload = job.result.corrected_output if job.result.corrected_output is not None else job.result.validated_output
        for key, value in payload.get("values", {}).items():
            parts.append(str(key))
            if isinstance(value, dict):
                parts.append(str(value.get("value", "")))
                parts.append(str(value.get("evidence", "")))
    return " ".join(parts)


def audit_event_read(event: AuditEvent) -> AuditEventRead:
    return AuditEventRead(
        id=event.id,
        entity_type=event.entity_type,
        entity_id=event.entity_id,
        action=event.action,
        message=event.message,
        metadata=event.metadata_json or {},
        created_at=event.created_at,
    )


def cleanup_expired_upload_data() -> dict[str, Any]:
    settings = get_settings()
    retention_hours = settings.resolved_upload_retention_hours
    if retention_hours <= 0:
        return {"status": "disabled"}
    cutoff = utcnow() - timedelta(hours=retention_hours)
    db = SessionLocal()
    try:
        documents = db.query(Document).filter(Document.created_at < cutoff).all()
        raw_rows = db.query(RawExtraction).filter(RawExtraction.created_at < cutoff).all()
        export_jobs = db.query(ExportJob).filter(ExportJob.created_at < cutoff).all()
        paths = _storage_paths_for_cleanup(documents, raw_rows, export_jobs)
        counts = _delete_history_before(db, cutoff)
        db.commit()
    finally:
        db.close()

    removed_paths: list[str] = []
    for path in paths:
        try:
            delete_storage_ref(path)
            removed_paths.append(str(path))
        except Exception:
            pass
    return {"status": "cleaned", "cutoff": cutoff.isoformat(), "counts": counts, "removed_paths": removed_paths}


def _storage_paths_for_cleanup(documents: list[Document], raw_rows: list[RawExtraction], export_jobs: list[ExportJob]) -> set[str]:
    paths: set[str] = set()
    for document in documents:
        if document.storage_path:
            paths.add(_artifact_root(document.storage_path))
        for page in document.pages:
            if page.image_path and is_s3_ref(page.image_path):
                paths.add(page.image_path)
    for raw in raw_rows:
        for ref in [raw.storage_path, raw.pdf_path, raw.html_path]:
            if ref:
                paths.add(_artifact_root(ref))
    for job in export_jobs:
        if job.storage_path:
            paths.add(job.storage_path if is_s3_ref(job.storage_path) else str(Path(job.storage_path).parent))
    return paths


def _artifact_root(ref: str) -> str:
    if is_s3_ref(ref):
        return ref
    path = Path(ref)
    return str(path.parent if path.name.startswith(("original", "preview", "content")) else path)


def _delete_history_before(db: Session, cutoff: datetime) -> dict[str, int]:
    counts: dict[str, int] = {}
    expired_document_ids = [row[0] for row in db.query(Document.id).filter(Document.created_at < cutoff).all()]
    expired_extraction_job_ids = [row[0] for row in db.query(ExtractionJob.id).filter(ExtractionJob.created_at < cutoff).all()]
    expired_classification_job_ids = [row[0] for row in db.query(ClassificationJob.id).filter(ClassificationJob.created_at < cutoff).all()]
    expired_required_job_ids = [
        row[0] for row in db.query(RequiredFieldCheckJob.id).filter(RequiredFieldCheckJob.created_at < cutoff).all()
    ]

    counts["classification_batch_items"] = (
        db.query(ClassificationBatchItem).filter(ClassificationBatchItem.created_at < cutoff).delete(synchronize_session=False)
    )
    counts["classification_batches"] = (
        db.query(ClassificationBatch).filter(ClassificationBatch.created_at < cutoff).delete(synchronize_session=False)
    )
    if expired_classification_job_ids:
        counts["classification_results"] = (
            db.query(ClassificationResult)
            .filter(ClassificationResult.job_id.in_(expired_classification_job_ids))
            .delete(synchronize_session=False)
        )
    counts["classification_jobs"] = (
        db.query(ClassificationJob).filter(ClassificationJob.created_at < cutoff).delete(synchronize_session=False)
    )

    counts["required_field_check_batch_items"] = (
        db.query(RequiredFieldCheckBatchItem).filter(RequiredFieldCheckBatchItem.created_at < cutoff).delete(synchronize_session=False)
    )
    counts["required_field_check_batches"] = (
        db.query(RequiredFieldCheckBatch).filter(RequiredFieldCheckBatch.created_at < cutoff).delete(synchronize_session=False)
    )
    if expired_required_job_ids:
        counts["required_field_check_results"] = (
            db.query(RequiredFieldCheckResult)
            .filter(RequiredFieldCheckResult.job_id.in_(expired_required_job_ids))
            .delete(synchronize_session=False)
        )
    counts["required_field_check_jobs"] = (
        db.query(RequiredFieldCheckJob).filter(RequiredFieldCheckJob.created_at < cutoff).delete(synchronize_session=False)
    )

    expired_table_job_ids = [row[0] for row in db.query(TableExtractionJob.id).filter(TableExtractionJob.created_at < cutoff).all()]
    counts["table_extraction_batch_items"] = (
        db.query(TableExtractionBatchItem).filter(TableExtractionBatchItem.created_at < cutoff).delete(synchronize_session=False)
    )
    counts["table_extraction_batches"] = (
        db.query(TableExtractionBatch).filter(TableExtractionBatch.created_at < cutoff).delete(synchronize_session=False)
    )
    if expired_table_job_ids:
        counts["table_extraction_results"] = (
            db.query(TableExtractionResult).filter(TableExtractionResult.job_id.in_(expired_table_job_ids)).delete(synchronize_session=False)
        )
    counts["table_extraction_jobs"] = (
        db.query(TableExtractionJob).filter(TableExtractionJob.created_at < cutoff).delete(synchronize_session=False)
    )

    counts["workflow_run_items"] = db.query(WorkflowRunItem).filter(WorkflowRunItem.created_at < cutoff).delete(synchronize_session=False)
    counts["workflow_runs"] = db.query(WorkflowRun).filter(WorkflowRun.created_at < cutoff).delete(synchronize_session=False)
    counts["batch_items"] = db.query(BatchItem).filter(BatchItem.created_at < cutoff).delete(synchronize_session=False)
    counts["batches"] = db.query(Batch).filter(Batch.created_at < cutoff).delete(synchronize_session=False)
    if expired_extraction_job_ids:
        counts["extraction_results"] = (
            db.query(ExtractionResult).filter(ExtractionResult.job_id.in_(expired_extraction_job_ids)).delete(synchronize_session=False)
        )
    counts["extraction_jobs"] = db.query(ExtractionJob).filter(ExtractionJob.created_at < cutoff).delete(synchronize_session=False)
    counts["export_jobs"] = db.query(ExportJob).filter(ExportJob.created_at < cutoff).delete(synchronize_session=False)
    if expired_document_ids:
        counts["document_pages"] = (
            db.query(DocumentPage).filter(DocumentPage.document_id.in_(expired_document_ids)).delete(synchronize_session=False)
        )
    counts["documents"] = db.query(Document).filter(Document.created_at < cutoff).delete(synchronize_session=False)
    counts["raw_extractions"] = db.query(RawExtraction).filter(RawExtraction.created_at < cutoff).delete(synchronize_session=False)
    counts["audit_events"] = db.query(AuditEvent).filter(AuditEvent.created_at < cutoff).delete(synchronize_session=False)
    draft_schemas = db.query(Schema).filter(Schema.ephemeral == True, Schema.created_at < cutoff)  # noqa: E712
    counts["draft_schemas"] = draft_schemas.delete(synchronize_session=False)
    draft_table_templates = db.query(TableTemplate).filter(TableTemplate.ephemeral == True, TableTemplate.created_at < cutoff)  # noqa: E712
    counts["draft_table_templates"] = draft_table_templates.delete(synchronize_session=False)
    return counts


def clear_parsing_history(db: Session) -> dict[str, Any]:
    settings = get_settings()
    counts = {
        "batches": db.query(Batch).count(),
        "batch_items": db.query(BatchItem).count(),
        "classification_batches": db.query(ClassificationBatch).count(),
        "classification_batch_items": db.query(ClassificationBatchItem).count(),
        "classification_jobs": db.query(ClassificationJob).count(),
        "classification_results": db.query(ClassificationResult).count(),
        "required_field_check_batches": db.query(RequiredFieldCheckBatch).count(),
        "required_field_check_batch_items": db.query(RequiredFieldCheckBatchItem).count(),
        "required_field_check_jobs": db.query(RequiredFieldCheckJob).count(),
        "required_field_check_results": db.query(RequiredFieldCheckResult).count(),
        "table_extraction_batches": db.query(TableExtractionBatch).count(),
        "table_extraction_batch_items": db.query(TableExtractionBatchItem).count(),
        "table_extraction_jobs": db.query(TableExtractionJob).count(),
        "table_extraction_results": db.query(TableExtractionResult).count(),
        "draft_table_templates": db.query(TableTemplate).filter(TableTemplate.ephemeral == True).count(),  # noqa: E712
        "workflow_runs": db.query(WorkflowRun).count(),
        "workflow_run_items": db.query(WorkflowRunItem).count(),
        "export_jobs": db.query(ExportJob).count(),
        "documents": db.query(Document).count(),
        "document_pages": db.query(DocumentPage).count(),
        "extraction_jobs": db.query(ExtractionJob).count(),
        "extraction_results": db.query(ExtractionResult).count(),
        "raw_extractions": db.query(RawExtraction).count(),
        "audit_events": db.query(AuditEvent).count(),
        "draft_schemas": db.query(Schema).filter(Schema.ephemeral == True).count(),  # noqa: E712
    }

    ephemeral_schema_ids = [row[0] for row in db.query(Schema.id).filter(Schema.ephemeral == True).all()]  # noqa: E712
    db.query(ClassificationBatchItem).delete(synchronize_session=False)
    db.query(ClassificationBatch).delete(synchronize_session=False)
    db.query(ClassificationResult).delete(synchronize_session=False)
    db.query(ClassificationJob).delete(synchronize_session=False)
    db.query(RequiredFieldCheckBatchItem).delete(synchronize_session=False)
    db.query(RequiredFieldCheckBatch).delete(synchronize_session=False)
    db.query(RequiredFieldCheckResult).delete(synchronize_session=False)
    db.query(RequiredFieldCheckJob).delete(synchronize_session=False)
    db.query(TableExtractionBatchItem).delete(synchronize_session=False)
    db.query(TableExtractionBatch).delete(synchronize_session=False)
    db.query(TableExtractionResult).delete(synchronize_session=False)
    db.query(TableExtractionJob).delete(synchronize_session=False)
    db.query(TableTemplate).filter(TableTemplate.ephemeral == True).delete(synchronize_session=False)  # noqa: E712
    db.query(WorkflowRunItem).delete(synchronize_session=False)
    db.query(WorkflowRun).delete(synchronize_session=False)
    db.query(ExportJob).delete(synchronize_session=False)
    db.query(BatchItem).delete(synchronize_session=False)
    db.query(Batch).delete(synchronize_session=False)
    db.query(ExtractionResult).delete(synchronize_session=False)
    db.query(ExtractionJob).delete(synchronize_session=False)
    db.query(DocumentPage).delete(synchronize_session=False)
    db.query(Document).delete(synchronize_session=False)
    db.query(RawExtraction).delete(synchronize_session=False)
    db.query(AuditEvent).delete(synchronize_session=False)
    if ephemeral_schema_ids:
        db.query(Schema).filter(Schema.id.in_(ephemeral_schema_ids)).delete(synchronize_session=False)
    db.commit()

    removed_paths: list[str] = []
    for path in [settings.resolved_storage_dir, settings.resolved_raw_storage_dir]:
        if path.exists():
            shutil.rmtree(path)
            removed_paths.append(str(path))
        path.mkdir(parents=True, exist_ok=True)

    return {"status": "cleared", "counts": counts, "removed_paths": removed_paths}
