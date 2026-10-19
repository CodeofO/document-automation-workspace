import errno
from typing import Any

from fastapi import Request, UploadFile
from starlette.datastructures import FormData
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.application.library import normalize_library_path
from app.application.uploads import batch_file_limit_message, validate_upload_file_count
from app.core.config import get_settings
from app.core.errors import InvalidRequestError, PayloadTooLargeError


def upload_library_paths(form: FormData, files: list[UploadFile]) -> list[str | None]:
    raw_values = list(form.getlist("library_paths") or form.getlist("relative_paths") or [])
    paths = [str(value) if value is not None else "" for value in raw_values]
    if len(paths) != len(files):
        paths = [getattr(file, "filename", "") or "" for file in files]
    return [normalize_library_path(path) or (file.filename or "") for path, file in zip(paths, files, strict=False)]


def _upload_file_sort_key(file: UploadFile) -> tuple[str, str]:
    filename = file.filename or ""
    return (filename.casefold(), filename)


async def read_batch_upload_form(request: Request) -> tuple[FormData, list[UploadFile]]:
    settings = get_settings()
    try:
        form = await request.form(
            max_files=_multipart_max_files(settings.upload_max_batch_files),
            max_fields=max(32, settings.upload_chunk_files * 3 + 16),
        )
    except StarletteHTTPException as exc:
        detail = str(exc.detail)
        if "Too many files" in detail or "Maximum number of files" in detail:
            raise PayloadTooLargeError(batch_file_limit_message()) from exc
        raise InvalidRequestError(f"Invalid multipart upload: {detail}") from exc
    except OSError as exc:
        if exc.errno == errno.EMFILE:
            raise PayloadTooLargeError(
                "Too many files were uploaded in a single request. Upload large batches in smaller chunks.",
            ) from exc
        raise

    files = [item for item in form.getlist("files") if _is_upload_file(item)]
    if not files:
        raise InvalidRequestError("At least one file is required")
    validate_upload_file_count(files)
    return form, files


def _multipart_max_files(upload_limit: int) -> int:
    if upload_limit > 0:
        return max(1000, upload_limit)
    return 10000


def _is_upload_file(value: Any) -> bool:
    return hasattr(value, "filename") and hasattr(value, "file")


def required_form_value(form: FormData, key: str) -> str:
    value = form.get(key)
    if not isinstance(value, str) or not value.strip():
        raise InvalidRequestError(f"{key} is required")
    return value.strip()


def ordered_upload_entries(form: FormData, files: list[UploadFile]) -> list[tuple[UploadFile, str | None, int | None]]:
    raw_client_ids = [value if isinstance(value, str) and value.strip() else None for value in form.getlist("client_file_ids")]
    if len(raw_client_ids) != len(files):
        raw_client_ids = [None] * len(files)
    raw_upload_indexes: list[int | None] = []
    for value in form.getlist("upload_indexes"):
        if isinstance(value, str) and value.strip():
            try:
                parsed = int(value)
                raw_upload_indexes.append(parsed if parsed >= 0 else None)
            except ValueError:
                raw_upload_indexes.append(None)
        else:
            raw_upload_indexes.append(None)
    if len(raw_upload_indexes) != len(files):
        raw_upload_indexes = [None] * len(files)
    return sorted(
        zip(files, raw_client_ids, raw_upload_indexes, strict=False),
        key=lambda entry: (entry[2] is None, entry[2] if entry[2] is not None else 0, *_upload_file_sort_key(entry[0])),
    )
