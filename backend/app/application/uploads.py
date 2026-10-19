from dataclasses import dataclass
from datetime import datetime
from typing import Any, BinaryIO, Protocol

from sqlalchemy.orm import Session

from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.errors import AppError, PayloadTooLargeError, UnprocessableError
from app.document_processor import DocumentProcessingError
from app.domain.status import BATCH_UPLOAD_OPEN_STATUSES, WORKFLOW_RUN_UPLOAD_OPEN_STATUSES, ModuleJobStatus
from app.models import (
    BatchItem,
    WorkflowRunItem,
)


class UploadedFile(Protocol):
    """What services need from an uploaded file (FastAPI's ``UploadedFile`` and ``LocalUpload`` both fit)."""

    filename: str | None
    content_type: str | None
    file: BinaryIO


# (file, client_file_id, upload_index) as sent by the chunked uploader.
UploadEntry = tuple[UploadedFile, str | None, int | None]


def close_upload(file: UploadedFile) -> None:
    file.file.close()


@dataclass
class LocalUpload:
    filename: str
    content_type: str
    file: Any


def duration_ms(started_at: datetime, ended_at: datetime | None = None) -> int:
    ended = ended_at or utcnow()
    return max(0, int((ended - started_at).total_seconds() * 1000))


def sorted_batch_items(items) -> list[BatchItem]:
    return sorted(items, key=module_item_sort_key)


def sorted_module_items(items) -> list[Any]:
    return sorted(items, key=module_item_sort_key)


def sorted_workflow_items(items) -> list[WorkflowRunItem]:
    return sorted(items, key=module_item_sort_key)


def module_item_sort_key(item: Any) -> tuple[str, int, str]:
    """Upload order (or filename), then page order; pages of one document stay together."""
    page_number = getattr(item, "page_number", None) or 0
    upload_index = getattr(item, "upload_index", None)
    if upload_index is not None:
        return (f"{upload_index:012d}", page_number, item.id)
    return (f"z:{item.filename.casefold()}", page_number, item.id)


def validate_upload_file_count(files: list[UploadedFile]) -> None:
    limit = get_settings().upload_max_batch_files
    if limit > 0 and len(files) > limit:
        raise PayloadTooLargeError(batch_file_limit_message())


def validate_declared_batch_file_count(file_count: int) -> None:
    limit = get_settings().upload_max_batch_files
    if limit > 0 and file_count > limit:
        raise PayloadTooLargeError(batch_file_limit_message())


def batch_file_limit_message() -> str:
    limit = get_settings().upload_max_batch_files
    if limit > 0:
        return f"Batch file count exceeds the configured limit of {limit}"
    return "Batch file count exceeds the multipart parser limit"


def _existing_client_file_ids(db: Session, item_model: Any, owner_field: str, owner_id: str, client_file_ids: list[str | None]) -> set[str]:
    ids = [client_file_id for client_file_id in client_file_ids if client_file_id]
    if not ids:
        return set()
    rows = (
        db.query(item_model.client_file_id).filter(getattr(item_model, owner_field) == owner_id, item_model.client_file_id.in_(ids)).all()
    )
    return {row[0] for row in rows if row[0]}


def _existing_upload_indexes(db: Session, item_model: Any, owner_field: str, owner_id: str, upload_indexes: list[int | None]) -> set[int]:
    if not hasattr(item_model, "upload_index"):
        return set()
    indexes = [upload_index for upload_index in upload_indexes if upload_index is not None]
    if not indexes:
        return set()
    rows = (
        db.query(item_model.upload_index).filter(getattr(item_model, owner_field) == owner_id, item_model.upload_index.in_(indexes)).all()
    )
    return {row[0] for row in rows if row[0] is not None}


def filter_new_upload_entries(
    db: Session,
    item_model: Any,
    owner_field: str,
    owner_id: str,
    entries: list[UploadEntry],
) -> list[UploadEntry]:
    existing_ids = _existing_client_file_ids(db, item_model, owner_field, owner_id, [client_id for _, client_id, _ in entries])
    existing_indexes = _existing_upload_indexes(db, item_model, owner_field, owner_id, [upload_index for _, _, upload_index in entries])
    accepted_ids = set(existing_ids)
    accepted_indexes = set(existing_indexes)
    new_entries: list[UploadEntry] = []
    for file, client_file_id, upload_index in entries:
        if client_file_id and client_file_id in accepted_ids:
            continue
        if upload_index is not None and upload_index in accepted_indexes:
            continue
        new_entries.append((file, client_file_id, upload_index))
        if client_file_id:
            accepted_ids.add(client_file_id)
        if upload_index is not None:
            accepted_indexes.add(upload_index)
    return new_entries


def ensure_upload_append_capacity(
    db: Session,
    item_model: Any,
    owner_field: str,
    owner_id: str,
    total_count: int,
    incoming_count: int,
) -> None:
    current_count = db.query(item_model).filter(getattr(item_model, owner_field) == owner_id).count()
    if current_count + incoming_count > total_count:
        raise PayloadTooLargeError("Batch upload exceeds declared file count")


def upload_failure_message(exc: Exception) -> str:
    if isinstance(exc, AppError):
        return str(exc.detail)
    if isinstance(exc, DocumentProcessingError):
        return str(exc)
    return "Failed to process uploaded document"


def owner_accepts_uploads(owner: Any) -> bool:
    return getattr(owner, "status", None) in BATCH_UPLOAD_OPEN_STATUSES | WORKFLOW_RUN_UPLOAD_OPEN_STATUSES


def validate_owner_can_start(owner: Any, items: list[Any]) -> None:
    validate_owner_upload_complete(owner, items)
    preprocessing_count = sum(1 for item in items if _upload_item_status(item) == ModuleJobStatus.PREPROCESSING)
    if preprocessing_count:
        raise UnprocessableError(
            {"message": f"{preprocessing_count} file(s) are still preprocessing", "preprocessing_count": preprocessing_count},
        )


def validate_owner_upload_complete(owner: Any, items: list[Any]) -> None:
    uploaded_count = len(items)
    if uploaded_count != owner.total_count:
        missing_count = max(0, owner.total_count - uploaded_count)
        raise UnprocessableError(
            {
                "message": "Upload is incomplete. Re-select the original files to continue uploading before starting execution.",
                "uploaded_count": uploaded_count,
                "total_count": owner.total_count,
                "missing_count": missing_count,
            },
        )


def _upload_item_status(item: Any) -> str:
    status = getattr(item, "status", None)
    if isinstance(status, str):
        return status
    job = getattr(item, "job", None)
    if job and isinstance(job.status, str):
        return job.status
    return "unknown"
