from fastapi import BackgroundTasks
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.application.dispatch import JobDispatch
from app.background_jobs import enqueue_jobs, wake_job_runtime


def schedule_job(
    background_tasks: BackgroundTasks,
    dispatch: JobDispatch | list[JobDispatch] | None,
    db: Session | None = None,
) -> None:
    """Queue the dispatched jobs durably now and wake the job runtime once the response is sent.

    The request session is closed first (when given) so the request never holds its
    connection while the queue is written.
    """
    dispatches = [dispatch] if isinstance(dispatch, JobDispatch) else list(dispatch or [])
    if not dispatches:
        return
    if db is not None:
        db.close()
    enqueue_jobs(dispatches)
    background_tasks.add_task(wake_job_runtime)


async def schedule_job_async(
    background_tasks: BackgroundTasks,
    dispatch: JobDispatch | list[JobDispatch] | None,
    db: Session | None = None,
) -> None:
    """``schedule_job`` for ``async def`` endpoints (the queue write runs on a worker thread)."""
    await run_in_threadpool(schedule_job, background_tasks, dispatch, db)
