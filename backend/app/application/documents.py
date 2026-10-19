from pathlib import Path

from sqlalchemy.orm import Session

from app.application.uploads import UploadedFile
from app.audit import log_audit_event
from app.core.config import get_settings
from app.core.errors import AppError, GoneError, InvalidRequestError, NotFoundError, UnprocessableError, ensure_found
from app.document_processor import (
    DocumentProcessingError,
    is_supported_image,
    rasterize_document,
    rasterize_image_page,
    read_image_size,
    save_upload_file,
)
from app.domain.status import DOCUMENT_CONVERTING_STATUSES, DocumentStatus, JobAdmission
from app.models import (
    ClassificationJob,
    Document,
    DocumentPage,
    ExtractionJob,
    RequiredFieldCheckJob,
    TableExtractionJob,
)
from app.rotation import apply_page_rotation, rotate_image_file
from app.schemas import (
    DocumentPageRead,
    DocumentRead,
    PageRotateRequest,
)
from app.storage import delete_storage_ref, is_s3_ref, materialize_storage_ref, persist_artifact, scratch_dir_for_ref


def document_read(document: Document) -> DocumentRead:
    return DocumentRead(
        document_id=document.id,
        filename=document.filename,
        library_path=document.library_path,
        mime_type=document.mime_type,
        size_bytes=document.size_bytes,
        page_count=document.page_count,
        status=document.status,
        error_message=document.error_message,
        document_type=document.document_type,
        language=document.language,
        ai_summary=document.ai_summary,
        recommendation_reasoning=document.recommendation_reasoning,
        created_at=document.created_at,
        deleted_at=document.deleted_at,
        pages=[
            DocumentPageRead(
                id=page.id,
                page=page.page_number,
                image_url=f"/api/documents/{document.id}/pages/{page.page_number}/image",
                width=page.width,
                height=page.height,
                rotation_applied=page.rotation_applied or 0,
            )
            for page in document.pages
        ],
    )


def repair_image_document_if_needed(document: Document, db: Session) -> None:
    source_path = materialize_storage_ref(document.storage_path)
    if not is_supported_image(source_path) or not source_path.exists() or not document.pages:
        return

    page = document.pages[0]
    try:
        source_width, source_height = read_image_size(source_path)
    except DocumentProcessingError:
        return
    page_path = materialize_storage_ref(page.image_path)
    # A rotation-corrected page legitimately has swapped dimensions; compare against the rotated source.
    quarter_turned = page.rotation_applied in {90, 270}
    expected_width, expected_height = (source_height, source_width) if quarter_turned else (source_width, source_height)
    if page.width == expected_width and page.height == expected_height and page_path.exists():
        return

    try:
        page_info = rasterize_image_page(source_path, scratch_dir_for_ref(page.image_path, "repair"))
    except DocumentProcessingError:
        return

    if page.rotation_applied:
        page_info["width"], page_info["height"] = rotate_image_file(Path(str(page_info["image_path"])), page.rotation_applied)
    next_width = int(page_info["width"])
    next_height = int(page_info["height"])
    if page.width == next_width and page.height == next_height and page_path.exists():
        return

    if get_settings().storage_backend.strip().lower() == "s3":
        image_path = Path(str(page_info["image_path"]))
        page.image_path = persist_artifact(image_path, f"documents/{document.id}/pages/{image_path.name}", image_media_type(image_path))
    else:
        page.image_path = str(page_info["image_path"])
    page.width = next_width
    page.height = next_height
    document.page_count = 1
    db.commit()
    db.refresh(document)


def create_document_from_upload(file: UploadedFile, db: Session) -> Document:
    try:
        document, original_path = create_uploaded_document(file, db)
        preprocess_document_pages(document, original_path, db)
    except DocumentProcessingError as exc:
        raise AppError(str(exc), status_code=exc.status_code) from exc
    except Exception as exc:
        raise InvalidRequestError("Failed to process uploaded document") from exc
    return document


def create_uploaded_document(file: UploadedFile, db: Session) -> tuple[Document, Path]:
    filename, original_path, size_bytes = save_upload_file(file)
    document = Document(
        filename=filename,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
        page_count=0,
        storage_path=persist_original_artifact(original_path),
        status=DocumentStatus.PREPROCESSING,
    )
    db.add(document)
    db.flush()
    return document, original_path


def create_failed_upload_document(file: UploadedFile, message: str, db: Session) -> Document:
    return create_failed_upload_document_record(file.filename or "upload", file.content_type or "application/octet-stream", message, db)


def create_failed_upload_document_record(filename: str, mime_type: str, message: str, db: Session) -> Document:
    document = Document(
        filename=filename,
        mime_type=mime_type,
        size_bytes=0,
        page_count=0,
        storage_path="",
        status=DocumentStatus.FAILED,
        error_message=message,
    )
    db.add(document)
    db.flush()
    return document


def preprocess_document_pages(document: Document, original_path: Path, db: Session, *, raise_errors: bool = True) -> bool:
    try:
        pages = rasterize_document(original_path)
        pages = _persist_document_pages(original_path.parent.name, pages)
    except DocumentProcessingError as exc:
        document.status = DocumentStatus.FAILED
        document.error_message = str(exc)
        if raise_errors:
            raise
        return False
    except Exception as exc:
        document.status = DocumentStatus.FAILED
        document.error_message = "Failed to process uploaded document"
        if raise_errors:
            raise DocumentProcessingError("Failed to process uploaded document") from exc
        return False

    for existing in list(document.pages):
        db.delete(existing)
    db.flush()
    persisted_pages: list[dict[str, int | str]] = []
    for page in pages:
        image_path = Path(str(page["image_path"]))
        persisted_pages.append({**page, "image_path": str(image_path)})
        db.add(
            DocumentPage(
                document_id=document.id,
                page_number=int(page["page_number"]),
                image_path=str(page["image_path"]),
                width=int(page["width"]),
                height=int(page["height"]),
            )
        )
    document.page_count = len(persisted_pages)
    document.status = DocumentStatus.READY
    document.error_message = None
    return True


def execution_job_status_for_document(document: Document) -> JobAdmission:
    if document.status == DocumentStatus.READY:
        return JobAdmission.READY
    if document.status in DOCUMENT_CONVERTING_STATUSES:
        return JobAdmission.WAITING_FOR_DOCUMENT
    return JobAdmission.BLOCKED


def document_not_executable_message(document: Document) -> str:
    if document.status == DocumentStatus.DELETED:
        return "Original document was deleted"
    if document.status == DocumentStatus.FAILED:
        return document.error_message or "Document conversion failed"
    return f"Document is not executable in status {document.status}"


def raise_document_not_executable(document: Document) -> None:
    if document.status == DocumentStatus.DELETED:
        raise GoneError(document_not_executable_message(document))
    raise UnprocessableError(document_not_executable_message(document))


def documents_for_selection(document_ids: list[str], db: Session) -> list[Document]:
    ordered_ids: list[str] = []
    seen: set[str] = set()
    for document_id in document_ids:
        if document_id not in seen:
            ordered_ids.append(document_id)
            seen.add(document_id)
    documents = db.query(Document).filter(Document.id.in_(ordered_ids)).all()
    by_id = {document.id: document for document in documents}
    missing = [document_id for document_id in ordered_ids if document_id not in by_id]
    if missing:
        raise NotFoundError({"message": "Some documents were not found", "document_ids": missing})
    return [by_id[document_id] for document_id in ordered_ids]


def persist_original_artifact(original_path: Path) -> str:
    if get_settings().storage_backend.strip().lower() != "s3":
        return str(original_path)
    document_key = original_path.parent.name
    return persist_artifact(original_path, f"documents/{document_key}/original{original_path.suffix}")


def _persist_document_pages(document_key: str, pages: list[dict[str, int | str]]) -> list[dict[str, int | str]]:
    if get_settings().storage_backend.strip().lower() != "s3":
        return pages
    persisted_pages: list[dict[str, int | str]] = []
    for page in pages:
        image_path = Path(str(page["image_path"]))
        page_ref = persist_artifact(image_path, f"documents/{document_key}/pages/{image_path.name}", image_media_type(image_path))
        persisted_pages.append({**page, "image_path": page_ref})
    return persisted_pages


def image_media_type(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    return "application/octet-stream"


def delete_document_payloads(document_ids: list[str], db: Session) -> None:
    unique_document_ids = sorted({document_id for document_id in document_ids if document_id})
    if not unique_document_ids:
        return
    _delete_jobs_for_documents(unique_document_ids, db)
    documents = db.query(Document).filter(Document.id.in_(unique_document_ids)).all()
    for document in documents:
        delete_document_storage(document)
        for page in list(document.pages):
            db.delete(page)
        db.delete(document)


def _delete_jobs_for_documents(document_ids: list[str], db: Session) -> None:
    for model in (ExtractionJob, ClassificationJob, RequiredFieldCheckJob, TableExtractionJob):
        jobs = db.query(model).filter(model.document_id.in_(document_ids)).all()
        for job in jobs:
            if job.result:
                db.delete(job.result)
            db.delete(job)


def delete_document_storage(document: Document) -> None:
    refs = [document.storage_path, *(page.image_path for page in document.pages)]
    local_deleted = False
    if document.storage_path and not is_s3_ref(document.storage_path):
        storage_root = get_settings().resolved_storage_dir.resolve()
        document_dir = Path(document.storage_path).resolve().parent
        if document_dir != storage_root and storage_root in document_dir.parents:
            delete_storage_ref(document_dir)
            local_deleted = True
    if local_deleted:
        return
    for ref in refs:
        if ref:
            delete_storage_ref(ref)


def upload_document(file: UploadedFile, db: Session) -> DocumentRead:
    document = create_document_from_upload(file, db)
    if not document.library_path:
        document.library_path = document.filename
    log_audit_event(
        db,
        entity_type="document",
        entity_id=document.id,
        action="upload_processed",
        message=f"Processed {document.filename} in the document library",
        metadata={"filename": document.filename, "library_path": document.library_path},
    )
    db.commit()
    db.refresh(document)
    return document_read(document)


def rotate_document_page(document_id: str, page_number: int, payload: PageRotateRequest, db: Session) -> DocumentRead:
    document = db.get(Document, document_id)
    ensure_found(document, "Document not found")
    if document.status != DocumentStatus.READY:
        raise_document_not_executable(document)
    page = db.query(DocumentPage).filter(DocumentPage.document_id == document_id, DocumentPage.page_number == page_number).one_or_none()
    if not page:
        raise NotFoundError("Document page not found")
    apply_page_rotation(document, page, payload.degrees)
    log_audit_event(
        db,
        entity_type="document",
        entity_id=document.id,
        action="page_rotated",
        message=f"Rotated page {page_number} by {payload.degrees} degrees clockwise",
        metadata={"page_number": page_number, "degrees": payload.degrees, "rotation_applied": page.rotation_applied},
    )
    db.commit()
    db.refresh(document)
    return document_read(document)
