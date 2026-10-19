"""The in-process job runtime: one asyncio event loop (on its own thread) that runs the queue.

``AsyncioJobRuntime`` is what the app starts in its lifespan. It

* claims jobs from ``job_queue`` with a lease, at most ``limit`` at a time per concurrency
  group (workflow runs and module jobs: ``WORKFLOW_MAX_WORKERS``; document conversion:
  ``PREPROCESS_MAX_WORKERS``; exports: 1). The VLM request semaphore
  (``VLM_MAX_CONCURRENT_REQUESTS``) and the workflow thread pool still bound the work
  inside a job exactly as before;
* runs coroutine entry points on the loop and plain ones on a worker thread;
* extends the leases of running jobs (heartbeat) and re-queues jobs whose lease expired;
* runs the upload retention cleanup periodically.

``InlineJobRuntime`` runs the queue synchronously in the thread that wakes it, until no job
is left. Tests install it (``set_job_runtime``) so a request's background work finishes
before ``TestClient`` returns, like FastAPI ``BackgroundTasks`` used to.
"""

import asyncio
import inspect
import logging
import os
import socket
import threading
import time
import uuid
from collections.abc import Callable
from datetime import timedelta
from functools import partial
from typing import Any, Protocol

from app.background_jobs import JOB_KINDS, get_job_runners
from app.core.config import get_settings
from app.infra.jobs import queue
from app.infra.jobs.queue import ClaimedJob

logger = logging.getLogger(__name__)

# Concurrency group of each job kind (kinds not listed run in the "module" group).
_KIND_GROUPS = {
    "workflow_run": "workflow",
    "document_conversion": "conversion",
    "export_job": "export",
}
_PRUNE_INTERVAL_SECONDS = 3600
_FINISHED_JOB_RETENTION = timedelta(days=7)


def kind_group(kind: str) -> str:
    return _KIND_GROUPS.get(kind, "module")


def group_limits() -> dict[str, int]:
    settings = get_settings()
    workers = max(1, int(settings.workflow_max_workers or 1))
    return {
        "workflow": workers,
        "module": workers,
        "conversion": max(1, int(settings.preprocess_max_workers or 1)),
        "export": 1,
    }


def _runner_for(kind: str) -> Callable[..., Any]:
    if kind not in JOB_KINDS:
        raise ValueError(f"Unknown job kind: {kind}")
    return getattr(get_job_runners(), kind)


def _new_owner() -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{uuid.uuid4().hex[:8]}"


def _error_text(exc: BaseException) -> str:
    return f"{type(exc).__name__}: {exc}"


class JobRuntime(Protocol):
    def start(self) -> None: ...

    def stop(self) -> None: ...

    def wake(self) -> None: ...


class AsyncioJobRuntime:
    def __init__(self) -> None:
        self.owner = _new_owner()
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._wake_event: asyncio.Event | None = None
        self._stopping = threading.Event()
        self._started = threading.Event()
        self._running: dict[str, tuple[ClaimedJob, asyncio.Task[None]]] = {}

    # --- lifecycle ----------------------------------------------------------------------------

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        from app.infra.jobs.recovery import recover_on_startup

        recover_on_startup()
        self._stopping.clear()
        self._started.clear()
        self._thread = threading.Thread(target=self._thread_main, name="job-runtime", daemon=True)
        self._thread.start()
        self._started.wait(timeout=5)

    def stop(self, timeout: float = 10.0) -> None:
        self._stopping.set()
        self.wake()
        if self._thread:
            self._thread.join(timeout=timeout)
        self._thread = None

    def wake(self) -> None:
        loop, event = self._loop, self._wake_event
        if loop is None or event is None or loop.is_closed():
            return
        try:
            loop.call_soon_threadsafe(event.set)
        except RuntimeError:
            pass

    # --- loop ---------------------------------------------------------------------------------

    def _thread_main(self) -> None:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        self._loop = loop
        try:
            loop.run_until_complete(self._main())
        finally:
            self._loop = None
            loop.run_until_complete(loop.shutdown_asyncgens())
            loop.close()

    async def _main(self) -> None:
        self._wake_event = asyncio.Event()
        self._started.set()
        loop = asyncio.get_running_loop()
        heartbeat = asyncio.create_task(self._heartbeat_loop())
        maintenance = asyncio.create_task(self._maintenance_loop())
        try:
            while not self._stopping.is_set():
                self._wake_event.clear()
                try:
                    await self._claim_available(loop)
                except Exception:
                    logger.exception("Job runtime failed to claim jobs")
                poll = max(0.05, float(get_settings().job_queue_poll_seconds or 1.0))
                try:
                    await asyncio.wait_for(self._wake_event.wait(), timeout=poll)
                except TimeoutError:
                    pass
        finally:
            heartbeat.cancel()
            maintenance.cancel()
            await self._shutdown_running(loop)

    async def _claim_available(self, loop: asyncio.AbstractEventLoop) -> None:
        lease_seconds = max(5, int(get_settings().job_queue_lease_seconds or 60))
        while not self._stopping.is_set():
            limits = group_limits()
            busy: dict[str, int] = {}
            for job, _task in self._running.values():
                busy[kind_group(job.kind)] = busy.get(kind_group(job.kind), 0) + 1
            kinds = [kind for kind in JOB_KINDS if busy.get(kind_group(kind), 0) < limits[kind_group(kind)]]
            if not kinds:
                return
            claimed = await loop.run_in_executor(None, partial(queue.claim_next, self.owner, kinds, lease_seconds=lease_seconds))
            if claimed is None:
                return
            task = asyncio.create_task(self._run(claimed))
            self._running[claimed.id] = (claimed, task)

    async def _run(self, job: ClaimedJob) -> None:
        loop = asyncio.get_running_loop()
        error: str | None = None
        try:
            await execute_job(job, loop)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.exception("Background job %s (%s) failed", job.id, job.kind)
            error = _error_text(exc)
        finally:
            self._running.pop(job.id, None)
        await loop.run_in_executor(None, lambda: queue.finish(job.id, self.owner, error=error))
        if self._wake_event is not None:
            self._wake_event.set()

    async def _heartbeat_loop(self) -> None:
        loop = asyncio.get_running_loop()
        while True:
            lease_seconds = max(5, int(get_settings().job_queue_lease_seconds or 60))
            await asyncio.sleep(max(1.0, lease_seconds / 4))
            ids = list(self._running)
            try:
                await loop.run_in_executor(None, partial(queue.heartbeat, self.owner, ids, lease_seconds=lease_seconds))
                await loop.run_in_executor(None, _requeue_expired_and_fail_abandoned)
            except Exception:
                logger.exception("Job runtime heartbeat failed")

    async def _maintenance_loop(self) -> None:
        from app.application.maintenance import cleanup_expired_upload_data

        loop = asyncio.get_running_loop()
        last_cleanup: float | None = None
        last_prune: float | None = None
        while True:
            now = time.monotonic()
            settings = get_settings()
            if settings.resolved_upload_retention_hours > 0:
                interval = max(60, int(settings.retention_cleanup_interval_seconds or 86400))
                if last_cleanup is None or now - last_cleanup >= interval:
                    last_cleanup = now
                    try:
                        await loop.run_in_executor(None, cleanup_expired_upload_data)
                    except Exception:
                        logger.exception("Upload retention cleanup failed")
            if last_prune is None or now - last_prune >= _PRUNE_INTERVAL_SECONDS:
                last_prune = now
                try:
                    await loop.run_in_executor(None, lambda: queue.prune_finished(_FINISHED_JOB_RETENTION))
                except Exception:
                    logger.exception("Pruning finished jobs failed")
            await asyncio.sleep(60)

    async def _shutdown_running(self, loop: asyncio.AbstractEventLoop, grace_seconds: float = 5.0) -> None:
        tasks = [task for _job, task in self._running.values()]
        if tasks:
            await asyncio.wait(tasks, timeout=grace_seconds)
        leftover = {job_id: task for job_id, (_job, task) in self._running.items() if not task.done()}
        for task in leftover.values():
            task.cancel()
        if leftover:
            await asyncio.gather(*leftover.values(), return_exceptions=True)
            await loop.run_in_executor(None, lambda: queue.release(self.owner, list(leftover)))
        self._running.clear()


async def execute_job(job: ClaimedJob, loop: asyncio.AbstractEventLoop | None = None) -> None:
    """Run one claimed job: retry preparation (when an earlier attempt died), then its entry point."""
    from app.infra.jobs.recovery import prepare_retry

    loop = loop or asyncio.get_running_loop()
    if job.attempts > 1:
        await loop.run_in_executor(None, lambda: prepare_retry(job.kind, job.payload))
    runner = _runner_for(job.kind)
    if inspect.iscoroutinefunction(runner):
        await runner(*job.payload)
    else:
        result = await loop.run_in_executor(None, lambda: runner(*job.payload))
        if inspect.isawaitable(result):
            await result


def _requeue_expired_and_fail_abandoned() -> None:
    from app.infra.jobs.recovery import abandon

    for job in queue.requeue_expired():
        abandon(job.kind, job.payload, job.error)


class InlineJobRuntime:
    """Runs queued jobs synchronously in the waking thread until the queue is empty.

    Re-entrant wakes (a job that queues more work) are absorbed by the drain already in
    progress, which keeps claiming until nothing is left.
    """

    def __init__(self) -> None:
        self.owner = f"inline:{_new_owner()}"
        self._lock = threading.Lock()
        self._draining = False

    def start(self) -> None:
        return None

    def stop(self) -> None:
        return None

    def wake(self) -> None:
        self.run_until_idle()

    def run_until_idle(self, max_jobs: int = 10_000) -> int:
        with self._lock:
            if self._draining:
                return 0
            self._draining = True
        ran = 0
        try:
            while ran < max_jobs:
                job = queue.claim_next(self.owner, JOB_KINDS, lease_seconds=3600)
                if job is None:
                    break
                ran += 1
                error: str | None = None
                try:
                    _run_coroutine_sync(execute_job(job))
                except Exception as exc:
                    logger.exception("Background job %s (%s) failed", job.id, job.kind)
                    error = _error_text(exc)
                queue.finish(job.id, self.owner, error=error)
        finally:
            with self._lock:
                self._draining = False
        return ran


def _run_coroutine_sync(coroutine: Any) -> None:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        asyncio.run(coroutine)
        return
    # Called from inside an event loop: run on a helper thread with its own loop.
    failure: list[BaseException] = []

    def target() -> None:
        try:
            asyncio.run(coroutine)
        except BaseException as exc:  # noqa: BLE001 - re-raised in the caller
            failure.append(exc)

    thread = threading.Thread(target=target, name="inline-job")
    thread.start()
    thread.join()
    if failure:
        raise failure[0]


_runtime: JobRuntime | None = None
_runtime_lock = threading.Lock()


def get_job_runtime() -> JobRuntime:
    global _runtime
    with _runtime_lock:
        if _runtime is None:
            _runtime = AsyncioJobRuntime()
        return _runtime


def set_job_runtime(runtime: JobRuntime | None) -> None:
    """Install a runtime (``None``: the default ``AsyncioJobRuntime`` on next use)."""
    global _runtime
    with _runtime_lock:
        _runtime = runtime
