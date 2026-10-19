"""State transitions shared by the four module batch types (KIE, classification, required check, rotation)."""

from collections.abc import Iterable
from datetime import datetime
from typing import Any

from app.domain.status import MODULE_JOB_TERMINAL_STATUSES, BatchStatus, ModuleJobStatus

# Batches in these states are not moved to ``cancel_requested`` by a cancel request.
_CANCEL_SETTLED_STATUSES = frozenset({BatchStatus.CANCELED, BatchStatus.COMPLETED, BatchStatus.COMPLETED_WITH_ERRORS})


def batch_outcome(job_statuses: Iterable[str]) -> BatchStatus:
    """Final batch status once every job is terminal."""
    statuses = list(job_statuses)
    if all(status == ModuleJobStatus.CANCELED for status in statuses):
        return BatchStatus.CANCELED
    if any(status in {ModuleJobStatus.FAILED, ModuleJobStatus.CANCELED} for status in statuses):
        return BatchStatus.COMPLETED_WITH_ERRORS
    return BatchStatus.COMPLETED


class BatchLifecycle:
    def __init__(self, batch: Any) -> None:
        self._batch = batch

    def start(self) -> None:
        self._batch.status = BatchStatus.RUNNING

    def resume(self, *, has_queued_jobs: bool, idle_status: str) -> None:
        """Continue after an interruption; without queued jobs the batch shows its derived status."""
        self._batch.status = BatchStatus.RUNNING if has_queued_jobs else idle_status
        self._batch.completed_at = None if has_queued_jobs else self._batch.completed_at

    def keep_running(self) -> None:
        self._batch.status = BatchStatus.RUNNING
        self._batch.completed_at = None

    def finish(self, status: BatchStatus, now: datetime) -> None:
        self._batch.status = status
        self._batch.completed_at = now

    def fail_without_jobs(self, now: datetime) -> None:
        self.finish(BatchStatus.FAILED, now)

    def finish_without_executable_jobs(self, now: datetime) -> None:
        """Created from library documents none of which can run."""
        self.finish(BatchStatus.COMPLETED_WITH_ERRORS, now)

    def discard(self, now: datetime) -> None:
        self.finish(BatchStatus.CANCELED, now)

    def close_if_all_jobs_terminal(self, now: datetime) -> bool:
        jobs = [item.job for item in self._batch.items if item.job]
        if not jobs or any(job.status not in MODULE_JOB_TERMINAL_STATUSES for job in jobs):
            return False
        self.finish(batch_outcome(job.status for job in jobs), now)
        return True

    def request_cancel(self) -> None:
        if self._batch.status not in _CANCEL_SETTLED_STATUSES:
            self._batch.status = BatchStatus.CANCEL_REQUESTED
