"""Every persisted (and API-visible) status vocabulary, in one place.

The values are exactly the strings stored in the database and returned by the API, so a
``StrEnum`` member compares equal to the raw string (``DocumentStatus.READY == "ready"``)
and serialises unchanged. Status *sets* used by more than one module (terminal, active,
cancelable, ...) are defined here and nowhere else.
"""

from enum import StrEnum


class DocumentStatus(StrEnum):
    QUEUED = "queued"  # waiting for the conversion worker
    PREPROCESSING = "preprocessing"  # being rasterised into page images
    READY = "ready"
    FAILED = "failed"
    DELETED = "deleted"  # soft-deleted from the library


DOCUMENT_CONVERTING_STATUSES = frozenset({DocumentStatus.QUEUED, DocumentStatus.PREPROCESSING})


class ConversionJobStatus(StrEnum):
    """``DocumentConversionJob.status`` (library upload/copy → page images)."""

    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELED = "canceled"


CONVERSION_JOB_ACTIVE_STATUSES = frozenset({ConversionJobStatus.QUEUED, ConversionJobStatus.RUNNING})
CONVERSION_JOB_TERMINAL_STATUSES = frozenset({ConversionJobStatus.COMPLETED, ConversionJobStatus.FAILED, ConversionJobStatus.CANCELED})


class RawExtractionStatus(StrEnum):
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class ModuleJobStatus(StrEnum):
    """Status of a KIE (extraction), classification, required-field-check or rotation job."""

    PREPROCESSING = "preprocessing"  # its document is still being uploaded/rasterised in the request
    WAITING_FOR_DOCUMENT = "waiting_for_document"  # its library document is still converting
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"
    CANCELED = "canceled"


# Aliases: these job families share the module job vocabulary.
ExtractionJobStatus = ModuleJobStatus
ClassificationJobStatus = ModuleJobStatus
RequiredCheckJobStatus = ModuleJobStatus
RotationJobStatus = ModuleJobStatus
# Batch items have no status column of their own; an item reports its job's status.
BatchItemStatus = ModuleJobStatus

MODULE_JOB_TERMINAL_STATUSES = frozenset(
    {ModuleJobStatus.COMPLETED, ModuleJobStatus.NEEDS_REVIEW, ModuleJobStatus.FAILED, ModuleJobStatus.CANCELED}
)
MODULE_JOB_SUCCESS_STATUSES = frozenset({ModuleJobStatus.COMPLETED, ModuleJobStatus.NEEDS_REVIEW})
# Jobs a batch worker still has to run (or wait for) — what batch cancel and the batch workers act on.
MODULE_JOB_PENDING_STATUSES = frozenset({ModuleJobStatus.QUEUED, ModuleJobStatus.RUNNING, ModuleJobStatus.WAITING_FOR_DOCUMENT})
# Job statuses counted as "still being prepared" in batch progress counters.
MODULE_JOB_PREPARING_STATUSES = frozenset({"uploading", ModuleJobStatus.PREPROCESSING, ModuleJobStatus.WAITING_FOR_DOCUMENT})


class JobAdmission(StrEnum):
    """Initial job/item status chosen from a document's state when work is created from library documents."""

    READY = "queued"
    WAITING_FOR_DOCUMENT = "waiting_for_document"
    BLOCKED = "blocked"  # never persisted: the job is created as failed (or the request is rejected)


class BatchStatus(StrEnum):
    """Status of KIE (``batches``), classification, required-field-check and rotation batches."""

    UPLOADING = "uploading"
    QUEUED = "queued"
    RUNNING = "running"
    CANCEL_REQUESTED = "cancel_requested"
    COMPLETED = "completed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"
    FAILED = "failed"
    CANCELED = "canceled"
    # Only ever derived for summaries from the job counters, never stored:
    PREPROCESSING = "preprocessing"
    CANCELING = "canceling"


BATCH_TERMINAL_STATUSES = frozenset({BatchStatus.COMPLETED, BatchStatus.COMPLETED_WITH_ERRORS, BatchStatus.FAILED, BatchStatus.CANCELED})
# A batch accepts more uploads (and can be started) only in these states.
BATCH_UPLOAD_OPEN_STATUSES = frozenset({BatchStatus.UPLOADING, BatchStatus.QUEUED})


class WorkflowRunStatus(StrEnum):
    UPLOADING = "uploading"
    WAITING = "waiting"  # queued behind another run of the same queue group
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"
    CANCELED = "canceled"
    # Only ever derived for summaries from the item counters, never stored:
    PREPROCESSING = "preprocessing"


WORKFLOW_RUN_TERMINAL_STATUSES = frozenset(
    {
        WorkflowRunStatus.COMPLETED,
        WorkflowRunStatus.COMPLETED_WITH_ERRORS,
        WorkflowRunStatus.NEEDS_REVIEW,
        WorkflowRunStatus.FAILED,
        WorkflowRunStatus.CANCELED,
    }
)
# Finishing in one of these starts the next waiting run of the queue group.
WORKFLOW_RUN_QUEUE_ADVANCE_STATUSES = frozenset(
    {WorkflowRunStatus.COMPLETED, WorkflowRunStatus.COMPLETED_WITH_ERRORS, WorkflowRunStatus.NEEDS_REVIEW}
)
# A queue entry in one of these states already ran and cannot be removed from the queue.
WORKFLOW_RUN_QUEUE_FINISHED_STATUSES = frozenset(
    {WorkflowRunStatus.COMPLETED, WorkflowRunStatus.COMPLETED_WITH_ERRORS, WorkflowRunStatus.NEEDS_REVIEW, WorkflowRunStatus.FAILED}
)
WORKFLOW_RUN_ENQUEUE_BLOCKED_STATUSES = frozenset({WorkflowRunStatus.WAITING, WorkflowRunStatus.FAILED, WorkflowRunStatus.CANCELED})
WORKFLOW_RUN_STARTABLE_STATUSES = frozenset({WorkflowRunStatus.UPLOADING, WorkflowRunStatus.QUEUED, WorkflowRunStatus.WAITING})
WORKFLOW_RUN_UPLOAD_OPEN_STATUSES = frozenset({WorkflowRunStatus.UPLOADING, WorkflowRunStatus.QUEUED})


class WorkflowRunItemStatus(StrEnum):
    UPLOADING = "uploading"
    PREPROCESSING = "preprocessing"
    WAITING_FOR_DOCUMENT = "waiting_for_document"
    QUEUED = "queued"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    NEEDS_REVIEW = "needs_review"
    FAILED = "failed"
    CANCELED = "canceled"


WORKFLOW_ITEM_TERMINAL_STATUSES = frozenset(
    {WorkflowRunItemStatus.COMPLETED, WorkflowRunItemStatus.NEEDS_REVIEW, WorkflowRunItemStatus.FAILED, WorkflowRunItemStatus.CANCELED}
)
# Items a pause/stop/cancel acts on.
WORKFLOW_ITEM_ACTIVE_STATUSES = frozenset(
    {WorkflowRunItemStatus.QUEUED, WorkflowRunItemStatus.PREPROCESSING, WorkflowRunItemStatus.RUNNING, WorkflowRunItemStatus.PAUSED}
)
# Items that keep a run "running" when it is finalized.
WORKFLOW_ITEM_IN_FLIGHT_STATUSES = frozenset(
    {
        WorkflowRunItemStatus.QUEUED,
        WorkflowRunItemStatus.RUNNING,
        WorkflowRunItemStatus.PREPROCESSING,
        WorkflowRunItemStatus.WAITING_FOR_DOCUMENT,
    }
)
# Items that block "retry failed" until they finish.
WORKFLOW_ITEM_RETRY_BLOCKING_STATUSES = frozenset(
    {
        WorkflowRunItemStatus.UPLOADING,
        WorkflowRunItemStatus.PREPROCESSING,
        WorkflowRunItemStatus.QUEUED,
        WorkflowRunItemStatus.RUNNING,
        WorkflowRunItemStatus.PAUSED,
    }
)


class ExportJobStatus(StrEnum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class RequiredItemStatus(StrEnum):
    PRESENT = "present"
    MISSING = "missing"
    UNCERTAIN = "uncertain"
    NOT_APPLICABLE = "not_applicable"


class RequiredOverallStatus(StrEnum):
    COMPLETE = "complete"
    INCOMPLETE = "incomplete"
    NEEDS_REVIEW = "needs_review"


class ClassificationOutcome(StrEnum):
    CLASSIFIED = "classified"
    UNKNOWN = "unknown"


class JudgementStatus(StrEnum):
    """AI review verdict on an extracted KIE value."""

    CORRECT = "correct"
    NEEDS_CORRECTION = "needs_correction"


class RotationPageStatus(StrEnum):
    UPRIGHT = "upright"
    CORRECTED = "corrected"
    LOW_CONFIDENCE = "low_confidence"
    SKIPPED = "skipped"


class JobQueueStatus(StrEnum):
    """``job_queue.status`` (the durable background job queue)."""

    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


JOB_QUEUE_ACTIVE_STATUSES = frozenset({JobQueueStatus.QUEUED, JobQueueStatus.RUNNING})
