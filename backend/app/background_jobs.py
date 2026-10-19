"""Single seam for launching background work.

Use cases return ``JobDispatch`` values; callers hand them to ``dispatch_jobs`` (or, in a
request, ``app.api.jobs.schedule_job``), which writes them to the durable job queue and
wakes the job runtime (``app.infra.jobs.runtime``). The runtime looks each job's entry
point up by name in ``get_job_runners()``. Tests replace individual entry points with
``set_job_runners()`` rather than monkeypatching module attributes.

Entry points may be coroutine functions (run on the runtime's event loop) or plain
functions (run on a worker thread).
"""

from collections.abc import Callable, Iterable
from dataclasses import dataclass
from functools import cache
from typing import Any

from app.application.dispatch import JobDispatch


@dataclass(frozen=True)
class JobRunners:
    workflow_run: Callable[..., Any]
    extraction_job: Callable[..., Any]
    extraction_batch: Callable[..., Any]
    classification_job: Callable[..., Any]
    classification_batch: Callable[..., Any]
    required_check_job: Callable[..., Any]
    required_check_batch: Callable[..., Any]
    rotation_batch: Callable[..., Any]
    table_extraction_job: Callable[..., Any]
    table_extraction_batch: Callable[..., Any]
    document_conversion: Callable[..., Any]
    export_job: Callable[..., Any]


JOB_KINDS: tuple[str, ...] = tuple(JobRunners.__dataclass_fields__)


@cache
def default_job_runners() -> JobRunners:
    # Imported lazily: the job modules import the workflow engine, which itself dispatches through this module.
    from app.application.table_extraction import run_table_extraction_batch_async, run_table_extraction_job_async
    from app.document_modules import (
        run_classification_batch_async,
        run_classification_job_async,
        run_required_field_check_batch_async,
        run_required_field_check_job_async,
    )
    from app.extraction import run_batch_jobs_async, run_extraction_job_async
    from app.infra.jobs.conversion import run_document_conversion_job
    from app.infra.jobs.exports import run_export_job
    from app.rotation import run_rotation_batch_async
    from app.workflows import run_workflow_run_async

    return JobRunners(
        workflow_run=run_workflow_run_async,
        extraction_job=run_extraction_job_async,
        extraction_batch=run_batch_jobs_async,
        classification_job=run_classification_job_async,
        classification_batch=run_classification_batch_async,
        required_check_job=run_required_field_check_job_async,
        required_check_batch=run_required_field_check_batch_async,
        rotation_batch=run_rotation_batch_async,
        table_extraction_job=run_table_extraction_job_async,
        table_extraction_batch=run_table_extraction_batch_async,
        document_conversion=run_document_conversion_job,
        export_job=run_export_job,
    )


_override: JobRunners | None = None


def get_job_runners() -> JobRunners:
    return _override if _override is not None else default_job_runners()


def set_job_runners(runners: JobRunners | None) -> None:
    """Install replacement runners; ``None`` restores the defaults."""
    global _override
    _override = runners


def enqueue_jobs(dispatches: JobDispatch | Iterable[JobDispatch] | None) -> int:
    """Write ``dispatches`` to the job queue (committed) without waking the runtime."""
    from app.infra.jobs.queue import enqueue_dispatches

    items = [dispatches] if isinstance(dispatches, JobDispatch) else list(dispatches or [])
    for item in items:
        if item.runner not in JOB_KINDS:
            raise ValueError(f"Unknown job kind: {item.runner}")
    return enqueue_dispatches(items)


def wake_job_runtime() -> None:
    from app.infra.jobs.runtime import get_job_runtime

    get_job_runtime().wake()


def dispatch_jobs(dispatches: JobDispatch | Iterable[JobDispatch] | None) -> None:
    """Queue ``dispatches`` durably and let the runtime pick them up now."""
    if enqueue_jobs(dispatches):
        wake_job_runtime()
