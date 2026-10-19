"""State transitions of module jobs (KIE extraction, classification, required-field check, rotation)."""

from datetime import datetime
from typing import Any

from app.domain.status import MODULE_JOB_TERMINAL_STATUSES, ModuleJobStatus


class ModuleJobLifecycle:
    def __init__(self, job: Any) -> None:
        self._job = job

    @property
    def is_terminal(self) -> bool:
        return self._job.status in MODULE_JOB_TERMINAL_STATUSES

    def mark_queued(self) -> None:
        """Ready to run: its document finished preprocessing/conversion, or the job is retried."""
        self._job.status = ModuleJobStatus.QUEUED
        self._job.error_message = None

    def mark_running(self, now: datetime) -> None:
        self._job.status = ModuleJobStatus.RUNNING
        self._job.started_at = now

    def complete(self, now: datetime) -> None:
        self._job.status = ModuleJobStatus.COMPLETED
        self._job.completed_at = now

    def needs_review(self, now: datetime) -> None:
        self._job.status = ModuleJobStatus.NEEDS_REVIEW
        self._job.completed_at = now

    def finish(self, *, needs_review: bool, now: datetime) -> None:
        if needs_review:
            self.needs_review(now)
        else:
            self.complete(now)

    def fail(self, message: str | None, now: datetime) -> None:
        self._job.status = ModuleJobStatus.FAILED
        self._job.error_message = message
        self._job.completed_at = now

    def cancel(self, message: str, now: datetime) -> None:
        self._job.status = ModuleJobStatus.CANCELED
        self._job.error_message = message
        self._job.completed_at = now

    def requeue(self) -> None:
        """Run again from scratch (batch resume after an interruption)."""
        self.mark_queued()
        self._job.started_at = None
        self._job.completed_at = None
