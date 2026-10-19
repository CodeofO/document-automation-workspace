from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_db
from app.application import raw as raw_service
from app.core.errors import NotFoundError, UnprocessableError, ensure_found
from app.models import RawExtraction
from app.schemas import (
    RawExtractionFromDocumentRequest,
    RawExtractionRead,
)
from app.storage import materialize_storage_ref

router = APIRouter()


@router.post("/api/raw-extractions", response_model=RawExtractionRead)
async def upload_raw_extraction(
    request: Request,
    file: UploadFile | None = File(default=None),
    document_id: str | None = Form(default=None),
    include_images: bool = Form(default=True),
    include_formulas: bool = Form(default=False),
    db: Session = Depends(get_db),
) -> RawExtractionRead:
    """Run raw extraction on an uploaded ``file`` or on a library document (``document_id``).

    ``document_id`` may be sent as a form field or as a JSON body
    (``{"document_id": ..., "include_images": ..., "include_formulas": ...}``).
    """
    if request.headers.get("content-type", "").startswith("application/json"):
        try:
            payload = RawExtractionFromDocumentRequest.model_validate(await request.json())
        except ValueError as exc:
            raise UnprocessableError("Invalid JSON body; document_id is required") from exc
        return await run_in_threadpool(raw_service.create_raw_extraction_from_document, payload, db)
    if file is not None and document_id:
        raise UnprocessableError("Send either file or document_id, not both")
    if document_id:
        payload = RawExtractionFromDocumentRequest(
            document_id=document_id, include_images=include_images, include_formulas=include_formulas
        )
        return await run_in_threadpool(raw_service.create_raw_extraction_from_document, payload, db)
    if file is None:
        raise UnprocessableError("file or document_id is required")
    return await run_in_threadpool(raw_service.upload_raw_extraction, file, include_images, include_formulas, db)


@router.post("/api/raw-extractions/from-document", response_model=RawExtractionRead)
def create_raw_extraction_from_document(
    payload: RawExtractionFromDocumentRequest,
    db: Session = Depends(get_db),
) -> RawExtractionRead:
    return raw_service.create_raw_extraction_from_document(payload, db)


@router.get("/api/raw-extractions", response_model=list[RawExtractionRead])
def list_raw_extractions(
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[RawExtractionRead]:
    rows = db.query(RawExtraction).order_by(RawExtraction.created_at.desc()).limit(limit).all()
    return [raw_service.raw_extraction_read(row) for row in rows]


@router.get("/api/raw-extractions/{raw_id}/pdf")
def get_raw_extraction_pdf(raw_id: str, db: Session = Depends(get_db)) -> FileResponse:
    raw = db.get(RawExtraction, raw_id)
    ensure_found(raw, "Raw extraction not found")
    if not raw.pdf_path:
        raise NotFoundError("Raw extraction PDF preview is not available")
    path = materialize_storage_ref(raw.pdf_path)
    if not path.exists():
        raise NotFoundError("Raw extraction PDF preview is missing")
    return FileResponse(path, media_type="application/pdf")


@router.get("/api/raw-extractions/{raw_id}/html")
def get_raw_extraction_html(raw_id: str, db: Session = Depends(get_db)) -> FileResponse:
    raw = db.get(RawExtraction, raw_id)
    ensure_found(raw, "Raw extraction not found")
    if not raw.html_path:
        raise NotFoundError("Raw extraction HTML is not available")
    path = materialize_storage_ref(raw.html_path)
    if not path.exists():
        raise NotFoundError("Raw extraction HTML is missing")
    return FileResponse(path, media_type="text/html")


@router.get("/api/raw-extractions/{raw_id}", response_model=RawExtractionRead)
def get_raw_extraction(raw_id: str, db: Session = Depends(get_db)) -> RawExtractionRead:
    raw = db.get(RawExtraction, raw_id)
    ensure_found(raw, "Raw extraction not found")
    return raw_service.raw_extraction_read(raw)
