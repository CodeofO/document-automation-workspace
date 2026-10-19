from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse
from PIL import Image
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.application import documents as documents_service
from app.application import library as library_service
from app.application.documents import document_read, image_media_type, repair_image_document_if_needed
from app.application.library import document_library_query, selected_library_documents
from app.core.errors import GoneError, NotFoundError, ensure_found
from app.domain.status import DocumentStatus
from app.models import (
    Document,
    DocumentPage,
)
from app.schemas import (
    DocumentBatchUploadRead,
    DocumentRead,
    DocumentSelectionRequest,
)
from app.storage import materialize_storage_ref

router = APIRouter()

# Page images change in place when rotation is corrected, so browsers must revalidate them.
PAGE_IMAGE_CACHE_HEADERS = {"Cache-Control": "no-cache"}


@router.post("/api/documents", response_model=DocumentRead)
def upload_document(file: UploadFile = File(...), db: Session = Depends(get_db)) -> DocumentRead:
    return documents_service.upload_document(file, db)


@router.get("/api/documents", response_model=list[DocumentRead])
def list_documents(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    q: str | None = Query(default=None),
    library_path: str | None = Query(default=None),
    status: str | None = Query(default=None),
    include_deleted: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[DocumentRead]:
    query = document_library_query(db, include_deleted=include_deleted, status=status, q=q, library_path=library_path)
    documents = query.order_by(Document.created_at.desc(), Document.id.desc()).offset(offset).limit(limit).all()
    return [document_read(document) for document in documents]


@router.get("/api/documents/ids", response_model=list[str])
def list_document_ids(
    limit: int = Query(default=10000, ge=1, le=20000),
    q: str | None = Query(default=None),
    library_path: str | None = Query(default=None),
    status: str | None = Query(default=None),
    include_deleted: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[str]:
    query = document_library_query(db, include_deleted=include_deleted, status=status, q=q, library_path=library_path)
    rows = query.order_by(Document.created_at.desc(), Document.id.desc()).with_entities(Document.id).limit(limit).all()
    return [row[0] for row in rows]


@router.post("/api/documents/selection", response_model=DocumentBatchUploadRead)
def get_selected_documents(payload: DocumentSelectionRequest, db: Session = Depends(get_db)) -> DocumentBatchUploadRead:
    documents = selected_library_documents(db, list(dict.fromkeys(payload.document_ids)))
    return DocumentBatchUploadRead(documents=[document_read(document) for document in documents])


@router.post("/api/documents/delete", response_model=DocumentBatchUploadRead)
def delete_selected_documents_from_library(payload: DocumentSelectionRequest, db: Session = Depends(get_db)) -> DocumentBatchUploadRead:
    return library_service.delete_selected_documents_from_library(payload, db)


@router.get("/api/documents/{document_id}", response_model=DocumentRead)
def get_document(document_id: str, db: Session = Depends(get_db)) -> DocumentRead:
    document = db.get(Document, document_id)
    ensure_found(document, "Document not found")
    if document.status == DocumentStatus.READY:
        repair_image_document_if_needed(document, db)
    return document_read(document)


@router.delete("/api/documents/{document_id}", response_model=DocumentRead)
def delete_document_from_library(document_id: str, db: Session = Depends(get_db)) -> DocumentRead:
    return library_service.delete_document_from_library(document_id, db)


@router.get("/api/documents/{document_id}/pages/{page_number}/image")
def get_document_page_image(document_id: str, page_number: int, db: Session = Depends(get_db)) -> FileResponse:
    document = db.get(Document, document_id)
    ensure_found(document, "Document not found")
    if document and document.status == DocumentStatus.DELETED:
        raise GoneError("Original document was deleted")
    page = db.query(DocumentPage).filter(DocumentPage.document_id == document_id, DocumentPage.page_number == page_number).one_or_none()
    if not page:
        raise NotFoundError("Document page not found")
    if document and document.status == DocumentStatus.READY:
        repair_image_document_if_needed(document, db)
        db.refresh(page)
    path = materialize_storage_ref(page.image_path)
    if not path.exists():
        raise NotFoundError("Document page image missing")
    return FileResponse(path, media_type=image_media_type(path), headers=PAGE_IMAGE_CACHE_HEADERS)


@router.get("/api/documents/{document_id}/pages/{page_number}/thumbnail")
def get_document_page_thumbnail(
    document_id: str,
    page_number: int,
    width: int = Query(default=96, ge=48, le=512),
    db: Session = Depends(get_db),
) -> FileResponse:
    document = db.get(Document, document_id)
    ensure_found(document, "Document not found")
    if document and document.status == DocumentStatus.DELETED:
        raise GoneError("Original document was deleted")
    page = db.query(DocumentPage).filter(DocumentPage.document_id == document_id, DocumentPage.page_number == page_number).one_or_none()
    if not page:
        raise NotFoundError("Document page not found")
    if document and document.status == DocumentStatus.READY:
        repair_image_document_if_needed(document, db)
        db.refresh(page)
    source_path = materialize_storage_ref(page.image_path)
    if not source_path.exists():
        raise NotFoundError("Document page image missing")

    thumbnail_path = source_path.with_name(f"{source_path.stem}_thumb_{width}.jpg")
    if not thumbnail_path.exists() or thumbnail_path.stat().st_mtime < source_path.stat().st_mtime:
        with Image.open(source_path) as source:
            image = source.convert("RGB")
            ratio = width / max(1, image.width)
            target_size = (width, max(1, round(image.height * ratio)))
            image = image.resize(target_size, Image.Resampling.LANCZOS)
            image.save(thumbnail_path, format="JPEG", quality=82, optimize=True)

    return FileResponse(thumbnail_path, media_type="image/jpeg", headers=PAGE_IMAGE_CACHE_HEADERS)
