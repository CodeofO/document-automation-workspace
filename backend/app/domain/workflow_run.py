"""State transitions of a workflow run and its items.

Every write to ``WorkflowRun.status`` / ``WorkflowRunItem.status`` goes through these classes
so the rules (execution generations, timestamps, which items a transition touches) live in
one place. They operate on the persistence rows directly and never touch the session.
"""

from collections.abc import Callable
from datetime import datetime
from typing import Any

from app.domain.status import (
    WORKFLOW_ITEM_ACTIVE_STATUSES,
    WORKFLOW_ITEM_IN_FLIGHT_STATUSES,
    WORKFLOW_RUN_TERMINAL_STATUSES,
    DocumentStatus,
    WorkflowRunItemStatus,
    WorkflowRunStatus,
)


def _document_ready(item: Any) -> bool:
    return bool(item.document and item.document.status == DocumentStatus.READY and item.document.pages)


def _interrupted_message(item: Any) -> str:
    return item.document.error_message if item.document else "Document preprocessing was interrupted"


class WorkflowRunItemLifecycle:
    def __init__(self, item: Any) -> None:
        self._item = item

    def mark_queued(self, *, execution_generation: int | None = None) -> None:
        self._item.status = WorkflowRunItemStatus.QUEUED
        self._item.error_message = None
        self._item.completed_at = None
        if execution_generation is not None:
            self._item.execution_generation = execution_generation

    def mark_uploaded(self, *, upload_duration_ms: int) -> None:
        """Upload + preprocessing finished; the item waits for the run to start."""
        self._item.status = WorkflowRunItemStatus.QUEUED
        self._item.error_message = None
        self._item.upload_duration_ms = upload_duration_ms

    def mark_running(self) -> None:
        self._item.status = WorkflowRunItemStatus.RUNNING
        self._item.error_message = None

    def finish(self, status: str, *, error_message: str | None, now: datetime) -> None:
        self._item.status = status
        self._item.error_message = error_message
        self._item.completed_at = now

    def pause(self, message: str = "Paused by user") -> None:
        self._item.status = WorkflowRunItemStatus.PAUSED
        self._item.error_message = message

    def fail(self, message: str | None, now: datetime) -> None:
        self._item.status = WorkflowRunItemStatus.FAILED
        self._item.error_message = message
        self._item.completed_at = now

    def cancel(self, message: str, now: datetime) -> None:
        self._item.status = WorkflowRunItemStatus.CANCELED
        self._item.error_message = message
        self._item.completed_at = now


class WorkflowRunLifecycle:
    def __init__(self, run: Any) -> None:
        self._run = run

    @property
    def is_terminal(self) -> bool:
        return self._run.status in WORKFLOW_RUN_TERMINAL_STATUSES

    def _next_generation(self) -> int:
        self._run.execution_generation = (self._run.execution_generation or 0) + 1
        return self._run.execution_generation

    def _begin_inference(self, now: datetime) -> None:
        self._run.status = WorkflowRunStatus.RUNNING
        self._run.started_at = self._run.started_at or now
        self._run.inference_started_at = now

    # --- start / resume / retry -------------------------------------------------------------

    def start(self, now: datetime, *, upload_duration_ms: int | None) -> int:
        self._next_generation()
        self._run.status = WorkflowRunStatus.RUNNING
        self._run.upload_duration_ms = upload_duration_ms
        self._run.started_at = self._run.started_at or now
        self._run.inference_started_at = now
        for item in self._run.items:
            if item.status in {WorkflowRunItemStatus.QUEUED, WorkflowRunItemStatus.PAUSED}:
                WorkflowRunItemLifecycle(item).mark_queued(execution_generation=self._run.execution_generation)
        return self._run.execution_generation

    def prepare_resume(self, now: datetime) -> int:
        queued_count = 0
        for item in self._run.items:
            if item.status == WorkflowRunItemStatus.QUEUED:
                queued_count += 1
                continue
            if item.status not in {WorkflowRunItemStatus.PAUSED, WorkflowRunItemStatus.RUNNING, WorkflowRunItemStatus.PREPROCESSING}:
                continue
            if _document_ready(item):
                WorkflowRunItemLifecycle(item).mark_queued()
                queued_count += 1
            else:
                WorkflowRunItemLifecycle(item).fail(_interrupted_message(item), now)
        return queued_count

    def finish_resume(self, now: datetime, *, queued_count: int, fallback_status: str) -> int:
        self._run.status = WorkflowRunStatus.RUNNING if queued_count else fallback_status
        self._run.completed_at = None if queued_count else self._run.completed_at
        if not queued_count:
            return self._run.execution_generation or 0
        self._next_generation()
        self._run.started_at = self._run.started_at or now
        self._run.inference_started_at = now
        for item in self._run.items:
            if item.status == WorkflowRunItemStatus.QUEUED:
                item.execution_generation = self._run.execution_generation
        return self._run.execution_generation

    def begin_retry_failed(self) -> int:
        """A retry gets a fresh execution generation before failed items are re-queued."""
        return self._next_generation()

    def prepare_retry_failed(self, now: datetime, *, initial_payload: Callable[[Any], dict[str, Any]]) -> int:
        queued_count = 0
        for item in self._run.items:
            if item.status != WorkflowRunItemStatus.FAILED:
                continue
            if _document_ready(item):
                WorkflowRunItemLifecycle(item).mark_queued(execution_generation=self._run.execution_generation)
                item.inference_duration_ms = None
                item.result_json = initial_payload(item)
                queued_count += 1
            else:
                item.error_message = _interrupted_message(item)
                item.completed_at = now
                item.execution_generation = self._run.execution_generation
        return queued_count

    def mark_retry_running(self, now: datetime) -> None:
        self._run.status = WorkflowRunStatus.RUNNING
        self._run.completed_at = None
        self._run.error_message = None
        self._run.started_at = self._run.started_at or now
        self._run.inference_started_at = now

    def promote_waiting(self, now: datetime) -> int:
        """Start a run that was waiting in its queue group. Returns the number of queued items."""
        self._next_generation()
        self._run.completed_at = None
        self._run.error_message = None
        self._begin_inference(now)
        queued_count = 0
        for item in self._run.items:
            if item.status == WorkflowRunItemStatus.QUEUED:
                WorkflowRunItemLifecycle(item).mark_queued(execution_generation=self._run.execution_generation)
                queued_count += 1
        if not queued_count:
            self.finish_without_queued_items(now)
        return queued_count

    def mark_executing(self, now: datetime) -> None:
        """The executor picked the run up."""
        self._run.status = WorkflowRunStatus.RUNNING
        self._run.started_at = self._run.started_at or now

    # --- uploads ---------------------------------------------------------------------------

    def reopen_for_upload(self) -> None:
        """A paused run that is still missing uploads goes back to accepting them."""
        self._run.status = WorkflowRunStatus.UPLOADING
        self._run.error_message = None

    def finish_without_queued_items(self, now: datetime) -> None:
        """Nothing is executable (every document failed or was missing)."""
        self._run.status = WorkflowRunStatus.COMPLETED_WITH_ERRORS
        self._run.completed_at = now
        self._run.inference_started_at = None

    # --- finishing -------------------------------------------------------------------------

    def finalize(self, now: datetime) -> WorkflowRunStatus:
        """Derive the run status from its items after the executor finished a pass.

        Returns the new status. ``paused`` and ``running`` leave ``completed_at`` empty; any other
        result is terminal and stamps ``completed_at``.
        """
        statuses = [item.status for item in self._run.items]
        if not statuses:
            self._run.status = WorkflowRunStatus.FAILED
            self._run.error_message = "Workflow run has no items"
        elif self._run.status == WorkflowRunStatus.PAUSED or any(status == WorkflowRunItemStatus.PAUSED for status in statuses):
            self._run.status = WorkflowRunStatus.PAUSED
            self._run.completed_at = None
            return WorkflowRunStatus.PAUSED
        elif any(status in WORKFLOW_ITEM_IN_FLIGHT_STATUSES for status in statuses):
            self._run.status = WorkflowRunStatus.RUNNING
            self._run.completed_at = None
            return WorkflowRunStatus.RUNNING
        elif any(status == WorkflowRunItemStatus.FAILED for status in statuses):
            self._run.status = WorkflowRunStatus.COMPLETED_WITH_ERRORS
        elif any(status == WorkflowRunItemStatus.NEEDS_REVIEW for status in statuses):
            self._run.status = WorkflowRunStatus.NEEDS_REVIEW
        elif all(status == WorkflowRunItemStatus.CANCELED for status in statuses):
            self._run.status = WorkflowRunStatus.CANCELED
        else:
            self._run.status = WorkflowRunStatus.COMPLETED
        self._run.completed_at = now
        return WorkflowRunStatus(self._run.status)

    def fail(self, message: str, now: datetime) -> None:
        """The run cannot execute at all (e.g. its definition is invalid): fail it and every item."""
        self._run.status = WorkflowRunStatus.FAILED
        self._run.error_message = message
        self._run.completed_at = now
        for item in self._run.items:
            WorkflowRunItemLifecycle(item).fail(message, now)

    # --- pause / stop / cancel -------------------------------------------------------------

    def pause(self, now: datetime, *, cancel_active_job: Callable[[Any], None]) -> int:
        paused_count = 0
        self._next_generation()
        for item in self._run.items:
            if item.status in {WorkflowRunItemStatus.QUEUED, WorkflowRunItemStatus.PREPROCESSING, WorkflowRunItemStatus.RUNNING}:
                cancel_active_job(item)
                item.status = WorkflowRunItemStatus.PAUSED
                item.error_message = "Paused by user"
                item.completed_at = now
                paused_count += 1
        self._run.status = WorkflowRunStatus.PAUSED
        self._run.completed_at = None
        self._run.error_message = "Paused by user"
        return paused_count

    def replace_by_restart(self, now: datetime, *, message: str = "Replaced by restarted workflow run") -> None:
        """A non-terminal run that is restarted as a new run is canceled (its executor stops)."""
        self._next_generation()
        self._run.status = WorkflowRunStatus.CANCELED
        self._run.error_message = message
        self._run.completed_at = now

    def cancel_waiting(self, now: datetime, *, message: str) -> int:
        canceled_count = 0
        for item in self._run.items:
            if item.status in WORKFLOW_ITEM_ACTIVE_STATUSES:
                WorkflowRunItemLifecycle(item).cancel(message, now)
                canceled_count += 1
        self._cancel(now, message)
        return canceled_count

    def stop_without_deleting_documents(
        self,
        now: datetime,
        *,
        message: str,
        cancel_active_job: Callable[[Any], None],
    ) -> int:
        stopped_count = 0
        self._next_generation()
        for item in self._run.items:
            if item.status in WORKFLOW_ITEM_ACTIVE_STATUSES:
                cancel_active_job(item)
                WorkflowRunItemLifecycle(item).cancel(message, now)
                stopped_count += 1
        self._cancel(now, message)
        return stopped_count

    def _cancel(self, now: datetime, message: str) -> None:
        self._run.status = WorkflowRunStatus.CANCELED
        self._run.error_message = message
        self._run.completed_at = now
        self._run.inference_started_at = None
