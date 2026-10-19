import shutil
from pathlib import Path
from typing import Any
from uuid import uuid4

from sqlalchemy.orm import Session

from app.application.documents import (
    delete_document_storage,
    document_read,
    image_media_type,
    persist_original_artifact,
)
from app.application.uploads import UploadedFile, close_upload, validate_upload_file_count
from app.audit import log_audit_event
from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.errors import AppError, ConflictError, InvalidRequestError, NotFoundError, UnprocessableError, ensure_found
from app.document_processor import (
    DocumentProcessingError,
    save_upload_file,
)
from app.domain.status import DOCUMENT_CONVERTING_STATUSES, ConversionJobStatus, DocumentStatus
from app.models import (
    Document,
    DocumentConversionJob,
    DocumentLibraryFolder,
    DocumentPage,
)
from app.schemas import (
    DocumentBatchUploadRead,
    DocumentLibraryActionRead,
    DocumentLibraryClipboardRequest,
    DocumentLibraryCreateFolderRequest,
    DocumentRead,
    DocumentSelectionRequest,
    DocumentTreeFolderRead,
    DocumentTreeRead,
)
from app.storage import materialize_storage_ref, persist_artifact


def document_tree_read(db: Session, *, include_deleted: bool = False) -> DocumentTreeRead:
    query = db.query(Document)
    if not include_deleted:
        query = query.filter(Document.status != DocumentStatus.DELETED)
    documents = query.all()
    folders: dict[str, dict[str, Any]] = {}

    def ensure_folder(path: str) -> dict[str, Any]:
        normalized = normalize_library_path(path)
        if normalized not in folders:
            parent = normalized.rsplit("/", 1)[0] if "/" in normalized else None
            folders[normalized] = {
                "path": normalized,
                "name": normalized.rsplit("/", 1)[-1] if normalized else "문서 보관함",
                "parent": parent,
                "total_count": 0,
                "ready_count": 0,
                "converting_count": 0,
                "failed_count": 0,
                "deleted_count": 0,
            }
            if parent is not None:
                ensure_folder(parent)
        return folders[normalized]

    ensure_folder("")
    for explicit_folder in db.query(DocumentLibraryFolder).order_by(DocumentLibraryFolder.path.asc()).all():
        ensure_folder(explicit_folder.path)

    for document in documents:
        for folder_path in _library_folder_ancestors(library_folder_path(document.library_path)):
            folder = ensure_folder(folder_path)
            folder["total_count"] += 1
            if document.status == DocumentStatus.READY:
                folder["ready_count"] += 1
            elif document.status in DOCUMENT_CONVERTING_STATUSES:
                folder["converting_count"] += 1
            elif document.status == DocumentStatus.DELETED:
                folder["deleted_count"] += 1
            elif document.status == DocumentStatus.FAILED:
                folder["failed_count"] += 1
    return DocumentTreeRead(folders=[DocumentTreeFolderRead(**folders[path]) for path in sorted(folders)])


def normalize_library_path(path: str | None) -> str:
    if not path:
        return ""
    normalized = str(path).replace("\\", "/").strip().strip("/")
    parts = [part.strip() for part in normalized.split("/") if part.strip() and part.strip() not in {".", ".."}]
    return "/".join(parts)


def library_folder_path(path: str | None) -> str:
    normalized = normalize_library_path(path)
    if not normalized or "/" not in normalized:
        return ""
    return normalized.rsplit("/", 1)[0]


def _library_folder_ancestors(path: str) -> list[str]:
    normalized = normalize_library_path(path)
    if not normalized:
        return [""]
    parts = normalized.split("/")
    ancestors = [""]
    for index in range(1, len(parts) + 1):
        ancestors.append("/".join(parts[:index]))
    return ancestors


def _library_basename(path: str | None, fallback: str) -> str:
    normalized = normalize_library_path(path)
    if not normalized:
        return fallback
    return normalized.rsplit("/", 1)[-1] or fallback


def _join_library_path(folder_path: str, name: str) -> str:
    folder = normalize_library_path(folder_path)
    clean_name = normalize_library_path(name).rsplit("/", 1)[-1] if name else ""
    return f"{folder}/{clean_name}" if folder else clean_name


def document_library_query(
    db: Session,
    *,
    include_deleted: bool = False,
    status: str | None = None,
    q: str | None = None,
    library_path: str | None = None,
):
    query = db.query(Document)
    if not include_deleted:
        query = query.filter(Document.status != DocumentStatus.DELETED)
    if status:
        query = query.filter(Document.status == status)
    if q:
        pattern = f"%{q.strip()}%"
        query = query.filter((Document.filename.ilike(pattern)) | (Document.library_path.ilike(pattern)))
    if library_path is not None:
        normalized_path = normalize_library_path(library_path)
        if normalized_path:
            query = query.filter(Document.library_path.ilike(f"{normalized_path}/%"))
        else:
            query = query.filter((Document.library_path.is_(None)) | (Document.library_path == "") | (~Document.library_path.contains("/")))
    return query


def ensure_library_folder_records(db: Session, folder_path: str) -> None:
    for path in _library_folder_ancestors(folder_path):
        if not path:
            continue
        if not _library_folder_record_exists(db, path):
            db.add(DocumentLibraryFolder(path=path))


def _library_folder_record_exists(db: Session, path: str) -> bool:
    if any(isinstance(item, DocumentLibraryFolder) and item.path == path for item in db.new):
        return True
    if any(isinstance(item, DocumentLibraryFolder) and item.path == path for item in db.dirty):
        return True
    query = db.query(DocumentLibraryFolder.id).filter(DocumentLibraryFolder.path == path)
    return query.one_or_none() is not None


def _normalize_library_clipboard_payload(payload: DocumentLibraryClipboardRequest) -> tuple[list[str], list[str], str]:
    document_ids = list(dict.fromkeys(document_id for document_id in payload.document_ids if document_id))
    folder_paths = list(dict.fromkeys(normalize_library_path(path) for path in payload.folder_paths if normalize_library_path(path)))
    target_folder = normalize_library_path(payload.target_folder)
    if not document_ids and not folder_paths:
        raise UnprocessableError("document_ids or folder_paths is required")
    return document_ids, folder_paths, target_folder


def _folder_path_contains(folder_path: str, candidate: str) -> bool:
    folder = normalize_library_path(folder_path)
    target = normalize_library_path(candidate)
    return bool(folder and (target == folder or target.startswith(f"{folder}/")))


def _existing_library_folder_paths(db: Session) -> set[str]:
    paths = {row[0] for row in db.query(DocumentLibraryFolder.path).all()}
    for row in db.query(Document.library_path).filter(Document.status != DocumentStatus.DELETED, Document.library_path.isnot(None)).all():
        folder_path = library_folder_path(row[0])
        paths.update(_library_folder_ancestors(folder_path))
    paths.discard("")
    return paths


def _copy_name(name: str, attempt: int) -> str:
    path = Path(name)
    suffix = path.suffix
    stem = path.name.removesuffix(suffix) if suffix else path.name
    marker = "copy" if attempt == 1 else f"copy {attempt}"
    return f"{stem} {marker}{suffix}"


def _unique_library_document_path(db: Session, desired_path: str, *, exclude_document_ids: set[str] | None = None) -> str:
    normalized = normalize_library_path(desired_path)
    folder = library_folder_path(normalized)
    name = _library_basename(normalized, "document")
    excluded = exclude_document_ids or set()
    candidate = normalized
    attempt = 0
    while True:
        query = db.query(Document.id).filter(Document.status != DocumentStatus.DELETED, Document.library_path == candidate)
        if excluded:
            query = query.filter(~Document.id.in_(excluded))
        if query.first() is None:
            return candidate
        attempt += 1
        candidate = _join_library_path(folder, _copy_name(name, attempt))


def _unique_library_folder_path(db: Session, desired_path: str, *, exclude_prefixes: set[str] | None = None) -> str:
    normalized = normalize_library_path(desired_path)
    parent = library_folder_path(normalized)
    name = _library_basename(normalized, "folder")
    excluded = exclude_prefixes or set()
    existing_paths = _existing_library_folder_paths(db)
    existing_paths = {
        path
        for path in existing_paths
        if not any(path == excluded_path or path.startswith(f"{excluded_path}/") for excluded_path in excluded if excluded_path)
    }
    candidate = normalized
    attempt = 0
    while candidate in existing_paths:
        attempt += 1
        candidate = _join_library_path(parent, _copy_name(name, attempt))
    return candidate


def _documents_in_library_folder(db: Session, folder_path: str) -> list[Document]:
    normalized = normalize_library_path(folder_path)
    if not normalized:
        return []
    return (
        db.query(Document)
        .filter(Document.status.notin_([DocumentStatus.DELETED, DocumentStatus.FAILED]), Document.library_path.ilike(f"{normalized}/%"))
        .order_by(Document.library_path.asc(), Document.created_at.asc(), Document.id.asc())
        .all()
    )


def selected_library_documents(db: Session, document_ids: list[str]) -> list[Document]:
    if not document_ids:
        return []
    documents = db.query(Document).filter(Document.id.in_(document_ids)).all()
    by_id = {document.id: document for document in documents}
    missing = [document_id for document_id in document_ids if document_id not in by_id]
    if missing:
        raise NotFoundError(f"Document not found: {missing[0]}")
    blocked = [document for document in documents if document.status in {DocumentStatus.DELETED, DocumentStatus.FAILED}]
    if blocked:
        raise ConflictError(f"Document cannot be copied or moved: {blocked[0].filename}")
    return [by_id[document_id] for document_id in document_ids]


def move_library_entries(payload: DocumentLibraryClipboardRequest, db: Session) -> DocumentLibraryActionRead:
    document_ids, folder_paths, target_folder = _normalize_library_clipboard_payload(payload)
    if target_folder:
        ensure_library_folder_records(db, target_folder)
    moved_documents: list[Document] = []
    moved_document_ids: set[str] = set()

    for folder_path in folder_paths:
        if _folder_path_contains(folder_path, target_folder):
            raise ConflictError("A folder cannot be moved into itself")
        source_parent = library_folder_path(folder_path)
        if source_parent == target_folder:
            new_folder_path = folder_path
        else:
            desired_folder_path = _join_library_path(target_folder, _library_basename(folder_path, "folder"))
            new_folder_path = _unique_library_folder_path(db, desired_folder_path, exclude_prefixes={folder_path})
        if new_folder_path != folder_path:
            _move_library_folder_records(db, folder_path, new_folder_path)
            for document in _documents_in_library_folder(db, folder_path):
                suffix = normalize_library_path(document.library_path).removeprefix(f"{folder_path}/")
                document.library_path = _unique_library_document_path(
                    db, _join_library_path(new_folder_path, suffix), exclude_document_ids={document.id}
                )
                moved_documents.append(document)
                moved_document_ids.add(document.id)
        ensure_library_folder_records(db, new_folder_path)

    for document in selected_library_documents(db, document_ids):
        if document.id in moved_document_ids:
            continue
        basename = _library_basename(document.library_path, document.filename)
        document.library_path = _unique_library_document_path(
            db, _join_library_path(target_folder, basename), exclude_document_ids={document.id}
        )
        moved_documents.append(document)
        moved_document_ids.add(document.id)

    log_audit_event(
        db,
        entity_type="document_library",
        entity_id=target_folder or "root",
        action="moved",
        message=f"Moved {len(moved_document_ids)} document(s) in the document library",
        metadata={"target_folder": target_folder, "document_count": len(moved_document_ids), "folder_paths": folder_paths},
    )
    db.flush()
    return DocumentLibraryActionRead(
        documents=[document_read(document) for document in moved_documents],
        folders=document_tree_read(db).folders,
    )


def _move_library_folder_records(db: Session, source_folder: str, target_folder: str) -> None:
    source = normalize_library_path(source_folder)
    target = normalize_library_path(target_folder)
    rows = (
        db.query(DocumentLibraryFolder)
        .filter((DocumentLibraryFolder.path == source) | (DocumentLibraryFolder.path.ilike(f"{source}/%")))
        .order_by(DocumentLibraryFolder.path.asc())
        .all()
    )
    for row in rows:
        suffix = row.path.removeprefix(source).lstrip("/")
        row.path = _join_library_path(target, suffix) if suffix else target


def copy_library_entries(payload: DocumentLibraryClipboardRequest, db: Session) -> tuple[DocumentLibraryActionRead, list[str]]:
    document_ids, folder_paths, target_folder = _normalize_library_clipboard_payload(payload)
    if target_folder:
        ensure_library_folder_records(db, target_folder)
    copied_documents: list[Document] = []
    conversion_job_ids: list[str] = []

    for folder_path in folder_paths:
        if _folder_path_contains(folder_path, target_folder):
            raise ConflictError("A folder cannot be copied into itself")
        desired_folder_path = _join_library_path(target_folder, _library_basename(folder_path, "folder"))
        new_folder_path = _unique_library_folder_path(db, desired_folder_path)
        ensure_library_folder_records(db, new_folder_path)
        for explicit_folder in sorted(
            [path for path in _existing_library_folder_paths(db) if path == folder_path or path.startswith(f"{folder_path}/")]
        ):
            suffix = explicit_folder.removeprefix(folder_path).lstrip("/")
            ensure_library_folder_records(db, _join_library_path(new_folder_path, suffix) if suffix else new_folder_path)
        for document in _documents_in_library_folder(db, folder_path):
            suffix = normalize_library_path(document.library_path).removeprefix(f"{folder_path}/")
            copied_document, conversion_job_id = _copy_library_document(
                document,
                _unique_library_document_path(db, _join_library_path(new_folder_path, suffix)),
                db,
            )
            copied_documents.append(copied_document)
            if conversion_job_id:
                conversion_job_ids.append(conversion_job_id)

    for document in selected_library_documents(db, document_ids):
        basename = _library_basename(document.library_path, document.filename)
        copied_document, conversion_job_id = _copy_library_document(
            document,
            _unique_library_document_path(db, _join_library_path(target_folder, basename)),
            db,
        )
        copied_documents.append(copied_document)
        if conversion_job_id:
            conversion_job_ids.append(conversion_job_id)

    log_audit_event(
        db,
        entity_type="document_library",
        entity_id=target_folder or "root",
        action="copied",
        message=f"Copied {len(copied_documents)} document(s) in the document library",
        metadata={"target_folder": target_folder, "document_count": len(copied_documents), "folder_paths": folder_paths},
    )
    db.flush()
    return (
        DocumentLibraryActionRead(
            documents=[document_read(document) for document in copied_documents],
            folders=document_tree_read(db).folders,
        ),
        conversion_job_ids,
    )


def _copy_library_document(source: Document, library_path: str, db: Session) -> tuple[Document, str | None]:
    if source.status in {DocumentStatus.DELETED, DocumentStatus.FAILED}:
        raise ConflictError(f"Document cannot be copied: {source.filename}")
    source_original = materialize_storage_ref(source.storage_path)
    if not source_original.exists():
        raise NotFoundError(f"Document payload is missing: {source.filename}")

    local_dir = get_settings().resolved_storage_dir / uuid4().hex
    local_dir.mkdir(parents=True, exist_ok=True)
    original_suffix = source_original.suffix or Path(source.filename).suffix
    local_original = local_dir / f"original{original_suffix or '.bin'}"
    shutil.copy2(source_original, local_original)

    copied = Document(
        filename=source.filename,
        mime_type=source.mime_type,
        size_bytes=source.size_bytes,
        page_count=0,
        storage_path="",
        library_path=normalize_library_path(library_path) or source.filename,
        status=DocumentStatus.QUEUED if source.status in DOCUMENT_CONVERTING_STATUSES else source.status,
        error_message=None,
        document_type=source.document_type,
        language=source.language,
        ai_summary=source.ai_summary,
        recommendation_reasoning=source.recommendation_reasoning,
    )
    db.add(copied)
    db.flush()
    copied.storage_path = persist_artifact(local_original, f"documents/{copied.id}/original{local_original.suffix}")

    if source.status == DocumentStatus.READY:
        page_dir = local_dir / "pages"
        page_dir.mkdir(parents=True, exist_ok=True)
        for page in source.pages:
            source_page = materialize_storage_ref(page.image_path)
            if not source_page.exists():
                raise NotFoundError(f"Document page payload is missing: {source.filename}")
            local_page = page_dir / source_page.name
            if local_page.exists():
                local_page = page_dir / f"page_{page.page_number:04d}{source_page.suffix or '.jpg'}"
            shutil.copy2(source_page, local_page)
            page_ref = persist_artifact(local_page, f"documents/{copied.id}/pages/{local_page.name}", image_media_type(local_page))
            db.add(
                DocumentPage(
                    document_id=copied.id,
                    page_number=page.page_number,
                    image_path=page_ref,
                    width=page.width,
                    height=page.height,
                )
            )
        copied.page_count = source.page_count
        return copied, None

    copied.page_count = 0
    copied.status = DocumentStatus.QUEUED
    job = DocumentConversionJob(document_id=copied.id, status=ConversionJobStatus.QUEUED)
    db.add(job)
    db.flush()
    return copied, job.id


def delete_library_document_payload(document: Document, db: Session) -> Document:
    if document.status == DocumentStatus.DELETED:
        return document
    delete_document_storage(document)
    for page in list(document.pages):
        db.delete(page)
    document.page_count = 0
    document.status = DocumentStatus.DELETED
    document.error_message = "Original document was deleted from the document library"
    document.deleted_at = utcnow()
    return document


def create_queued_library_document(file: UploadedFile, db: Session, *, library_path: str | None = None) -> tuple[Document, str]:
    filename, original_path, size_bytes = save_upload_file(file)
    display_path = normalize_library_path(library_path) or filename
    document = Document(
        filename=filename,
        mime_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
        page_count=0,
        storage_path=persist_original_artifact(original_path),
        library_path=display_path,
        status=DocumentStatus.QUEUED,
    )
    db.add(document)
    db.flush()
    job = DocumentConversionJob(document_id=document.id, status=ConversionJobStatus.QUEUED)
    db.add(job)
    db.flush()
    return document, job.id


def upload_library_files(files: list[UploadedFile], library_paths: list[str | None], db: Session) -> tuple[list[Document], list[str]]:
    """Store uploaded files as library documents queued for conversion. Returns the documents and their conversion job ids."""
    if not files:
        raise InvalidRequestError("At least one file is required")
    validate_upload_file_count(files)
    documents: list[Document] = []
    conversion_job_ids: list[str] = []
    try:
        for index, file in enumerate(files):
            document, conversion_job_id = create_queued_library_document(file, db, library_path=library_paths[index])
            documents.append(document)
            conversion_job_ids.append(conversion_job_id)
            log_audit_event(
                db,
                entity_type="document",
                entity_id=document.id,
                action="upload_queued",
                message=f"Queued {document.filename} for document conversion",
                metadata={"filename": document.filename, "library_path": document.library_path, "conversion_job_id": conversion_job_id},
            )
        db.commit()
    except DocumentProcessingError as exc:
        db.rollback()
        raise AppError(str(exc), status_code=exc.status_code) from exc
    except Exception:
        db.rollback()
        raise
    finally:
        for file in files:
            close_upload(file)
    return documents, conversion_job_ids


def create_library_folder(payload: DocumentLibraryCreateFolderRequest, db: Session) -> DocumentTreeRead:
    folder_path = normalize_library_path(payload.folder_path)
    if not folder_path:
        raise UnprocessableError("Folder path is required")
    ensure_library_folder_records(db, folder_path)
    log_audit_event(
        db,
        entity_type="document_library_folder",
        entity_id=folder_path,
        action="created",
        message=f"Created document library folder {folder_path}",
        metadata={"path": folder_path},
    )
    db.commit()
    return document_tree_read(db)


def delete_selected_documents_from_library(payload: DocumentSelectionRequest, db: Session) -> DocumentBatchUploadRead:
    document_ids = list(dict.fromkeys(payload.document_ids))
    documents = db.query(Document).filter(Document.id.in_(document_ids)).all()
    by_id = {document.id: document for document in documents}
    missing = [document_id for document_id in document_ids if document_id not in by_id]
    if missing:
        raise NotFoundError(f"Document not found: {missing[0]}")
    deleted_documents = [delete_library_document_payload(by_id[document_id], db) for document_id in document_ids]
    log_audit_event(
        db,
        entity_type="document",
        entity_id="bulk",
        action="bulk_deleted",
        message=f"Deleted original payloads for {len(deleted_documents)} document(s)",
        metadata={"document_ids": document_ids},
    )
    db.commit()
    for document in deleted_documents:
        db.refresh(document)
    return DocumentBatchUploadRead(documents=[document_read(document) for document in deleted_documents])


def delete_document_from_library(document_id: str, db: Session) -> DocumentRead:
    document = db.get(Document, document_id)
    ensure_found(document, "Document not found")
    delete_library_document_payload(document, db)
    log_audit_event(
        db,
        entity_type="document",
        entity_id=document.id,
        action="deleted",
        message="Deleted original document payload; historical results were kept",
        metadata={"filename": document.filename, "library_path": document.library_path},
    )
    db.commit()
    db.refresh(document)
    return document_read(document)
