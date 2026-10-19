"""Table extraction jobs and results: single/draft job creation, reads, reviewer edits, batch creation."""

import copy
import re
from typing import Any

from sqlalchemy.orm import Session

from app.application import batches as batches_service
from app.application.batches import ModuleKind
from app.application.dispatch import JobDispatch
from app.application.module_jobs import _admit_document, _create_page_jobs, _single_job_response, single_job_page_numbers
from app.application.table_templates import get_runnable_template
from app.audit import log_audit_event
from app.core.clock import utcnow
from app.core.errors import NotFoundError, UnprocessableError, ensure_found
from app.domain.table_normalization import (
    RawCell,
    RawRow,
    coerce_raw,
    raw_rows_from_result,
    revalidate_table_result,
    table_warnings,
)
from app.domain.table_spec import TableSpec, TableTemplateDefinition, load_definition, select_tables
from app.models import Document, TableExtractionJob, TableExtractionResult, TableTemplate
from app.table_schemas import (
    TableExtractionBatchFromDocumentsRequest,
    TableExtractionBatchRead,
    TableExtractionDraftJobCreate,
    TableExtractionJobCreate,
    TableExtractionJobRead,
    TableExtractionResultPatch,
    TableExtractionResultRead,
)

# --- reads ----------------------------------------------------------------------------------


def table_result_read(result: TableExtractionResult) -> TableExtractionResultRead:
    return TableExtractionResultRead(
        id=result.id,
        job_id=result.job_id,
        raw_model_output=result.raw_model_output or {},
        tables=result.tables or [],
        corrected_tables=result.corrected_tables,
        edit_log=result.edit_log or [],
        reviewed=result.reviewed,
        validation_warnings=[str(warning) for warning in result.validation_warnings or []],
        created_at=result.created_at,
        updated_at=result.updated_at,
    )


def table_job_read(job: TableExtractionJob) -> TableExtractionJobRead:
    return TableExtractionJobRead(
        job_id=job.id,
        document_id=job.document_id,
        page_number=job.page_number,
        template_id=job.template_id,
        template_version=job.template_version,
        table_keys=job.table_keys,
        definition_snapshot=load_definition(job.definition_snapshot),
        status=job.status,
        error_message=job.error_message,
        result_id=job.result_id,
        result=table_result_read(job.result) if job.result else None,
        created_at=job.created_at,
        started_at=job.started_at,
        completed_at=job.completed_at,
    )


def get_table_job(job_id: str, db: Session) -> TableExtractionJobRead:
    job = db.get(TableExtractionJob, job_id)
    ensure_found(job, "Table extraction job not found")
    return table_job_read(job)


def list_table_jobs(db: Session, *, document_id: str | None, limit: int) -> list[TableExtractionJobRead]:
    query = db.query(TableExtractionJob)
    if document_id:
        query = query.filter(TableExtractionJob.document_id == document_id)
    return [table_job_read(job) for job in query.order_by(TableExtractionJob.created_at.desc()).limit(limit).all()]


# --- creation -------------------------------------------------------------------------------


def _runnable_tables(definition: TableTemplateDefinition, table_keys: list[str] | None) -> list[TableSpec]:
    try:
        tables = select_tables(definition, table_keys)
    except ValueError as exc:
        raise UnprocessableError(str(exc)) from exc
    if not tables:
        raise UnprocessableError("The table template has no tables to extract")
    return tables


def _create_jobs(
    document_id: str,
    page_number: int | None,
    template: TableTemplate,
    table_keys: list[str] | None,
    db: Session,
    *,
    message: str,
) -> tuple[TableExtractionJobRead, list[JobDispatch]]:
    document = db.get(Document, document_id)
    ensure_found(document, "Document not found")
    _runnable_tables(load_definition(template.definition_json), table_keys)
    status = _admit_document(document, db)
    snapshot = copy.deepcopy(template.definition_json or {"tables": []})
    jobs = _create_page_jobs(
        db,
        document,
        single_job_page_numbers(document, page_number, db),
        status,
        lambda _page: TableExtractionJob(
            template_id=template.id,
            template_version=template.current_version,
            definition_snapshot=snapshot,
            table_keys=list(table_keys) if table_keys is not None else None,
        ),
        entity_type="table_extraction_job",
        message=message,
        metadata={"template_id": template.id, "template_version": template.current_version},
    )
    return _single_job_response(jobs, table_job_read, "table_extraction_job", status)


def create_table_job(payload: TableExtractionJobCreate, db: Session) -> tuple[TableExtractionJobRead, list[JobDispatch]]:
    template = get_runnable_template(payload.template_id, db)
    return _create_jobs(payload.document_id, payload.page_number, template, payload.table_keys, db, message="Table extraction job created")


def create_draft_table_job(payload: TableExtractionDraftJobCreate, db: Session) -> tuple[TableExtractionJobRead, list[JobDispatch]]:
    definition = payload.definition.definition()
    _runnable_tables(definition, payload.table_keys)
    document = db.get(Document, payload.document_id)
    ensure_found(document, "Document not found")
    name = (payload.definition.name or "").strip() or "draft"
    template = TableTemplate(
        name=name,
        display_name=name,
        current_version=1,
        definition_json=definition.model_dump(mode="json"),
        sample_refs_json=[],
        pinned=False,
        ephemeral=True,
        archived=False,
    )
    db.add(template)
    db.flush()
    return _create_jobs(payload.document_id, payload.page_number, template, payload.table_keys, db, message="Draft table extraction job created")


def create_table_batch_from_documents(
    payload: TableExtractionBatchFromDocumentsRequest, db: Session
) -> tuple[TableExtractionBatchRead, JobDispatch | None]:
    template = get_runnable_template(payload.template_id, db)
    _runnable_tables(load_definition(template.definition_json), None)
    return batches_service.create_batch_from_documents(ModuleKind.TABLE, template.id, payload.document_ids, db)


# --- reviewer edits -------------------------------------------------------------------------


class _TableEditor:
    """Working copy of one table while a PATCH is applied (row references are pre-PATCH)."""

    def __init__(self, spec: TableSpec, table_result: dict[str, Any]) -> None:
        self.spec = spec
        self.result = table_result
        self.rows: list[RawRow] = raw_rows_from_result(table_result, spec)
        self.index_to_id = {row.get("row_index"): str(row.get("row_id")) for row in table_result.get("rows") or [] if row.get("row_index")}
        self.cells_before = {str(row.get("row_id")): row.get("cells") or {} for row in table_result.get("rows") or []}
        self.inserted_after: dict[str, str] = {}

    def resolve(self, row_id: str | None, row_index: int | None) -> str:
        if row_id is None and row_index is None:
            raise UnprocessableError(f"{self.spec.key}: row_id or row_index is required")
        if row_id is None:
            if row_index not in self.index_to_id:
                raise UnprocessableError(f"{self.spec.key}: row_index {row_index} does not exist")
            row_id = self.index_to_id[row_index]
        if not any(row.row_id == row_id for row in self.rows):
            raise UnprocessableError(f"{self.spec.key}: row {row_id} does not exist")
        return row_id

    def row(self, row_id: str) -> RawRow:
        return next(row for row in self.rows if row.row_id == row_id)

    def column_index(self, column: str) -> int:
        keys = self.spec.column_keys
        if column not in keys:
            raise UnprocessableError(f"{self.spec.key}: unknown column {column}")
        return keys.index(column)

    def next_added_id(self) -> str:
        used = [int(match.group(1)) for row in self.rows if (match := re.fullmatch(r"a(\d+)", row.row_id))]
        used.extend(int(match.group(1)) for row_id in self.cells_before if (match := re.fullmatch(r"a(\d+)", row_id)))
        return f"a{max(used, default=0) + 1}"


def patch_table_result(result_id: str, payload: TableExtractionResultPatch, db: Session) -> TableExtractionResultRead:
    """Apply edits → row deletions → row additions to a copy of the tables, then re-validate them.

    The copy starts from ``corrected_tables`` (or ``tables`` on the first edit) and replaces
    ``corrected_tables`` as a whole; every change is appended to ``edit_log``.
    """
    result = db.get(TableExtractionResult, result_id)
    if not result:
        raise NotFoundError("Table extraction result not found")
    job = db.get(TableExtractionJob, result.job_id)
    specs = {table.key: table for table in load_definition(job.definition_snapshot if job else None).tables}
    base = copy.deepcopy(result.corrected_tables if result.corrected_tables is not None else result.tables) or []
    tables_by_key = {table.get("table_key"): table for table in base}
    editors: dict[str, _TableEditor] = {}
    now = utcnow().isoformat()
    log: list[dict[str, Any]] = list(result.edit_log or [])

    def editor(table_key: str) -> _TableEditor:
        if table_key not in tables_by_key or table_key not in specs:
            raise UnprocessableError(f"Unknown table_key: {table_key}")
        if table_key not in editors:
            editors[table_key] = _TableEditor(specs[table_key], tables_by_key[table_key])
        return editors[table_key]

    for edit in payload.edits:
        current = editor(edit.table_key)
        row_id = current.resolve(edit.row_id, edit.row_index)
        column_index = current.column_index(edit.column)
        row = current.row(row_id)
        before = (current.cells_before.get(row_id, {}).get(edit.column) or {}).get("value")
        row.cells[column_index] = RawCell(coerce_raw(edit.value), 1.0, corrected=True)
        row.edited = True
        log.append(
            {"at": now, "action": "edit", "table_key": edit.table_key, "row_id": row_id, "row_index": edit.row_index, "column": edit.column, "before": before, "after": edit.value}
        )

    for deletion in payload.delete_rows:
        current = editor(deletion.table_key)
        row_id = current.resolve(deletion.row_id, deletion.row_index)
        before = {key: cell.get("value") for key, cell in current.cells_before.get(row_id, {}).items()}
        current.rows = [row for row in current.rows if row.row_id != row_id]
        log.append({"at": now, "action": "delete_row", "table_key": deletion.table_key, "row_id": row_id, "row_index": deletion.row_index, "before": before})

    for addition in payload.add_rows:
        current = editor(addition.table_key)
        unknown = sorted(set(addition.cells) - set(current.spec.column_keys))
        if unknown:
            raise UnprocessableError(f"{addition.table_key}: unknown column(s) {', '.join(unknown)}")
        new_row = RawRow(
            row_id=current.next_added_id(),
            source_line=None,
            y_center=None,
            cells=[
                RawCell(coerce_raw(addition.cells[key]), 1.0, corrected=True) if key in addition.cells else RawCell(None)
                for key in current.spec.column_keys
            ],
            added=True,
        )
        if addition.after_row_id is None and addition.after_row_index is None:
            current.rows.append(new_row)
        elif addition.after_row_id is None and addition.after_row_index == 0:
            anchor = current.inserted_after.get("__top__")
            position = next(index for index, row in enumerate(current.rows) if row.row_id == anchor) + 1 if anchor else 0
            current.rows.insert(position, new_row)
            current.inserted_after["__top__"] = new_row.row_id
        else:
            anchor_id = current.resolve(addition.after_row_id, addition.after_row_index)
            last = current.inserted_after.get(anchor_id, anchor_id)
            position = next(index for index, row in enumerate(current.rows) if row.row_id == last) + 1
            current.rows.insert(position, new_row)
            current.inserted_after[anchor_id] = new_row.row_id
        log.append({"at": now, "action": "add_row", "table_key": addition.table_key, "row_id": new_row.row_id, "after": dict(addition.cells)})

    for table_key, current in editors.items():
        tables_by_key[table_key] = revalidate_table_result(current.spec, current.result, current.rows)
    if editors:
        corrected = [tables_by_key[table.get("table_key")] for table in base]
        result.corrected_tables = corrected
    if payload.reviewed is not None:
        result.reviewed = payload.reviewed
        log.append({"at": now, "action": "reviewed", "after": payload.reviewed})
    result.edit_log = log
    log_audit_event(
        db,
        entity_type="table_extraction_result",
        entity_id=result.id,
        action="review_saved",
        message="Table review changes saved",
        metadata={
            "edits": len(payload.edits),
            "added_rows": len(payload.add_rows),
            "deleted_rows": len(payload.delete_rows),
            "reviewed": payload.reviewed,
            "warnings": len(table_warnings(result.corrected_tables or [])),
        },
    )
    db.commit()
    db.refresh(result)
    return table_result_read(result)
