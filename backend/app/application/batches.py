"""Module batches (KIE, classification, required-field check, rotation, table extraction) behind one implementation.

The batch families differ only in their tables, the definition they run (schema,
classifier, checklist or none), the background runner and the response DTO. Those
differences live in ``ModuleBatchSpec`` (one entry per ``ModuleKind`` in ``BATCH_SPECS``);
every use case below takes the spec.

Units of work are pages (§8.1): a ready multi-page document becomes one job + item per page,
a document that is not ready yet gets a placeholder (``page_number = None``) that
``expand_item_pages`` splits once its pages exist. ``total_count`` always equals the number
of items the batch will have, so it grows by ``pages - 1`` whenever a placeholder expands.
"""

from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.application.dispatch import JobDispatch
from app.application.documents import (
    create_failed_upload_document,
    create_uploaded_document,
    delete_document_payloads,
    document_not_executable_message,
    documents_for_selection,
    execution_job_status_for_document,
    preprocess_document_pages,
)
from app.application.page_units import expandable_page_numbers, page_slots
from app.application.uploads import (
    UploadedFile,
    UploadEntry,
    close_upload,
    ensure_upload_append_capacity,
    filter_new_upload_entries,
    owner_accepts_uploads,
    sorted_module_items,
    upload_failure_message,
    validate_declared_batch_file_count,
    validate_owner_can_start,
    validate_owner_upload_complete,
    validate_upload_file_count,
)
from app.audit import log_audit_event
from app.core.clock import utcnow
from app.core.errors import ConflictError, InvalidRequestError, NotFoundError, UnprocessableError, ensure_found
from app.domain.batch import BatchLifecycle
from app.domain.module_job import ModuleJobLifecycle
from app.domain.status import (
    BATCH_TERMINAL_STATUSES,
    BATCH_UPLOAD_OPEN_STATUSES,
    MODULE_JOB_PENDING_STATUSES,
    MODULE_JOB_PREPARING_STATUSES,
    MODULE_JOB_SUCCESS_STATUSES,
    MODULE_JOB_TERMINAL_STATUSES,
    BatchStatus,
    DocumentStatus,
    JobAdmission,
    ModuleJobStatus,
)
from app.models import (
    Batch,
    BatchItem,
    ClassificationBatch,
    ClassificationBatchItem,
    ClassificationJob,
    Document,
    DocumentClassifier,
    ExtractionJob,
    RequiredFieldCheckBatch,
    RequiredFieldCheckBatchItem,
    RequiredFieldCheckJob,
    RequiredFieldChecklist,
    RotationBatch,
    RotationBatchItem,
    RotationJob,
    Schema,
    TableExtractionBatch,
    TableExtractionBatchItem,
    TableExtractionJob,
    TableTemplate,
)
from app.rotation import rotation_job_pages
from app.schemas import (
    BatchItemRead,
    BatchRead,
    ClassificationBatchItemRead,
    ClassificationBatchRead,
    RequiredFieldCheckBatchItemRead,
    RequiredFieldCheckBatchRead,
    RotationBatchItemRead,
    RotationBatchRead,
    RotationPageResultRead,
)
from app.table_schemas import TableExtractionBatchItemRead, TableExtractionBatchRead


class ModuleKind(StrEnum):
    KIE = "kie"
    CLASSIFICATION = "classification"
    REQUIRED_CHECK = "required_check"
    ROTATION = "rotation"
    TABLE = "table"


@dataclass(frozen=True)
class ModuleBatchSpec:
    kind: ModuleKind
    batch_model: Any
    item_model: Any
    job_model: Any
    read_model: Any
    item_read_model: Any
    entity_type: str  # audit entity type of the batch (also its export owner type)
    job_entity_type: str
    title: str  # "Classification batch" -> "Classification batch not found"
    label: str  # used in audit messages
    runner: str  # ``JobRunners`` attribute that runs a list of this batch's jobs
    job_runner: str | None  # ``JobRunners`` attribute that runs one standalone job (None: no standalone jobs)
    no_items_message: str
    definition_field: str | None = None  # column shared by the batch and its jobs
    definition_model: Any = None
    definition_not_found: str = ""
    definition_archivable: bool = True
    per_page: bool = True  # rotation checks every page of a document in one job
    extra_job_fields: Callable[[Any], dict[str, Any]] = field(default=lambda batch: {})
    # Columns set on a new batch from its definition (e.g. the definition version/snapshot it runs).
    new_batch_fields: Callable[[Any], dict[str, Any]] = field(default=lambda definition: {})

    @property
    def not_found(self) -> str:
        return f"{self.title} not found"


BATCH_SPECS: dict[ModuleKind, ModuleBatchSpec] = {
    ModuleKind.KIE: ModuleBatchSpec(
        kind=ModuleKind.KIE,
        batch_model=Batch,
        item_model=BatchItem,
        job_model=ExtractionJob,
        read_model=BatchRead,
        item_read_model=BatchItemRead,
        entity_type="batch",
        job_entity_type="extraction_job",
        title="Batch",
        label="KIE batch",
        runner="extraction_batch",
        job_runner="extraction_job",
        no_items_message="No uploaded batch items are available to continue",
        definition_field="schema_id",
        definition_model=Schema,
        definition_not_found="Schema not found",
        definition_archivable=False,
        extra_job_fields=lambda batch: {"schema_version": batch.schema_version},
        new_batch_fields=lambda definition: {"schema_version": 1},
    ),
    ModuleKind.CLASSIFICATION: ModuleBatchSpec(
        kind=ModuleKind.CLASSIFICATION,
        batch_model=ClassificationBatch,
        item_model=ClassificationBatchItem,
        job_model=ClassificationJob,
        read_model=ClassificationBatchRead,
        item_read_model=ClassificationBatchItemRead,
        entity_type="classification_batch",
        job_entity_type="classification_job",
        title="Classification batch",
        label="classification batch",
        runner="classification_batch",
        job_runner="classification_job",
        no_items_message="No uploaded classification items are available to continue",
        definition_field="classifier_id",
        definition_model=DocumentClassifier,
        definition_not_found="Document classifier not found",
    ),
    ModuleKind.REQUIRED_CHECK: ModuleBatchSpec(
        kind=ModuleKind.REQUIRED_CHECK,
        batch_model=RequiredFieldCheckBatch,
        item_model=RequiredFieldCheckBatchItem,
        job_model=RequiredFieldCheckJob,
        read_model=RequiredFieldCheckBatchRead,
        item_read_model=RequiredFieldCheckBatchItemRead,
        entity_type="required_field_check_batch",
        job_entity_type="required_field_check_job",
        title="Required field check batch",
        label="required field check batch",
        runner="required_check_batch",
        job_runner="required_check_job",
        no_items_message="No uploaded required field items are available to continue",
        definition_field="checklist_id",
        definition_model=RequiredFieldChecklist,
        definition_not_found="Required field checklist not found",
    ),
    ModuleKind.ROTATION: ModuleBatchSpec(
        kind=ModuleKind.ROTATION,
        batch_model=RotationBatch,
        item_model=RotationBatchItem,
        job_model=RotationJob,
        read_model=RotationBatchRead,
        item_read_model=RotationBatchItemRead,
        entity_type="rotation_batch",
        job_entity_type="rotation_job",
        title="Rotation batch",
        label="rotation batch",
        runner="rotation_batch",
        job_runner=None,
        no_items_message="No uploaded rotation items are available to continue",
        per_page=False,
    ),
    ModuleKind.TABLE: ModuleBatchSpec(
        kind=ModuleKind.TABLE,
        batch_model=TableExtractionBatch,
        item_model=TableExtractionBatchItem,
        job_model=TableExtractionJob,
        read_model=TableExtractionBatchRead,
        item_read_model=TableExtractionBatchItemRead,
        entity_type="table_extraction_batch",
        job_entity_type="table_extraction_job",
        title="Table extraction batch",
        label="table extraction batch",
        runner="table_extraction_batch",
        job_runner="table_extraction_job",
        no_items_message="No uploaded table extraction items are available to continue",
        definition_field="template_id",
        definition_model=TableTemplate,
        definition_not_found="Table template not found",
        # Every page job runs the definition captured when the batch was created.
        extra_job_fields=lambda batch: {"template_version": batch.template_version, "definition_snapshot": batch.definition_snapshot},
        new_batch_fields=lambda definition: {"template_version": definition.current_version, "definition_snapshot": definition.definition_json},
    ),
}

SPEC_BY_ITEM_MODEL = {spec.item_model: spec for spec in BATCH_SPECS.values()}
SPEC_BY_JOB_MODEL = {spec.job_model: spec for spec in BATCH_SPECS.values()}


# --- lookups --------------------------------------------------------------------------------


def get_batch(kind: ModuleKind, batch_id: str, db: Session) -> Any:
    spec = BATCH_SPECS[kind]
    batch = db.get(spec.batch_model, batch_id)
    ensure_found(batch, spec.not_found)
    return batch


def _get_definition(spec: ModuleBatchSpec, definition_id: str, db: Session) -> Any:
    definition = db.get(spec.definition_model, definition_id)
    if not definition or (spec.definition_archivable and definition.archived):
        raise NotFoundError(spec.definition_not_found)
    return definition


def _definition_metadata(spec: ModuleBatchSpec, batch: Any) -> dict[str, Any]:
    return {spec.definition_field: getattr(batch, spec.definition_field)} if spec.definition_field else {}


def _new_batch(spec: ModuleBatchSpec, definition: Any, status: BatchStatus, total_count: int) -> Any:
    kwargs: dict[str, Any] = {}
    if spec.definition_field:
        kwargs[spec.definition_field] = definition.id
        kwargs.update(spec.new_batch_fields(definition))
    return spec.batch_model(status=status, total_count=total_count, **kwargs)


def _add_job_and_item(
    spec: ModuleBatchSpec,
    batch: Any,
    document: Document,
    *,
    page_number: int | None,
    status: str,
    upload_index: int | None,
    client_file_id: str | None,
    error_message: str | None = None,
    completed_at: Any = None,
    db: Session,
) -> tuple[Any, Any]:
    job_fields = {**_definition_metadata(spec, batch), **spec.extra_job_fields(batch)}
    job = spec.job_model(
        document_id=document.id,
        page_number=page_number,
        status=status,
        error_message=error_message,
        completed_at=completed_at,
        **job_fields,
    )
    db.add(job)
    db.flush()
    item = spec.item_model(
        batch_id=batch.id,
        document_id=document.id,
        job_id=job.id,
        filename=document.filename,
        upload_index=upload_index,
        client_file_id=client_file_id,
    )
    if spec.per_page:
        item.page_number = page_number
    db.add(item)
    return job, item


# --- page expansion -------------------------------------------------------------------------


def expand_item_pages(spec: ModuleBatchSpec, batch: Any, item: Any, db: Session) -> list[Any]:
    """Split a placeholder item (``page_number is None``) of a now-ready document into one item per page.

    The placeholder becomes page 1 and keeps its job; pages 2..N get new jobs with the same
    status. ``batch.total_count`` grows accordingly. Returns the jobs that were added.
    """
    if not spec.per_page or item.job is None:
        return []
    document = item.document or db.get(Document, item.document_id)
    page_numbers = expandable_page_numbers(document, item.page_number, db)
    if not page_numbers:
        return []
    job = item.job
    item.page_number = page_numbers[0]
    job.page_number = page_numbers[0]
    added: list[Any] = []
    for page_number in page_numbers[1:]:
        new_job, _ = _add_job_and_item(
            spec,
            batch,
            document,
            page_number=page_number,
            status=job.status,
            upload_index=item.upload_index,
            client_file_id=item.client_file_id,
            db=db,
        )
        added.append(new_job)
    batch.total_count = (batch.total_count or 0) + len(added)
    db.flush()
    return added


_STANDALONE_COPIED_FIELDS = (
    "schema_id",
    "schema_version",
    "classifier_id",
    "checklist_id",
    "template_id",
    "template_version",
    "definition_snapshot",
    "table_keys",
)


def expand_standalone_job_pages(spec: ModuleBatchSpec, job: Any, db: Session) -> list[Any]:
    """Split a placeholder job that belongs to no batch (single-job endpoint) into one job per page."""
    if not spec.per_page:
        return []
    document = db.get(Document, job.document_id)
    page_numbers = expandable_page_numbers(document, job.page_number, db)
    if not page_numbers:
        return []
    job.page_number = page_numbers[0]
    copied = {name: getattr(job, name) for name in _STANDALONE_COPIED_FIELDS if hasattr(job, name)}
    added = [spec.job_model(document_id=job.document_id, page_number=page_number, status=job.status, **copied) for page_number in page_numbers[1:]]
    db.add_all(added)
    db.flush()
    return added


def _expand_queued_placeholders(spec: ModuleBatchSpec, batch: Any, db: Session) -> None:
    for item in list(batch.items):
        if item.job and item.job.status == ModuleJobStatus.QUEUED and getattr(item, "page_number", 0) is None:
            expand_item_pages(spec, batch, item, db)
    db.flush()
    db.expire(batch, ["items"])


# --- create from library documents ----------------------------------------------------------


def build_batch_from_documents(
    kind: ModuleKind, definition: Any, documents: list[Document], db: Session
) -> tuple[Any, list[str]]:
    """Create a running batch with one job per page (per document for rotation). Returns (batch, ready job ids)."""
    spec = BATCH_SPECS[kind]
    batch = _new_batch(spec, definition, BatchStatus.RUNNING, 0)
    db.add(batch)
    db.flush()
    ready_job_ids: list[str] = []
    waiting_count = 0
    item_count = 0
    for index, document in enumerate(documents):
        admission = execution_job_status_for_document(document)
        error_message = None
        completed_at = None
        if admission == JobAdmission.BLOCKED:
            status = ModuleJobStatus.FAILED
            error_message = document_not_executable_message(document)
            completed_at = utcnow()
        else:
            status = str(admission)
        slots = page_slots(document, db) if spec.per_page and admission == JobAdmission.READY else [None]
        for page_number in slots:
            job, _ = _add_job_and_item(
                spec,
                batch,
                document,
                page_number=page_number,
                status=status,
                upload_index=index,
                client_file_id=f"library:{document.id}",
                error_message=error_message,
                completed_at=completed_at,
                db=db,
            )
            item_count += 1
            if admission == JobAdmission.READY:
                ready_job_ids.append(job.id)
            elif admission == JobAdmission.WAITING_FOR_DOCUMENT:
                waiting_count += 1
    batch.total_count = item_count
    if not ready_job_ids and not waiting_count:
        BatchLifecycle(batch).finish_without_executable_jobs(utcnow())
    log_audit_event(
        db,
        entity_type=spec.entity_type,
        entity_id=batch.id,
        action="created_from_documents",
        message=f"Created {spec.label} from {len(documents)} library document(s) ({item_count} unit(s))",
        metadata={**_definition_metadata(spec, batch), "ready_count": len(ready_job_ids), "waiting_count": waiting_count},
    )
    db.commit()
    db.refresh(batch)
    return batch, ready_job_ids


def create_batch_from_documents(kind: ModuleKind, definition_id: str | None, document_ids: list[str], db: Session) -> tuple[Any, JobDispatch | None]:
    spec = BATCH_SPECS[kind]
    definition = _get_definition(spec, definition_id or "", db) if spec.definition_field else None
    documents = documents_for_selection(document_ids, db)
    batch, ready_job_ids = build_batch_from_documents(kind, definition, documents, db)
    response = module_batch_read(kind, batch)
    dispatch = JobDispatch(spec.runner, (response.id, ready_job_ids)) if ready_job_ids else None
    return response, dispatch


# --- uploads --------------------------------------------------------------------------------


def init_batch(kind: ModuleKind, definition_id: str, total_count: int, db: Session) -> Any:
    """Create an empty batch that receives ``total_count`` files in chunks (``append_uploads``)."""
    spec = BATCH_SPECS[kind]
    definition = _get_definition(spec, definition_id, db)
    validate_declared_batch_file_count(total_count)
    batch = _new_batch(spec, definition, BatchStatus.UPLOADING, total_count)
    db.add(batch)
    db.flush()
    log_audit_event(
        db,
        entity_type=spec.entity_type,
        entity_id=batch.id,
        action="upload_initialized",
        message=f"Initialized {spec.label} upload with {total_count} file(s)",
        metadata={**_definition_metadata(spec, batch), "file_count": total_count},
    )
    db.commit()
    db.refresh(batch)
    return module_batch_read(kind, batch)


def create_batch_from_uploads(kind: ModuleKind, definition_id: str, entries: list[UploadEntry], db: Session) -> tuple[Any, list[str]]:
    """Create a batch, store and preprocess every file, then start it. Returns (response, queued job ids)."""
    spec = BATCH_SPECS[kind]
    files = [file for file, _, _ in entries]
    definition = _get_definition(spec, definition_id, db)
    if not files:
        raise InvalidRequestError("At least one file is required")
    validate_upload_file_count(files)

    batch = _new_batch(spec, definition, BatchStatus.UPLOADING, len(files))
    db.add(batch)
    db.flush()
    log_audit_event(
        db,
        entity_type=spec.entity_type,
        entity_id=batch.id,
        action="created",
        message=f"Created {spec.label} with {len(files)} file(s)",
        metadata={**_definition_metadata(spec, batch), "file_count": len(files)},
    )
    db.commit()
    _append_upload_items(spec, batch, entries, db)
    db.refresh(batch)
    validate_owner_can_start(batch, batch.items)
    BatchLifecycle(batch).start()
    job_ids = _queued_job_ids(batch)
    _log_started(spec, batch, job_ids, db)
    db.commit()
    db.refresh(batch)
    return module_batch_read(kind, batch), job_ids


def append_uploads(kind: ModuleKind, batch_id: str, entries: list[UploadEntry], db: Session) -> Any:
    spec = BATCH_SPECS[kind]
    batch = get_batch(kind, batch_id, db)
    if batch.status not in BATCH_UPLOAD_OPEN_STATUSES:
        raise ConflictError(f"{spec.title} already started")
    _append_upload_items(spec, batch, entries, db)
    db.refresh(batch)
    return module_batch_read(kind, batch)


def _append_upload_items(spec: ModuleBatchSpec, batch: Any, entries: list[UploadEntry], db: Session) -> None:
    entries = filter_new_upload_entries(db, spec.item_model, "batch_id", batch.id, entries)
    ensure_upload_append_capacity(db, spec.item_model, "batch_id", batch.id, batch.total_count, len(entries))

    for file, client_file_id, upload_index in entries:
        try:
            db.refresh(batch)
            if not owner_accepts_uploads(batch):
                continue
            document, original_path = create_uploaded_document(file, db)
            job, item = _add_job_and_item(
                spec,
                batch,
                document,
                page_number=None,
                status=ModuleJobStatus.PREPROCESSING,
                upload_index=upload_index,
                client_file_id=client_file_id,
                db=db,
            )
            log_audit_event(
                db,
                entity_type="document",
                entity_id=document.id,
                action="uploaded",
                message=f"Batch uploaded {document.filename}",
                metadata={"batch_id": batch.id, "filename": document.filename},
            )
            db.commit()

            ok = preprocess_document_pages(document, original_path, db, raise_errors=False)
            db.refresh(batch)
            if not owner_accepts_uploads(batch):
                db.rollback()
                continue
            if ok:
                ModuleJobLifecycle(job).mark_queued()
                added = expand_item_pages(spec, batch, item, db)
                log_audit_event(
                    db,
                    entity_type=spec.job_entity_type,
                    entity_id=job.id,
                    action="queued",
                    message=f"Queued {spec.label} job(s) for {1 + len(added)} page(s)",
                    metadata={"batch_id": batch.id, "document_id": document.id, **_definition_metadata(spec, batch)},
                )
            else:
                ModuleJobLifecycle(job).fail(document.error_message, utcnow())
            db.commit()
        except Exception as exc:
            db.rollback()
            _record_failed_upload_item(spec, batch, file, client_file_id, upload_index, upload_failure_message(exc), db)
        finally:
            close_upload(file)


def _record_failed_upload_item(
    spec: ModuleBatchSpec,
    batch: Any,
    file: UploadedFile,
    client_file_id: str | None,
    upload_index: int | None,
    message: str,
    db: Session,
) -> None:
    document = create_failed_upload_document(file, message, db)
    job, _ = _add_job_and_item(
        spec,
        batch,
        document,
        page_number=None,
        status=ModuleJobStatus.FAILED,
        upload_index=upload_index,
        client_file_id=client_file_id,
        error_message=message,
        completed_at=utcnow(),
        db=db,
    )
    log_audit_event(db, entity_type=spec.job_entity_type, entity_id=job.id, action="failed", message=message, metadata={"batch_id": batch.id})
    db.commit()


# --- execution control ----------------------------------------------------------------------


def _queued_job_ids(batch: Any) -> list[str]:
    return [item.job_id for item in batch.items if item.job and item.job.status == ModuleJobStatus.QUEUED]


def _log_started(spec: ModuleBatchSpec, batch: Any, job_ids: list[str], db: Session) -> None:
    log_audit_event(
        db,
        entity_type=spec.entity_type,
        entity_id=batch.id,
        action="started",
        message=f"Started {spec.label} with {len(job_ids)} queued job(s)",
        metadata={**_definition_metadata(spec, batch), "queued_count": len(job_ids)},
    )


def start_batch(kind: ModuleKind, batch_id: str, db: Session) -> tuple[Any, JobDispatch | None]:
    spec = BATCH_SPECS[kind]
    batch = get_batch(kind, batch_id, db)
    if batch.status not in BATCH_UPLOAD_OPEN_STATUSES:
        return module_batch_read(kind, batch), None
    validate_owner_can_start(batch, batch.items)
    _expand_queued_placeholders(spec, batch, db)
    BatchLifecycle(batch).start()
    job_ids = _queued_job_ids(batch)
    _log_started(spec, batch, job_ids, db)
    db.commit()
    db.refresh(batch)
    return module_batch_read(kind, batch), JobDispatch(spec.runner, (batch.id, job_ids))


def resume_batch(kind: ModuleKind, batch_id: str, db: Session) -> tuple[Any, JobDispatch | None]:
    spec = BATCH_SPECS[kind]
    batch = get_batch(kind, batch_id, db)
    if batch.status in BATCH_TERMINAL_STATUSES:
        raise ConflictError(f"{spec.title} is already terminal")
    if not batch.items:
        raise UnprocessableError(spec.no_items_message)
    validate_owner_upload_complete(batch, batch.items)
    prepare_job_batch_resume(batch.items)
    _expand_queued_placeholders(spec, batch, db)
    job_ids = _queued_job_ids(batch)
    BatchLifecycle(batch).resume(has_queued_jobs=bool(job_ids), idle_status=module_batch_read(kind, batch).status)
    log_audit_event(
        db,
        entity_type=spec.entity_type,
        entity_id=batch.id,
        action="resumed",
        message=f"Continued {spec.label} with {len(job_ids)} queued job(s)",
        metadata={**_definition_metadata(spec, batch), "queued_count": len(job_ids)},
    )
    db.commit()
    db.refresh(batch)
    response = module_batch_read(kind, batch)
    return response, JobDispatch(spec.runner, (batch.id, job_ids)) if job_ids else None


def discard_batch(kind: ModuleKind, batch_id: str, db: Session) -> Any:
    spec = BATCH_SPECS[kind]
    batch = get_batch(kind, batch_id, db)
    discarded_count = discard_batch_items(batch, db)
    BatchLifecycle(batch).discard(utcnow())
    log_audit_event(
        db,
        entity_type=spec.entity_type,
        entity_id=batch.id,
        action="discarded",
        message=f"Discarded {spec.label} payloads for {discarded_count} item(s)",
        metadata={**_definition_metadata(spec, batch), "discarded_count": discarded_count},
    )
    db.commit()
    db.refresh(batch)
    return module_batch_read(kind, batch)


def cancel_batch(kind: ModuleKind, batch_id: str, db: Session) -> Any:
    spec = BATCH_SPECS[kind]
    batch = get_batch(kind, batch_id, db)
    cancel_module_batch(batch, spec.entity_type, db)
    db.commit()
    db.refresh(batch)
    return module_batch_read(kind, batch)


def cancel_module_batch(batch: Any, entity_type: str, db: Session) -> None:
    canceled_count = 0
    now = utcnow()
    for item in batch.items:
        if item.job and item.job.status in MODULE_JOB_PENDING_STATUSES:
            ModuleJobLifecycle(item.job).cancel("Canceled by user", now)
            canceled_count += 1
    if canceled_count:
        lifecycle = BatchLifecycle(batch)
        lifecycle.close_if_all_jobs_terminal(now)
        lifecycle.request_cancel()
        action = "cancel_requested"
        message = f"Cancel requested for {canceled_count} running or queued job(s)"
        metadata = {"canceled_count": canceled_count}
    else:
        action = "cancel_skipped"
        message = "No running or queued batch jobs to cancel"
        metadata = {}
    log_audit_event(db, entity_type=entity_type, entity_id=batch.id, action=action, message=message, metadata=metadata)


def prepare_job_batch_resume(items: list[Any]) -> None:
    now = utcnow()
    for item in items:
        job = item.job
        document = item.document
        if not job:
            continue
        if job.status == ModuleJobStatus.QUEUED:
            continue
        if job.status not in {ModuleJobStatus.RUNNING, ModuleJobStatus.PREPROCESSING}:
            continue
        if document and document.status == DocumentStatus.READY and document.pages:
            ModuleJobLifecycle(job).requeue()
        else:
            ModuleJobLifecycle(job).fail(document.error_message if document else "Document preprocessing was interrupted", now)


def discard_batch_items(batch: Any, db: Session) -> int:
    items = list(batch.items)
    document_ids = [item.document_id for item in items]
    for item in items:
        db.delete(item)
    delete_document_payloads(document_ids, db)
    return len(items)


# --- reads ----------------------------------------------------------------------------------


def module_batch_read(kind: ModuleKind, batch: Any, *, include_items: bool = True, db: Session | None = None) -> Any:
    spec = BATCH_SPECS[kind]
    if include_items or db is None:
        items = [_item_read(spec, item) for item in sorted_module_items(batch.items)]
        counters = _owner_counters(batch.total_count, [item.status for item in items], batch.status)
    else:
        items = []
        counters = _owner_counters_from_status_counts(batch.total_count, _status_counts(db, spec, batch.id), batch.status)
    fields: dict[str, Any] = {
        "id": batch.id,
        "total_count": batch.total_count,
        **counters,
        "items": items if include_items else [],
        "created_at": batch.created_at,
        "completed_at": batch.completed_at,
    }
    if spec.definition_field:
        fields[spec.definition_field] = getattr(batch, spec.definition_field)
    if spec.kind == ModuleKind.TABLE:
        fields["template_version"] = batch.template_version
    if spec.kind == ModuleKind.ROTATION:
        fields["items"] = items
        fields["corrected_page_count"] = (
            sum(item.corrected_page_count for item in items) if include_items or db is None else _rotation_corrected_count(db, batch.id)
        )
    return spec.read_model(**fields)


def _item_read(spec: ModuleBatchSpec, item: Any) -> Any:
    job = item.job
    fields: dict[str, Any] = {
        "id": item.id,
        "document_id": item.document_id,
        "job_id": item.job_id,
        "filename": item.filename,
        "upload_index": item.upload_index,
        "status": job.status if job else "unknown",
        "error_message": job.error_message if job else None,
        "created_at": item.created_at,
    }
    if spec.kind == ModuleKind.ROTATION:
        fields["corrected_page_count"] = job.corrected_page_count if job else 0
        fields["pages"] = [RotationPageResultRead(**page) for page in rotation_job_pages(job)] if job else []
    else:
        fields["page_number"] = item.page_number
        fields["result_id"] = job.result_id if job else None
    return spec.item_read_model(**fields)


def _rotation_corrected_count(db: Session, batch_id: str) -> int:
    return int(
        db.query(func.coalesce(func.sum(RotationJob.corrected_page_count), 0))
        .join(RotationBatchItem, RotationBatchItem.job_id == RotationJob.id)
        .filter(RotationBatchItem.batch_id == batch_id)
        .scalar()
        or 0
    )


def _status_counts(db: Session, spec: ModuleBatchSpec, batch_id: str) -> dict[str, int]:
    item_model, job_model = spec.item_model, spec.job_model
    rows = (
        db.query(job_model.status, func.count(item_model.id))
        .select_from(item_model)
        .join(job_model, item_model.job_id == job_model.id)
        .filter(item_model.batch_id == batch_id)
        .group_by(job_model.status)
        .all()
    )
    return {status: int(count) for status, count in rows}


def _owner_counters(total_count: int, statuses: list[str], owner_status: str) -> dict[str, Any]:
    return _owner_counters_from_status_counts(total_count, dict(Counter(statuses)), owner_status)


def _owner_counters_from_status_counts(total_count: int, status_counts: dict[str, int], owner_status: str) -> dict[str, Any]:
    uploaded_count = sum(status_counts.values())
    preprocessing_count = sum(status_counts.get(status, 0) for status in MODULE_JOB_PREPARING_STATUSES)
    queued_count = status_counts.get(ModuleJobStatus.QUEUED, 0)
    running_count = status_counts.get(ModuleJobStatus.RUNNING, 0)
    needs_review_count = status_counts.get(ModuleJobStatus.NEEDS_REVIEW, 0)
    completed_count = sum(status_counts.get(status, 0) for status in MODULE_JOB_SUCCESS_STATUSES)
    failed_count = status_counts.get(ModuleJobStatus.FAILED, 0)
    canceled_count = status_counts.get(ModuleJobStatus.CANCELED, 0)
    finished_count = sum(status_counts.get(status, 0) for status in MODULE_JOB_TERMINAL_STATUSES)
    ready_count = max(0, uploaded_count - preprocessing_count)
    if owner_status in {BatchStatus.CANCELED, BatchStatus.FAILED} and not uploaded_count:
        status = owner_status
        progress_phase = owner_status
    elif total_count and finished_count >= total_count:
        if canceled_count == total_count:
            status = BatchStatus.CANCELED
        elif failed_count or canceled_count:
            status = BatchStatus.COMPLETED_WITH_ERRORS
        else:
            status = BatchStatus.COMPLETED
        progress_phase = status
    elif uploaded_count < total_count:
        status = BatchStatus.UPLOADING
        progress_phase = "uploading"
    elif preprocessing_count:
        status = BatchStatus.PREPROCESSING
        progress_phase = "preprocessing"
    elif running_count or owner_status == BatchStatus.RUNNING:
        status = BatchStatus.RUNNING
        progress_phase = "running"
    elif canceled_count:
        status = BatchStatus.CANCELING
        progress_phase = "running"
    elif queued_count:
        status = BatchStatus.QUEUED
        progress_phase = "queued"
    else:
        status = owner_status
        progress_phase = owner_status
    progress = finished_count / total_count if total_count else 0
    return {
        "status": status,
        "uploaded_count": uploaded_count,
        "preprocessing_count": preprocessing_count,
        "ready_count": ready_count,
        "queued_count": queued_count,
        "running_count": running_count,
        "completed_count": completed_count,
        "failed_count": failed_count,
        "canceled_count": canceled_count,
        "needs_review_count": needs_review_count,
        "progress_phase": progress_phase,
        "progress": progress,
    }


# Named readers kept for callers that know their batch type (exports, routers).
def batch_read(batch: Batch, *, include_items: bool = True, db: Session | None = None) -> BatchRead:
    return module_batch_read(ModuleKind.KIE, batch, include_items=include_items, db=db)


def classification_batch_read(batch: ClassificationBatch, *, include_items: bool = True, db: Session | None = None) -> ClassificationBatchRead:
    return module_batch_read(ModuleKind.CLASSIFICATION, batch, include_items=include_items, db=db)


def required_field_batch_read(
    batch: RequiredFieldCheckBatch, *, include_items: bool = True, db: Session | None = None
) -> RequiredFieldCheckBatchRead:
    return module_batch_read(ModuleKind.REQUIRED_CHECK, batch, include_items=include_items, db=db)


def rotation_batch_read(batch: RotationBatch, *, include_items: bool = True, db: Session | None = None) -> RotationBatchRead:
    return module_batch_read(ModuleKind.ROTATION, batch, include_items=include_items, db=db)


def table_extraction_batch_read(
    batch: TableExtractionBatch, *, include_items: bool = True, db: Session | None = None
) -> TableExtractionBatchRead:
    return module_batch_read(ModuleKind.TABLE, batch, include_items=include_items, db=db)
