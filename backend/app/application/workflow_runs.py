import copy
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy.orm import Session

from app.application.documents import (
    create_failed_upload_document,
    create_failed_upload_document_record,
    create_uploaded_document,
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
    duration_ms,
    ensure_upload_append_capacity,
    filter_new_upload_entries,
    owner_accepts_uploads,
    sorted_workflow_items,
    upload_failure_message,
    validate_declared_batch_file_count,
    validate_owner_can_start,
    validate_owner_upload_complete,
    validate_upload_file_count,
)
from app.audit import log_audit_event
from app.core.clock import utcnow
from app.core.errors import ConflictError, InvalidRequestError, NotFoundError, UnprocessableError, ensure_found
from app.domain.module_job import ModuleJobLifecycle
from app.domain.status import (
    WORKFLOW_ITEM_RETRY_BLOCKING_STATUSES,
    WORKFLOW_RUN_ENQUEUE_BLOCKED_STATUSES,
    WORKFLOW_RUN_QUEUE_FINISHED_STATUSES,
    WORKFLOW_RUN_STARTABLE_STATUSES,
    WORKFLOW_RUN_TERMINAL_STATUSES,
    WORKFLOW_RUN_UPLOAD_OPEN_STATUSES,
    DocumentStatus,
    JobAdmission,
    ModuleJobStatus,
    WorkflowRunItemStatus,
    WorkflowRunStatus,
)
from app.domain.workflow_run import WorkflowRunItemLifecycle, WorkflowRunLifecycle
from app.infra.persistence.repositories import SqlAlchemyWorkflowRunRepository
from app.models import (
    ClassificationJob,
    Document,
    ExtractionJob,
    RequiredFieldCheckJob,
    TableExtractionJob,
    WorkflowDefinition,
    WorkflowRun,
    WorkflowRunItem,
)
from app.schemas import WorkflowRunRead
from app.workflows import WorkflowDefinitionError, validate_workflow_definition, workflow_run_to_read, workflow_runs_to_read


def create_workflow_run_from_documents(workflow: WorkflowDefinition, documents: list[Document], db: Session) -> tuple[WorkflowRun, bool]:
    now = utcnow()
    run = WorkflowRun(
        workflow_id=workflow.id,
        workflow_name=workflow.name,
        workflow_definition_json=copy.deepcopy(workflow.definition_json),
        status=WorkflowRunStatus.RUNNING,
        total_count=0,
        created_at=now,
        started_at=now,
        inference_started_at=now,
        execution_generation=1,
    )
    db.add(run)
    db.flush()
    has_ready_items = False
    has_waiting_items = False
    for index, document in enumerate(documents):
        admission = execution_job_status_for_document(document)
        item_status: str = admission
        error_message = None
        completed_at = None
        if admission == JobAdmission.BLOCKED:
            item_status = WorkflowRunItemStatus.FAILED
            error_message = document_not_executable_message(document)
            completed_at = now
        elif admission == JobAdmission.READY:
            has_ready_items = True
        else:
            has_waiting_items = True
        # One item per page; a document that is still converting gets a placeholder expanded on activation.
        slots = page_slots(document, db) if admission == JobAdmission.READY else [None]
        for page_number in slots:
            db.add(
                WorkflowRunItem(
                    run_id=run.id,
                    document_id=document.id,
                    page_number=page_number,
                    filename=document.filename,
                    upload_index=index,
                    status=item_status,
                    error_message=error_message,
                    client_file_id=f"library:{document.id}",
                    execution_generation=run.execution_generation,
                    result_json=failed_workflow_item_payload(document.id, document.filename, page_number, error_message),
                    completed_at=completed_at,
                )
            )
            run.total_count += 1
    if not has_ready_items and not has_waiting_items:
        WorkflowRunLifecycle(run).finish_without_queued_items(now)
    log_audit_event(
        db,
        entity_type="workflow_run",
        entity_id=run.id,
        action="created_from_documents",
        message=f"Created workflow run from {len(documents)} library document(s)",
        metadata={"workflow_id": workflow.id, "ready_count": has_ready_items, "waiting_count": has_waiting_items},
    )
    db.commit()
    db.refresh(run)
    return run, has_ready_items


def create_restarted_workflow_run(
    source_run: WorkflowRun,
    workflow: WorkflowDefinition,
    now: datetime,
    db: Session,
) -> tuple[WorkflowRun, int]:
    new_run = WorkflowRun(
        workflow_id=workflow.id,
        workflow_name=workflow.name,
        workflow_definition_json=copy.deepcopy(workflow.definition_json),
        restarted_from_run_id=source_run.id,
        status=WorkflowRunStatus.RUNNING,
        total_count=source_run.total_count,
        created_at=now,
        upload_duration_ms=source_run.upload_duration_ms or workflow_upload_duration_ms(source_run),
        started_at=now,
        inference_started_at=now,
        execution_generation=1,
    )
    db.add(new_run)
    db.flush()

    return new_run, _copy_items_from_run(source_run, new_run, now, db)


def create_waiting_workflow_run(
    source_run: WorkflowRun,
    workflow: WorkflowDefinition,
    now: datetime,
    db: Session,
) -> tuple[WorkflowRun, int]:
    group_id = _ensure_workflow_queue_group(source_run, db)
    queue_order = _next_workflow_queue_order(db, group_id)
    new_run = WorkflowRun(
        workflow_id=workflow.id,
        workflow_name=workflow.name,
        workflow_definition_json=copy.deepcopy(workflow.definition_json),
        workflow_run_group_id=group_id,
        queued_from_run_id=source_run.id,
        queue_order=queue_order,
        status=WorkflowRunStatus.WAITING,
        total_count=source_run.total_count,
        created_at=now,
        upload_duration_ms=source_run.upload_duration_ms or workflow_upload_duration_ms(source_run),
        execution_generation=0,
    )
    db.add(new_run)
    db.flush()

    return new_run, _copy_items_from_run(source_run, new_run, now, db)


def _copy_items_from_run(source_run: WorkflowRun, new_run: WorkflowRun, now: datetime, db: Session) -> int:
    """Give ``new_run`` one item per item of ``source_run`` (same documents). Returns how many are queued."""
    queued_count = 0
    item_count = 0
    for source_item in sorted_workflow_items(source_run.items):
        document = source_item.document or db.get(Document, source_item.document_id)
        ready = bool(document and document.status == DocumentStatus.READY and document.pages)
        status = WorkflowRunItemStatus.QUEUED if ready else WorkflowRunItemStatus.FAILED
        message = (
            None
            if ready
            else (document.error_message if document else source_item.error_message or "Document preprocessing was interrupted")
        )
        # A whole-document item of an older run is split into pages now that the pages are known.
        page_numbers: list[int | None] = (expandable_page_numbers(document, source_item.page_number, db) if ready else []) or [
            source_item.page_number
        ]
        for position, page_number in enumerate(page_numbers):
            result_json = (
                initial_workflow_item_payload(document, page_number)
                if ready and document
                else failed_workflow_item_payload(source_item.document_id, source_item.filename, page_number, message)
            )
            db.add(
                WorkflowRunItem(
                    run_id=new_run.id,
                    document_id=source_item.document_id,
                    page_number=page_number,
                    filename=source_item.filename,
                    upload_index=source_item.upload_index,
                    status=status,
                    error_message=message,
                    client_file_id=source_item.client_file_id,
                    upload_duration_ms=source_item.upload_duration_ms if position == 0 else None,
                    execution_generation=new_run.execution_generation,
                    result_json=result_json,
                    completed_at=None if ready else now,
                )
            )
            item_count += 1
            if ready:
                queued_count += 1
    new_run.total_count = item_count
    return queued_count


def _ensure_workflow_queue_group(run: WorkflowRun, db: Session) -> str:
    group_id = run.workflow_run_group_id or run.id
    run.workflow_run_group_id = group_id
    if run.queue_order is None:
        run.queue_order = 1 if run.id == group_id else _next_workflow_queue_order(db, group_id)
    db.flush()
    return group_id


def _next_workflow_queue_order(db: Session, group_id: str) -> int:
    orders = [
        order
        for (order,) in db.query(WorkflowRun.queue_order).filter(WorkflowRun.workflow_run_group_id == group_id).all()
        if order is not None
    ]
    return max(orders, default=0) + 1


def validate_workflow_enqueue_source(run: WorkflowRun) -> None:
    if run.status not in WORKFLOW_RUN_ENQUEUE_BLOCKED_STATUSES:
        return
    if run.status == WorkflowRunStatus.WAITING:
        detail = "Waiting workflow runs cannot be enqueued again"
    elif run.status == WorkflowRunStatus.CANCELED:
        detail = "Canceled workflow runs cannot be enqueued"
    else:
        detail = "Failed workflow runs cannot be enqueued"
    raise ConflictError(detail)


def validate_waiting_workflow_run_can_start(run: WorkflowRun, db: Session) -> None:
    group_id = run.workflow_run_group_id or run.id
    first_waiting = (
        db.query(WorkflowRun)
        .filter(WorkflowRun.workflow_run_group_id == group_id, WorkflowRun.status == WorkflowRunStatus.WAITING)
        .order_by(WorkflowRun.queue_order.asc(), WorkflowRun.created_at.asc(), WorkflowRun.id.asc())
        .first()
    )
    if not first_waiting or first_waiting.id != run.id:
        raise ConflictError("Only the first waiting workflow run can be started")

    run_position = _workflow_queue_position(run)
    active_predecessors = [
        candidate
        for candidate in db.query(WorkflowRun).filter(WorkflowRun.workflow_run_group_id == group_id).all()
        if candidate.id != run.id
        and candidate.status not in WORKFLOW_RUN_TERMINAL_STATUSES
        and _workflow_queue_position(candidate) < run_position
    ]
    if active_predecessors:
        raise ConflictError("Previous workflow runs in this queue are still active")


def _workflow_queue_position(run: WorkflowRun) -> tuple[int, datetime, str]:
    return (run.queue_order if run.queue_order is not None else 0, run.created_at or datetime.min, run.id)


def cancel_waiting_workflow_run(run: WorkflowRun, db: Session) -> None:
    now = utcnow()
    message = "Removed from workflow run queue"
    canceled_count = WorkflowRunLifecycle(run).cancel_waiting(now, message=message)
    log_audit_event(
        db,
        entity_type="workflow_run",
        entity_id=run.id,
        action="queue_canceled",
        message=f"Canceled waiting workflow run with {canceled_count} queued item(s)",
        metadata={"workflow_id": run.workflow_id, "queue_group_id": run.workflow_run_group_id, "queue_order": run.queue_order},
    )


def stop_workflow_run_without_deleting_documents(run: WorkflowRun, message: str, db: Session) -> None:
    now = utcnow()
    accumulate_workflow_run_inference_duration(run, now)
    stopped_count = WorkflowRunLifecycle(run).stop_without_deleting_documents(
        now,
        message=message,
        cancel_active_job=lambda item: cancel_workflow_item_active_jobs(item, db, now, message),
    )
    log_audit_event(
        db,
        entity_type="workflow_run",
        entity_id=run.id,
        action="stopped",
        message=f"Stopped workflow run without deleting uploaded documents; {stopped_count} active item(s) canceled",
        metadata={
            "workflow_id": run.workflow_id,
            "queue_group_id": run.workflow_run_group_id,
            "queue_order": run.queue_order,
            "stopped_count": stopped_count,
        },
    )


def cancel_workflow_item_active_jobs(item: WorkflowRunItem, db: Session, now: datetime, message: str) -> None:
    payload = item.result_json
    if not isinstance(payload, dict):
        return
    node_results = payload.get("node_results")
    if not isinstance(node_results, dict):
        return
    for node_result in node_results.values():
        if not isinstance(node_result, dict):
            continue
        job_id = node_result.get("job_id")
        kind = node_result.get("kind")
        if not isinstance(job_id, str):
            continue
        if kind == "classifier":
            job = db.get(ClassificationJob, job_id)
            entity_type = "classification_job"
        elif kind == "kie":
            job = db.get(ExtractionJob, job_id)
            entity_type = "extraction_job"
        elif kind == "required-checker":
            job = db.get(RequiredFieldCheckJob, job_id)
            entity_type = "required_field_check_job"
        elif kind == "table":
            job = db.get(TableExtractionJob, job_id)
            entity_type = "table_extraction_job"
        else:
            continue
        if not job or job.status in {
            ModuleJobStatus.COMPLETED,
            ModuleJobStatus.NEEDS_REVIEW,
            ModuleJobStatus.FAILED,
            ModuleJobStatus.CANCELED,
        }:
            continue
        ModuleJobLifecycle(job).cancel(message, now)
        log_audit_event(
            db,
            entity_type=entity_type,
            entity_id=job.id,
            action="canceled",
            message=message,
            metadata={"workflow_run_id": item.run_id, "workflow_run_item_id": item.id},
        )


def workflow_upload_duration_ms(run: WorkflowRun) -> int | None:
    durations = [item.upload_duration_ms for item in run.items if item.upload_duration_ms is not None]
    if not durations:
        return None
    return sum(durations)


def accumulate_workflow_run_inference_duration(run: WorkflowRun, ended_at: datetime) -> None:
    if not run.inference_started_at:
        return
    run.inference_duration_ms = (run.inference_duration_ms or 0) + duration_ms(run.inference_started_at, ended_at)
    run.inference_started_at = None


def initial_workflow_item_payload(document: Document, page_number: int | None = None) -> dict[str, Any]:
    return {"document_id": document.id, "page_number": page_number, "filename": document.filename, "node_results": {}}


def failed_workflow_item_payload(document_id: str, filename: str, page_number: int | None, message: str | None) -> dict[str, Any]:
    return {"document_id": document_id, "page_number": page_number, "filename": filename, "node_results": {}, "error_message": message}


def expand_workflow_item_pages(run: WorkflowRun, item: WorkflowRunItem, db: Session) -> list[WorkflowRunItem]:
    """Split a placeholder item (``page_number is None``) of a now-ready document into one item per page.

    The placeholder becomes page 1; pages 2..N are new items with the same status and execution
    generation. ``run.total_count`` grows accordingly. Returns the items that were added.
    """
    document = item.document or db.get(Document, item.document_id)
    page_numbers = expandable_page_numbers(document, item.page_number, db)
    if not page_numbers or document is None:
        return []
    item.page_number = page_numbers[0]
    payload = item.result_json if isinstance(item.result_json, dict) else {}
    item.result_json = {**payload, "page_number": page_numbers[0]}
    added: list[WorkflowRunItem] = []
    for page_number in page_numbers[1:]:
        clone = WorkflowRunItem(
            run_id=run.id,
            document_id=item.document_id,
            page_number=page_number,
            filename=item.filename,
            upload_index=item.upload_index,
            status=item.status,
            client_file_id=item.client_file_id,
            execution_generation=item.execution_generation,
            result_json=initial_workflow_item_payload(document, page_number),
        )
        db.add(clone)
        added.append(clone)
    run.total_count = (run.total_count or 0) + len(added)
    db.flush()
    return added


def expand_queued_workflow_placeholders(run: WorkflowRun, db: Session) -> int:
    """Expand every queued whole-document item of ``run`` (legacy rows or interrupted uploads). Returns items added."""
    added = 0
    for item in list(run.items):
        if item.status == WorkflowRunItemStatus.QUEUED and item.page_number is None:
            added += len(expand_workflow_item_pages(run, item, db))
    if added:
        db.expire(run, ["items"])
    return added


def append_workflow_upload_items(run: WorkflowRun, entries: list[UploadEntry], db: Session) -> None:
    entries = filter_new_upload_entries(db, WorkflowRunItem, "run_id", run.id, entries)
    incoming_count = len(entries)
    ensure_upload_append_capacity(db, WorkflowRunItem, "run_id", run.id, run.total_count, incoming_count)

    for file, client_file_id, upload_index in entries:
        upload_started_at = utcnow()
        try:
            db.refresh(run)
            if not owner_accepts_uploads(run):
                continue
            document, original_path = create_uploaded_document(file, db)
            item = WorkflowRunItem(
                run_id=run.id,
                document_id=document.id,
                filename=document.filename,
                upload_index=upload_index,
                status=WorkflowRunItemStatus.PREPROCESSING,
                client_file_id=client_file_id,
                result_json=initial_workflow_item_payload(document),
            )
            db.add(item)
            log_audit_event(
                db,
                entity_type="workflow_run_item",
                entity_id=run.id,
                action="preprocessing",
                message=f"Preprocessing workflow document {document.filename}",
                metadata={"document_id": document.id},
            )
            db.commit()

            ok = preprocess_document_pages(document, original_path, db, raise_errors=False)
            db.refresh(run)
            if not owner_accepts_uploads(run):
                db.rollback()
                continue
            if ok:
                WorkflowRunItemLifecycle(item).mark_uploaded(upload_duration_ms=duration_ms(upload_started_at))
                expand_workflow_item_pages(run, item, db)
                log_audit_event(
                    db,
                    entity_type="workflow_run_item",
                    entity_id=run.id,
                    action="queued",
                    message=f"Queued workflow document {document.filename}",
                    metadata={"document_id": document.id},
                )
            else:
                WorkflowRunItemLifecycle(item).fail(document.error_message, utcnow())
                item.upload_duration_ms = duration_ms(upload_started_at, item.completed_at)
                item.result_json = failed_workflow_item_payload(document.id, document.filename, None, document.error_message)
            db.commit()
        except Exception as exc:
            db.rollback()
            _record_failed_workflow_upload_item(
                run, file, client_file_id, upload_index, duration_ms(upload_started_at), upload_failure_message(exc), db
            )
        finally:
            close_upload(file)


def _record_failed_workflow_upload_item(
    run: WorkflowRun,
    file: UploadedFile,
    client_file_id: str | None,
    upload_index: int | None,
    upload_duration_ms: int | None,
    message: str,
    db: Session,
) -> None:
    document = create_failed_upload_document(file, message, db)
    item = WorkflowRunItem(
        run_id=run.id,
        document_id=document.id,
        filename=document.filename,
        upload_index=upload_index,
        status=WorkflowRunItemStatus.FAILED,
        error_message=message,
        client_file_id=client_file_id,
        upload_duration_ms=upload_duration_ms,
        result_json={"document_id": document.id, "filename": document.filename, "node_results": {}, "error_message": message},
        completed_at=utcnow(),
    )
    db.add(item)
    log_audit_event(
        db,
        entity_type="workflow_run_item",
        entity_id=run.id,
        action="failed",
        message=message,
        metadata={"document_id": document.id},
    )
    db.commit()


def seal_missing_workflow_upload_items(run: WorkflowRun, db: Session) -> int:
    existing_count = db.query(WorkflowRunItem).filter(WorkflowRunItem.run_id == run.id).count()
    missing_count = max(0, run.total_count - existing_count)
    if missing_count == 0:
        return 0
    existing_indexes = {
        row[0]
        for row in db.query(WorkflowRunItem.upload_index)
        .filter(WorkflowRunItem.run_id == run.id, WorkflowRunItem.upload_index.isnot(None))
        .all()
    }
    candidate_indexes = [index for index in range(run.total_count) if index not in existing_indexes]
    if len(candidate_indexes) < missing_count:
        candidate_indexes.extend([None] * (missing_count - len(candidate_indexes)))
    now = utcnow()
    message = "Upload was not received before execution was restarted"
    for ordinal, upload_index in enumerate(candidate_indexes[:missing_count], start=1):
        suffix = upload_index + 1 if upload_index is not None else existing_count + ordinal
        filename = f"missing_upload_{suffix:05d}"
        document = create_failed_upload_document_record(
            filename,
            "application/octet-stream",
            message,
            db,
        )
        db.add(
            WorkflowRunItem(
                run_id=run.id,
                document_id=document.id,
                filename=document.filename,
                upload_index=upload_index,
                status=WorkflowRunItemStatus.FAILED,
                error_message=message,
                client_file_id=f"missing:{run.id}:{upload_index}" if upload_index is not None else None,
                result_json={"document_id": document.id, "filename": document.filename, "node_results": {}, "error_message": message},
                completed_at=now,
            )
        )
    log_audit_event(
        db,
        entity_type="workflow_run",
        entity_id=run.id,
        action="upload_sealed",
        message=f"Marked {missing_count} missing upload slot(s) as failed",
        metadata={"workflow_id": run.workflow_id, "missing_count": missing_count},
    )
    db.flush()
    return missing_count


@dataclass(frozen=True)
class RunDispatch:
    """A run (generation) the caller must hand to the workflow executor after committing."""

    run_id: str
    execution_generation: int


@dataclass(frozen=True)
class RunOutcome:
    run: WorkflowRunRead
    dispatch: RunDispatch | None = None


class WorkflowRunApplicationService:
    """Workflow run use cases. Every run/item status change goes through ``WorkflowRunLifecycle``.

    Methods commit their own unit of work and return the response DTO plus, when the run must
    (re)start executing, a ``RunDispatch`` for the caller to schedule.
    """

    def __init__(self, db: Session) -> None:
        self.db = db
        self.runs = SqlAlchemyWorkflowRunRepository(db)

    # --- lookups ----------------------------------------------------------------------------

    def _get_run(self, run_id: str) -> WorkflowRun:
        run = self.runs.get(run_id)
        ensure_found(run, "Workflow run not found")
        return run

    def _get_executable_workflow(self, workflow_id: str) -> WorkflowDefinition:
        workflow = self.db.get(WorkflowDefinition, workflow_id)
        if not workflow or workflow.archived:
            raise NotFoundError("Workflow not found")
        try:
            validate_workflow_definition(workflow.definition_json or {}, self.db)
        except WorkflowDefinitionError as exc:
            raise UnprocessableError({"errors": exc.errors}) from exc
        return workflow

    def _read(self, run: WorkflowRun) -> WorkflowRunRead:
        return WorkflowRunRead(**workflow_run_to_read(run))

    def get(self, run_id: str) -> WorkflowRunRead:
        return self._read(self._get_run(run_id))

    def get_summary(self, run_id: str) -> WorkflowRunRead:
        run = self._get_run(run_id)
        return WorkflowRunRead(**workflow_run_to_read(run, include_items=False, db=self.db))

    def list_recent(self, limit: int) -> list[WorkflowRunRead]:
        runs = self.runs.list_recent(limit=limit)
        return [WorkflowRunRead(**payload) for payload in workflow_runs_to_read(runs, include_items=False, db=self.db)]

    # --- creation ---------------------------------------------------------------------------

    def _new_upload_run(self, workflow: WorkflowDefinition, total_count: int) -> WorkflowRun:
        run = WorkflowRun(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            workflow_definition_json=copy.deepcopy(workflow.definition_json),
            status=WorkflowRunStatus.UPLOADING,
            total_count=total_count,
            created_at=utcnow(),
        )
        self.db.add(run)
        self.db.flush()
        return run

    def create_from_uploads(self, workflow_id: str, entries: list[UploadEntry]) -> RunOutcome:
        """Create a run, store and preprocess every uploaded file, then start it."""
        db = self.db
        files = [file for file, _, _ in entries]
        workflow = db.get(WorkflowDefinition, workflow_id)
        if not workflow or workflow.archived:
            raise NotFoundError("Workflow not found")
        if not files:
            raise InvalidRequestError("At least one file is required")
        validate_upload_file_count(files)
        workflow = self._get_executable_workflow(workflow_id)

        run = self._new_upload_run(workflow, len(files))
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run.id,
            action="created",
            message=f"Created workflow run with {len(files)} file(s)",
            metadata={"workflow_id": workflow.id, "file_count": len(files)},
        )
        db.commit()
        append_workflow_upload_items(run, entries, db)
        db.refresh(run)
        validate_owner_can_start(run, run.items)
        generation = WorkflowRunLifecycle(run).start(utcnow(), upload_duration_ms=workflow_upload_duration_ms(run))
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run.id,
            action="started",
            message=f"Started workflow run with {run.total_count} file(s)",
            metadata={"workflow_id": run.workflow_id, "file_count": run.total_count},
        )
        db.commit()
        db.refresh(run)
        return RunOutcome(self._read(run), RunDispatch(run.id, generation))

    def init_upload(self, workflow_id: str, total_count: int) -> WorkflowRunRead:
        """Create an empty run that receives its files in chunks (``append_uploads``)."""
        db = self.db
        workflow = db.get(WorkflowDefinition, workflow_id)
        if not workflow or workflow.archived:
            raise NotFoundError("Workflow not found")
        validate_declared_batch_file_count(total_count)
        workflow = self._get_executable_workflow(workflow_id)
        run = self._new_upload_run(workflow, total_count)
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run.id,
            action="upload_initialized",
            message=f"Initialized workflow run upload with {total_count} file(s)",
            metadata={"workflow_id": workflow.id, "file_count": total_count},
        )
        db.commit()
        db.refresh(run)
        return self._read(run)

    def create_from_documents(self, workflow_id: str, document_ids: list[str]) -> RunOutcome:
        workflow = self._get_executable_workflow(workflow_id)
        documents = documents_for_selection(document_ids, self.db)
        run, has_ready_items = create_workflow_run_from_documents(workflow, documents, self.db)
        response = self._read(run)
        dispatch = RunDispatch(run.id, run.execution_generation) if has_ready_items else None
        return RunOutcome(response, dispatch)

    def append_uploads(self, run_id: str, entries: list[UploadEntry]) -> WorkflowRunRead:
        run = self._get_run(run_id)
        if run.status == WorkflowRunStatus.PAUSED and len(run.items) < run.total_count:
            WorkflowRunLifecycle(run).reopen_for_upload()
            self.db.flush()
        if run.status not in WORKFLOW_RUN_UPLOAD_OPEN_STATUSES:
            raise ConflictError("Workflow run already started")
        append_workflow_upload_items(run, entries, self.db)
        self.runs.refresh(run)
        return self._read(run)

    # --- execution control ------------------------------------------------------------------

    def start(self, run_id: str) -> RunOutcome:
        db = self.db
        run = self._get_run(run_id)
        if run.status not in WORKFLOW_RUN_STARTABLE_STATUSES:
            raise ConflictError(f"Workflow run cannot be started from status {run.status}")
        if run.status == WorkflowRunStatus.WAITING:
            validate_waiting_workflow_run_can_start(run, db)
        validate_owner_can_start(run, run.items)
        expand_queued_workflow_placeholders(run, db)
        generation = WorkflowRunLifecycle(run).start(utcnow(), upload_duration_ms=workflow_upload_duration_ms(run))
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run.id,
            action="started",
            message=f"Started workflow run with {run.total_count} item(s)",
            metadata={"workflow_id": run.workflow_id, "item_count": run.total_count},
        )
        db.commit()
        self.runs.refresh(run)
        return RunOutcome(self._read(run), RunDispatch(run.id, generation))

    def enqueue(self, run_id: str, workflow_id: str | None) -> WorkflowRunRead:
        """Queue a new run over the same documents behind ``run_id`` (same queue group)."""
        db = self.db
        source_run = self._get_run(run_id)
        if not source_run.items:
            raise UnprocessableError("No uploaded workflow items are available to enqueue")
        validate_workflow_enqueue_source(source_run)
        workflow = self._get_executable_workflow(workflow_id or source_run.workflow_id)

        validate_owner_can_start(source_run, source_run.items)
        now = utcnow()
        new_run, queued_count = create_waiting_workflow_run(source_run, workflow, now, db)
        if not queued_count:
            WorkflowRunLifecycle(new_run).finish_without_queued_items(now)
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=new_run.id,
            action="queued",
            message=f"Queued workflow run after {source_run.id}",
            metadata={
                "workflow_id": new_run.workflow_id,
                "source_run_id": source_run.id,
                "queue_group_id": new_run.workflow_run_group_id,
                "queue_order": new_run.queue_order,
                "queued_count": queued_count,
            },
        )
        db.commit()
        db.refresh(new_run)
        return self._read(new_run)

    def cancel_waiting(self, run_id: str) -> WorkflowRunRead:
        run = self._get_run(run_id)
        if run.status != WorkflowRunStatus.WAITING:
            raise ConflictError("Workflow run is not waiting in the queue")
        cancel_waiting_workflow_run(run, self.db)
        self.db.commit()
        self.runs.refresh(run)
        return self._read(run)

    def delete_queue_entry(self, run_id: str) -> dict[str, str]:
        db = self.db
        run = self._get_run(run_id)
        if not run.queued_from_run_id:
            raise ConflictError("Only queued workflow run entries can be removed")
        if run.status in WORKFLOW_RUN_QUEUE_FINISHED_STATUSES:
            raise ConflictError("Finished queued workflow runs cannot be removed")
        if run.status == WorkflowRunStatus.WAITING:
            cancel_waiting_workflow_run(run, db)
            db.flush()
        elif run.status != WorkflowRunStatus.CANCELED:
            stop_workflow_run_without_deleting_documents(run, "Stopped and removed from workflow run queue", db)
            db.flush()
        item_count = len(run.items)
        queue_group_id = run.workflow_run_group_id
        queue_order = run.queue_order
        source_run_id = run.queued_from_run_id
        db.delete(run)
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run_id,
            action="queue_entry_deleted",
            message=f"Removed queued workflow run entry with {item_count} item(s); shared documents were kept",
            metadata={
                "queue_group_id": queue_group_id,
                "queue_order": queue_order,
                "source_run_id": source_run_id,
                "removed_item_count": item_count,
            },
        )
        db.commit()
        return {"status": "deleted", "id": run_id}

    def discard(self, run_id: str) -> WorkflowRunRead:
        db = self.db
        run = self._get_run(run_id)
        if run.status in WORKFLOW_RUN_TERMINAL_STATUSES:
            raise ConflictError("Workflow run is already terminal")
        if run.status == WorkflowRunStatus.WAITING:
            cancel_waiting_workflow_run(run, db)
            db.commit()
            self.runs.refresh(run)
            return self._read(run)
        stop_workflow_run_without_deleting_documents(run, "Stopped by user; library documents were kept", db)
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run.id,
            action="discarded",
            message="Stopped workflow run without deleting document library payloads",
            metadata={"workflow_id": run.workflow_id, "kept_document_count": len(run.items)},
        )
        db.commit()
        self.runs.refresh(run)
        return self._read(run)

    def _ensure_controllable(self, run: WorkflowRun) -> None:
        if run.status in WORKFLOW_RUN_TERMINAL_STATUSES:
            raise ConflictError("Workflow run is already terminal")
        if run.status == WorkflowRunStatus.WAITING:
            raise ConflictError("Waiting workflow run must be started or canceled from the queue")

    def resume(self, run_id: str) -> RunOutcome:
        db = self.db
        run = self._get_run(run_id)
        self._ensure_controllable(run)
        if not run.items:
            raise UnprocessableError("No uploaded workflow items are available to continue")
        validate_owner_upload_complete(run, run.items)
        now = utcnow()
        lifecycle = WorkflowRunLifecycle(run)
        queued_count = lifecycle.prepare_resume(now)
        queued_count += expand_queued_workflow_placeholders(run, db)
        generation = lifecycle.finish_resume(now, queued_count=queued_count, fallback_status=workflow_run_to_read(run)["status"])
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run.id,
            action="resumed",
            message=f"Continued workflow run with {queued_count} queued item(s)",
            metadata={"workflow_id": run.workflow_id, "queued_count": queued_count},
        )
        db.commit()
        self.runs.refresh(run)
        return RunOutcome(self._read(run), RunDispatch(run.id, generation) if queued_count else None)

    def pause(self, run_id: str) -> WorkflowRunRead:
        db = self.db
        run = self._get_run(run_id)
        self._ensure_controllable(run)
        if run.status == WorkflowRunStatus.PAUSED:
            return self._read(run)

        now = utcnow()
        paused_count = WorkflowRunLifecycle(run).pause(
            now,
            cancel_active_job=lambda item: cancel_workflow_item_active_jobs(item, db, now, "Paused by user"),
        )
        accumulate_workflow_run_inference_duration(run, now)
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run.id,
            action="paused",
            message=f"Paused workflow run; {paused_count} active item(s) held",
            metadata={"workflow_id": run.workflow_id, "paused_count": paused_count},
        )
        db.commit()
        self.runs.refresh(run)
        return self._read(run)

    def restart(self, run_id: str, workflow_id: str | None) -> RunOutcome:
        """Re-run every document of ``run_id`` as a new run (optionally with another workflow)."""
        db = self.db
        run = self._get_run(run_id)
        if not run.items:
            raise UnprocessableError("No uploaded workflow items are available to restart")
        workflow = self._get_executable_workflow(workflow_id or run.workflow_id)

        sealed_missing_count = seal_missing_workflow_upload_items(run, db)
        if sealed_missing_count:
            db.flush()
            db.expire(run, ["items"])
        validate_owner_upload_complete(run, run.items)
        now = utcnow()
        if run.status not in WORKFLOW_RUN_TERMINAL_STATUSES:
            accumulate_workflow_run_inference_duration(run, now)
            WorkflowRunLifecycle(run).replace_by_restart(now)
        new_run, queued_count = create_restarted_workflow_run(run, workflow, now, db)
        if not queued_count:
            WorkflowRunLifecycle(new_run).finish_without_queued_items(now)
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=new_run.id,
            action="restarted",
            message=f"Created restarted workflow run with {queued_count} queued item(s)",
            metadata={
                "workflow_id": new_run.workflow_id,
                "source_run_id": run.id,
                "queued_count": queued_count,
                "sealed_missing_count": sealed_missing_count,
            },
        )
        db.commit()
        db.refresh(new_run)
        response = self._read(new_run)
        return RunOutcome(response, RunDispatch(new_run.id, new_run.execution_generation) if queued_count else None)

    def retry_failed(self, run_id: str) -> RunOutcome:
        db = self.db
        run = self._get_run(run_id)
        if run.status == WorkflowRunStatus.CANCELED:
            raise ConflictError("Canceled workflow run cannot retry failed items")
        blocking_count = sum(1 for item in run.items if item.status in WORKFLOW_ITEM_RETRY_BLOCKING_STATUSES)
        if blocking_count:
            raise ConflictError(
                {
                    "message": "Failed items can be retried after active or paused items are finished.",
                    "blocking_count": blocking_count,
                }
            )
        failed_count = sum(1 for item in run.items if item.status == WorkflowRunItemStatus.FAILED)
        if not failed_count:
            raise UnprocessableError("No failed workflow items are available to retry")

        now = utcnow()
        accumulate_workflow_run_inference_duration(run, now)
        lifecycle = WorkflowRunLifecycle(run)
        lifecycle.begin_retry_failed()
        queued_count = lifecycle.prepare_retry_failed(
            now, initial_payload=lambda item: initial_workflow_item_payload(item.document, item.page_number)
        )
        queued_count += expand_queued_workflow_placeholders(run, db)
        if not queued_count:
            raise UnprocessableError(
                {
                    "message": "No failed workflow items can be retried because their documents are not ready.",
                    "failed_count": failed_count,
                }
            )
        lifecycle.mark_retry_running(now)
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run.id,
            action="retry_failed",
            message=f"Retried {queued_count} failed workflow item(s)",
            metadata={"workflow_id": run.workflow_id, "queued_count": queued_count, "failed_count": failed_count},
        )
        db.commit()
        self.runs.refresh(run)
        return RunOutcome(self._read(run), RunDispatch(run.id, run.execution_generation))
