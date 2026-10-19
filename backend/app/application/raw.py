import shutil

from sqlalchemy.orm import Session

from app.application.uploads import UploadedFile
from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, GoneError, ensure_found
from app.domain.status import DocumentStatus, RawExtractionStatus
from app.models import (
    Document,
    RawExtraction,
)
from app.raw_extractor import RawExtractionError, RawExtractionOptions, create_raw_outputs, save_raw_upload, validate_raw_upload
from app.schemas import (
    RawExtractionFromDocumentRequest,
    RawExtractionRead,
)
from app.storage import materialize_storage_ref, persist_artifact


def upload_raw_extraction(file: UploadedFile, include_images: bool, include_formulas: bool, db: Session) -> RawExtractionRead:
    try:
        source_format = validate_raw_upload(file.filename or "")[1:]
    except RawExtractionError as exc:
        raise AppError(str(exc), status_code=exc.status_code) from exc

    raw = RawExtraction(
        filename=file.filename or "uploaded_document",
        source_format=source_format,
        size_bytes=0,
        status=RawExtractionStatus.PROCESSING,
    )
    db.add(raw)
    db.flush()

    try:
        filename, source_format, original_path, size_bytes = save_raw_upload(file, raw.id)
        raw.filename = filename
        raw.source_format = source_format
        raw.storage_path = str(original_path)
        raw.size_bytes = size_bytes
        pdf_path, html_path, warnings = create_raw_outputs(
            original_path,
            source_format,
            RawExtractionOptions(include_images=include_images, include_formulas=include_formulas),
        )
        if get_settings().storage_backend.strip().lower() == "s3":
            raw.storage_path = persist_artifact(original_path, f"raw/{raw.id}/original.{source_format}")
            raw.pdf_path = persist_artifact(pdf_path, f"raw/{raw.id}/preview.pdf", "application/pdf")
            raw.html_path = persist_artifact(html_path, f"raw/{raw.id}/content.html", "text/html; charset=utf-8")
        else:
            raw.pdf_path = str(pdf_path)
            raw.html_path = str(html_path)
        raw.warnings = list(warnings)
        raw.status = RawExtractionStatus.COMPLETED
        raw.error_message = None
    except RawExtractionError as exc:
        db.rollback()
        raise AppError(str(exc), status_code=exc.status_code) from exc
    except Exception as exc:
        raw.status = RawExtractionStatus.FAILED
        raw.error_message = str(exc)
    db.commit()
    db.refresh(raw)
    return raw_extraction_read(raw)


def create_raw_extraction_from_document(payload: RawExtractionFromDocumentRequest, db: Session) -> RawExtractionRead:
    document = db.get(Document, payload.document_id)
    ensure_found(document, "Document not found")
    if document.status == DocumentStatus.DELETED:
        raise GoneError("Original document was deleted")
    if document.status != DocumentStatus.READY:
        raise ConflictError({"message": "Document is not ready yet", "status": document.status})
    try:
        source_format = validate_raw_upload(document.filename)[1:]
    except RawExtractionError as exc:
        raise AppError(str(exc), status_code=exc.status_code) from exc

    raw = RawExtraction(
        filename=document.filename,
        source_format=source_format,
        size_bytes=document.size_bytes,
        storage_path=document.storage_path,
        status=RawExtractionStatus.PROCESSING,
    )
    db.add(raw)
    db.flush()

    try:
        source_path = materialize_storage_ref(document.storage_path)
        if not source_path.exists():
            raise RawExtractionError("Original document file is missing", status_code=404)
        work_dir = get_settings().resolved_raw_storage_dir / raw.id
        work_dir.mkdir(parents=True, exist_ok=True)
        suffix = source_path.suffix or f".{source_format}"
        working_original = work_dir / f"original{suffix}"
        if source_path != working_original:
            shutil.copy2(source_path, working_original)
        pdf_path, html_path, warnings = create_raw_outputs(
            working_original,
            source_format,
            RawExtractionOptions(include_images=payload.include_images, include_formulas=payload.include_formulas),
        )
        if get_settings().storage_backend.strip().lower() == "s3":
            raw.storage_path = persist_artifact(working_original, f"raw/{raw.id}/original.{source_format}")
            raw.pdf_path = persist_artifact(pdf_path, f"raw/{raw.id}/preview.pdf", "application/pdf")
            raw.html_path = persist_artifact(html_path, f"raw/{raw.id}/content.html", "text/html; charset=utf-8")
        else:
            raw.storage_path = str(working_original)
            raw.pdf_path = str(pdf_path)
            raw.html_path = str(html_path)
        raw.warnings = list(warnings)
        raw.status = RawExtractionStatus.COMPLETED
        raw.error_message = None
    except RawExtractionError as exc:
        db.rollback()
        raise AppError(str(exc), status_code=exc.status_code) from exc
    except Exception as exc:
        raw.status = RawExtractionStatus.FAILED
        raw.error_message = str(exc)
    db.commit()
    db.refresh(raw)
    return raw_extraction_read(raw)


def raw_extraction_read(raw: RawExtraction) -> RawExtractionRead:
    return RawExtractionRead(
        id=raw.id,
        filename=raw.filename,
        source_format=raw.source_format,
        size_bytes=raw.size_bytes,
        status=raw.status,
        pdf_url=f"/api/raw-extractions/{raw.id}/pdf" if raw.pdf_path else None,
        html_url=f"/api/raw-extractions/{raw.id}/html" if raw.html_path else None,
        warnings=raw.warnings or [],
        error_message=raw.error_message,
        created_at=raw.created_at,
        updated_at=raw.updated_at,
    )
