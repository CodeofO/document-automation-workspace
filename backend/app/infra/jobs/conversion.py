"""Library document conversion (job kind ``document_conversion``) and the work that waited for it."""

from app.application.batches import BATCH_SPECS, expand_item_pages, expand_standalone_job_pages
from app.application.dispatch import JobDispatch
from app.application.documents import preprocess_document_pages
from app.application.workflow_runs import expand_workflow_item_pages
from app.audit import log_audit_event
from app.background_jobs import dispatch_jobs
from app.core.clock import utcnow
from app.core.db import SessionLocal
from app.document_processor import DocumentProcessingError
from app.domain.module_job import ModuleJobLifecycle
from app.domain.status import (
    CONVERSION_JOB_ACTIVE_STATUSES,
    BatchStatus,
    ConversionJobStatus,
    DocumentStatus,
    ModuleJobStatus,
    WorkflowRunItemStatus,
    WorkflowRunStatus,
)
from app.domain.workflow_run import WorkflowRunItemLifecycle
from app.models import Document, DocumentConversionJob, WorkflowRunItem
from app.storage import materialize_storage_ref


def run_document_conversion_job(job_id: str) -> None:
    """Job entry point (``document_conversion``): rasterise the document into page images."""
    db = SessionLocal()
    document_id: str | None = None
    try:
        job = db.get(DocumentConversionJob, job_id)
        if not job or job.status not in CONVERSION_JOB_ACTIVE_STATUSES:
            return
        document = db.get(Document, job.document_id)
        if not document or document.status == DocumentStatus.DELETED:
            job.status = ConversionJobStatus.CANCELED
            job.completed_at = utcnow()
            db.commit()
            return
        document_id = document.id
        now = utcnow()
        job.status = ConversionJobStatus.RUNNING
        job.started_at = job.started_at or now
        job.attempts = (job.attempts or 0) + 1
        document.status = DocumentStatus.PREPROCESSING
        document.error_message = None
        db.commit()

        original_path = materialize_storage_ref(document.storage_path)
        if not original_path.exists():
            raise DocumentProcessingError("Original document file is missing", status_code=404)
        preprocess_document_pages(document, original_path, db, raise_errors=True)
        job.status = ConversionJobStatus.COMPLETED
        job.error_message = None
        job.completed_at = utcnow()
        log_audit_event(
            db,
            entity_type="document",
            entity_id=document.id,
            action="ready",
            message=f"Document conversion completed for {document.filename}",
            metadata={"conversion_job_id": job.id, "page_count": document.page_count},
        )
        db.commit()
    except DocumentProcessingError as exc:
        db.rollback()
        mark_document_conversion_failed(job_id, str(exc))
    except Exception:
        db.rollback()
        mark_document_conversion_failed(job_id, "Failed to process uploaded document")
    finally:
        db.close()
    if document_id:
        activate_ready_document_waiters(document_id)


def mark_document_conversion_failed(job_id: str, message: str) -> None:
    db = SessionLocal()
    try:
        job = db.get(DocumentConversionJob, job_id)
        if not job:
            return
        document = db.get(Document, job.document_id)
        job.status = ConversionJobStatus.FAILED
        job.error_message = message
        job.completed_at = utcnow()
        if document and document.status != DocumentStatus.DELETED:
            document.status = DocumentStatus.FAILED
            document.error_message = message
        log_audit_event(
            db,
            entity_type="document_conversion_job",
            entity_id=job.id,
            action="failed",
            message=message,
            metadata={"document_id": job.document_id},
        )
        db.commit()
    finally:
        db.close()


def activate_ready_document_waiters(document_id: str) -> None:
    """Queue the work that waited for ``document_id`` to finish converting.

    Placeholder units (``page_number is None``) are expanded into one unit per page first, so a
    multi-page document fans out into page jobs/items exactly like a document that was ready
    when the batch or run was created.
    """
    batch_dispatch: dict[tuple[str, str], list[str]] = {}
    job_dispatch: list[tuple[str, str]] = []
    workflow_runs: list[tuple[str, int]] = []
    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        if not document or document.status != DocumentStatus.READY:
            return

        for spec in BATCH_SPECS.values():
            waiting = (
                db.query(spec.job_model)
                .filter(spec.job_model.document_id == document_id, spec.job_model.status == ModuleJobStatus.WAITING_FOR_DOCUMENT)
                .all()
            )
            for job in waiting:
                ModuleJobLifecycle(job).mark_queued()
                item = db.query(spec.item_model).filter(spec.item_model.job_id == job.id).one_or_none()
                if item:
                    added = expand_item_pages(spec, item.batch, item, db) if item.batch else []
                    if item.batch and item.batch.status == BatchStatus.RUNNING:
                        batch_dispatch.setdefault((spec.runner, item.batch_id), []).extend([job.id, *(new.id for new in added)])
                elif spec.job_runner:
                    added = expand_standalone_job_pages(spec, job, db)
                    job_dispatch.extend((spec.job_runner, job_id) for job_id in [job.id, *(new.id for new in added)])

        for item in (
            db.query(WorkflowRunItem)
            .filter(WorkflowRunItem.document_id == document_id, WorkflowRunItem.status == WorkflowRunItemStatus.WAITING_FOR_DOCUMENT)
            .all()
        ):
            run = item.run
            if not run or run.status != WorkflowRunStatus.RUNNING:
                continue
            WorkflowRunItemLifecycle(item).mark_queued(execution_generation=run.execution_generation)
            expand_workflow_item_pages(run, item, db)
            workflow_runs.append((run.id, run.execution_generation))

        db.commit()
    finally:
        db.close()

    dispatch_jobs(
        [
            *(JobDispatch(runner, (batch_id, job_ids)) for (runner, batch_id), job_ids in batch_dispatch.items()),
            *(JobDispatch(runner, (job_id,)) for runner, job_id in job_dispatch),
            *(JobDispatch("workflow_run", (run_id, generation)) for run_id, generation in sorted(set(workflow_runs))),
        ]
    )
