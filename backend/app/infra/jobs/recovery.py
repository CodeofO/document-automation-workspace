"""Crash recovery for background work.

* ``prepare_retry`` runs before a job that an earlier, interrupted attempt already started
  (its worker died and the lease expired): the domain rows that attempt left ``running``
  go back to ``queued`` so the entry point picks them up again.
* ``abandon`` fails the domain rows of a job that was interrupted too often.
* ``recover_on_startup`` re-queues the jobs of a dead process and reconciles domain rows
  left ``queued``/``running`` without a live queue entry (e.g. by the previous runtime, which
  kept jobs only in memory): runs, batches, conversions and exports resume; standalone module
  jobs that cannot be resumed fail with a clear message.
"""

import asyncio
import inspect
import logging
from collections.abc import Callable
from typing import Any

from sqlalchemy.orm import Session

from app.application.batches import BATCH_SPECS, _expand_queued_placeholders, _queued_job_ids, prepare_job_batch_resume
from app.application.dispatch import JobDispatch
from app.application.workflow_runs import cancel_workflow_item_active_jobs
from app.audit import log_audit_event
from app.background_jobs import enqueue_jobs, get_job_runners
from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.domain.module_job import ModuleJobLifecycle
from app.domain.status import (
    CONVERSION_JOB_ACTIVE_STATUSES,
    MODULE_JOB_TERMINAL_STATUSES,
    BatchStatus,
    ConversionJobStatus,
    DocumentStatus,
    ExportJobStatus,
    ModuleJobStatus,
    WorkflowRunItemStatus,
    WorkflowRunStatus,
)
from app.domain.workflow_run import WorkflowRunItemLifecycle
from app.infra.jobs import queue
from app.models import (
    ClassificationJob,
    Document,
    DocumentConversionJob,
    ExportJob,
    ExtractionJob,
    RequiredFieldCheckJob,
    RotationJob,
    TableExtractionJob,
    WorkflowRun,
    WorkflowRunItem,
)

logger = logging.getLogger(__name__)

INTERRUPTED_MESSAGE = "Interrupted by a server restart before it finished. Run it again."
RECOVERED_MESSAGE = "Recovered after server restart"

_STANDALONE_JOB_MODELS: dict[str, Any] = {
    "extraction_job": ExtractionJob,
    "classification_job": ClassificationJob,
    "required_check_job": RequiredFieldCheckJob,
    "table_extraction_job": TableExtractionJob,
}
_BATCH_SPECS_BY_KIND = {spec.runner: spec for spec in BATCH_SPECS.values()}
_ACTIVE_JOB_STATUSES = (ModuleJobStatus.QUEUED, ModuleJobStatus.RUNNING)


def _in_session(work: Callable[[Session], Any]) -> Any:
    db = SessionLocal()
    try:
        result = work(db)
        db.commit()
        return result
    finally:
        db.close()


# --- retry of an interrupted attempt ------------------------------------------------------------


def prepare_retry(kind: str, payload: list[Any]) -> None:
    def work(db: Session) -> None:
        now = utcnow()
        if kind in _STANDALONE_JOB_MODELS:
            job = db.get(_STANDALONE_JOB_MODELS[kind], payload[0])
            if job and job.status == ModuleJobStatus.RUNNING:
                ModuleJobLifecycle(job).requeue()
        elif kind in _BATCH_SPECS_BY_KIND:
            spec = _BATCH_SPECS_BY_KIND[kind]
            for job_id in payload[1] if len(payload) > 1 else []:
                job = db.get(spec.job_model, job_id)
                if job and job.status == ModuleJobStatus.RUNNING:
                    ModuleJobLifecycle(job).requeue()
        elif kind == "workflow_run":
            run = db.get(WorkflowRun, payload[0])
            generation = payload[1] if len(payload) > 1 and payload[1] is not None else (run.execution_generation if run else None)
            if run and run.status == WorkflowRunStatus.RUNNING and run.execution_generation == generation:
                _requeue_interrupted_items(db, run, now)
        elif kind == "export_job":
            job = db.get(ExportJob, payload[0])
            if job and job.status == ExportJobStatus.RUNNING:
                job.status = ExportJobStatus.QUEUED
                job.started_at = None
                job.error_message = RECOVERED_MESSAGE
        # document_conversion: the entry point accepts a job left ``running``.

    _in_session(work)


def _requeue_interrupted_items(db: Session, run: WorkflowRun, now: Any) -> int:
    requeued = 0
    for item in run.items:
        if item.execution_generation != run.execution_generation or item.status != WorkflowRunItemStatus.RUNNING:
            continue
        cancel_workflow_item_active_jobs(item, db, now, INTERRUPTED_MESSAGE)
        document = item.document
        if document and document.status == DocumentStatus.READY and document.pages:
            WorkflowRunItemLifecycle(item).mark_queued(execution_generation=run.execution_generation)
            requeued += 1
        else:
            WorkflowRunItemLifecycle(item).fail(document.error_message if document else "Document preprocessing was interrupted", now)
    return requeued


# --- giving up --------------------------------------------------------------------------------


def abandon(kind: str, payload: list[Any], error: str) -> None:
    """Fail the domain rows of a job that will not be retried any more."""
    message = f"{INTERRUPTED_MESSAGE} ({error})"
    try:
        if kind in _STANDALONE_JOB_MODELS:
            _in_session(lambda db: _fail_module_jobs(db, _STANDALONE_JOB_MODELS[kind], [payload[0]], message))
        elif kind in _BATCH_SPECS_BY_KIND:
            spec = _BATCH_SPECS_BY_KIND[kind]
            _in_session(lambda db: _fail_module_jobs(db, spec.job_model, list(payload[1]) if len(payload) > 1 else [], message))
            _run_entry_point(kind, payload[0], [])  # an empty job list only finalizes the batch
        elif kind == "workflow_run":
            _abandon_workflow_run(payload[0], payload[1] if len(payload) > 1 else None, message)
        elif kind == "document_conversion":
            from app.infra.jobs.conversion import mark_document_conversion_failed

            mark_document_conversion_failed(payload[0], message)
        elif kind == "export_job":

            def fail_export(db: Session) -> None:
                job = db.get(ExportJob, payload[0])
                if job and job.status in {ExportJobStatus.QUEUED, ExportJobStatus.RUNNING}:
                    job.status = ExportJobStatus.FAILED
                    job.error_message = message
                    job.completed_at = utcnow()

            _in_session(fail_export)
    except Exception:
        logger.exception("Failed to abandon job %s %s", kind, payload)


def _run_entry_point(kind: str, *args: Any) -> None:
    result = getattr(get_job_runners(), kind)(*args)
    if inspect.isawaitable(result):
        asyncio.run(result)


def _fail_module_jobs(db: Session, model: Any, job_ids: list[str], message: str) -> None:
    now = utcnow()
    for job_id in job_ids:
        job = db.get(model, job_id)
        if job and job.status in _ACTIVE_JOB_STATUSES:
            ModuleJobLifecycle(job).fail(message, now)


def _abandon_workflow_run(run_id: str, generation: int | None, message: str) -> None:
    from app.workflows import _finalize_workflow_run

    def work(db: Session) -> None:
        run = db.get(WorkflowRun, run_id)
        if not run or (generation is not None and run.execution_generation != generation):
            return
        now = utcnow()
        for item in run.items:
            if item.execution_generation == run.execution_generation and item.status in {
                WorkflowRunItemStatus.QUEUED,
                WorkflowRunItemStatus.RUNNING,
            }:
                cancel_workflow_item_active_jobs(item, db, now, message)
                WorkflowRunItemLifecycle(item).fail(message, now)

    _in_session(work)
    _finalize_workflow_run(run_id, generation)


# --- startup ----------------------------------------------------------------------------------


def recover_on_startup() -> None:
    """Reclaim the jobs of a dead process and resume (or fail) work it left behind."""
    settings = get_settings()
    abandoned = queue.requeue_expired(all_running=settings.job_queue_reclaim_on_boot)
    for job in abandoned:
        abandon(job.kind, job.payload, job.error)
    if not settings.job_queue_reclaim_on_boot:
        # Other workers may be alive: only their expired leases are safe to touch.
        return
    dispatches, ready_document_ids = _in_session(_reconcile_domain_rows)
    enqueue_jobs(dispatches)
    if ready_document_ids:
        from app.infra.jobs.conversion import activate_ready_document_waiters

        for document_id in ready_document_ids:
            activate_ready_document_waiters(document_id)


def _reconcile_domain_rows(db: Session) -> tuple[list[JobDispatch], list[str]]:
    active = queue.active_targets(db)
    dispatches: list[JobDispatch] = []
    now = utcnow()
    summary: dict[str, int] = {}

    def note(key: str) -> None:
        summary[key] = summary.get(key, 0) + 1

    # Document conversions (the entry point accepts ``running`` rows).
    for job in db.query(DocumentConversionJob).filter(DocumentConversionJob.status.in_(CONVERSION_JOB_ACTIVE_STATUSES)).all():
        if ("document_conversion", job.id) in active:
            continue
        if job.status == ConversionJobStatus.RUNNING:
            job.status = ConversionJobStatus.QUEUED
            job.started_at = None
        dispatches.append(JobDispatch("document_conversion", (job.id,)))
        note("document_conversion")

    # Export jobs.
    for job in db.query(ExportJob).filter(ExportJob.status.in_([ExportJobStatus.QUEUED, ExportJobStatus.RUNNING])).all():
        if ("export_job", job.id) in active:
            continue
        if job.status == ExportJobStatus.RUNNING:
            job.status = ExportJobStatus.QUEUED
            job.started_at = None
            job.error_message = RECOVERED_MESSAGE
        dispatches.append(JobDispatch("export_job", (job.id,)))
        note("export_job")

    # Module batches: resume like ``POST …/resume`` does, then run every queued job.
    batch_job_ids: dict[Any, set[str]] = {}
    for spec in BATCH_SPECS.values():
        batch_job_ids[spec.job_model] = {row[0] for row in db.query(spec.item_model.job_id).all()}
        for batch in (
            db.query(spec.batch_model).filter(spec.batch_model.status.in_([BatchStatus.RUNNING, BatchStatus.CANCEL_REQUESTED])).all()
        ):
            if (spec.runner, batch.id) in active:
                continue
            prepare_job_batch_resume(batch.items)
            _expand_queued_placeholders(spec, batch, db)
            job_ids = _queued_job_ids(batch)
            batch_job_ids[spec.job_model].update(job_ids)
            dispatches.append(JobDispatch(spec.runner, (batch.id, job_ids)))
            log_audit_event(
                db,
                entity_type=spec.entity_type,
                entity_id=batch.id,
                action="recovered",
                message=f"Resumed {spec.label} after server restart with {len(job_ids)} queued job(s)",
                metadata={"queued_count": len(job_ids)},
            )
            note(spec.runner)

    # Workflow runs that were executing.
    for run in db.query(WorkflowRun).filter(WorkflowRun.status == WorkflowRunStatus.RUNNING).all():
        if ("workflow_run", run.id) in active:
            continue
        requeued = _requeue_interrupted_items(db, run, now)
        dispatches.append(JobDispatch("workflow_run", (run.id, run.execution_generation)))
        log_audit_event(
            db,
            entity_type="workflow_run",
            entity_id=run.id,
            action="recovered",
            message=f"Resumed workflow run after server restart ({requeued} interrupted item(s) re-queued)",
            metadata={"execution_generation": run.execution_generation, "requeued_count": requeued},
        )
        note("workflow_run")

    # Standalone module jobs without a queue entry (e.g. from the in-memory runtime of an older
    # release, or created inside a workflow item that is re-run) cannot be resumed reliably.
    for kind, model in (*_STANDALONE_JOB_MODELS.items(), ("rotation_job", RotationJob)):
        members = batch_job_ids.get(model, set())
        for job in db.query(model).filter(model.status.in_(_ACTIVE_JOB_STATUSES)).all():
            if job.id in members or (kind, job.id) in active or job.status in MODULE_JOB_TERMINAL_STATUSES:
                continue
            ModuleJobLifecycle(job).fail(INTERRUPTED_MESSAGE, now)
            note(f"failed_{kind}")

    # Work that waits for a document that is ready by now (conversion finished, activation lost).
    ready_document_ids: set[str] = set()
    for spec in BATCH_SPECS.values():
        rows = (
            db.query(spec.job_model.document_id)
            .join(Document, Document.id == spec.job_model.document_id)
            .filter(spec.job_model.status == ModuleJobStatus.WAITING_FOR_DOCUMENT, Document.status == DocumentStatus.READY)
            .distinct()
            .all()
        )
        ready_document_ids.update(row[0] for row in rows)
    rows = (
        db.query(WorkflowRunItem.document_id)
        .join(Document, Document.id == WorkflowRunItem.document_id)
        .filter(WorkflowRunItem.status == WorkflowRunItemStatus.WAITING_FOR_DOCUMENT, Document.status == DocumentStatus.READY)
        .distinct()
        .all()
    )
    ready_document_ids.update(row[0] for row in rows)

    if summary or ready_document_ids:
        logger.info("Job recovery on startup: %s; %d ready document(s) with waiting work", summary, len(ready_document_ids))
    return dispatches, sorted(ready_document_ids)
