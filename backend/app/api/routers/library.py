from fastapi import APIRouter, BackgroundTasks, Depends, Query, Request
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from app.api.deps import get_db
from app.api.jobs import schedule_job, schedule_job_async
from app.api.uploads import read_batch_upload_form, upload_library_paths
from app.application import library as library_service
from app.application.dispatch import JobDispatch
from app.application.documents import document_read
from app.application.library import document_tree_read
from app.application.uploads import UploadedFile
from app.schemas import (
    DocumentBatchUploadRead,
    DocumentLibraryActionRead,
    DocumentLibraryClipboardRequest,
    DocumentLibraryCreateFolderRequest,
    DocumentTreeRead,
)

router = APIRouter()


def _conversion_dispatches(conversion_job_ids: list[str]) -> list[JobDispatch]:
    return [JobDispatch("document_conversion", (job_id,)) for job_id in conversion_job_ids]


@router.post("/api/library/uploads", response_model=DocumentBatchUploadRead)
async def upload_library_documents(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> DocumentBatchUploadRead:
    form, files = await read_batch_upload_form(request)
    response, conversion_job_ids = await run_in_threadpool(_upload_library_documents, files, upload_library_paths(form, files), db)
    await schedule_job_async(background_tasks, _conversion_dispatches(conversion_job_ids))
    return response


def _upload_library_documents(
    files: list[UploadedFile], library_paths: list[str | None], db: Session
) -> tuple[DocumentBatchUploadRead, list[str]]:
    documents, conversion_job_ids = library_service.upload_library_files(files, library_paths, db)
    for document in documents:
        db.refresh(document)
    return DocumentBatchUploadRead(documents=[document_read(document) for document in documents]), conversion_job_ids


@router.get("/api/library/tree", response_model=DocumentTreeRead)
def get_document_library_tree(include_deleted: bool = Query(default=False), db: Session = Depends(get_db)) -> DocumentTreeRead:
    return document_tree_read(db, include_deleted=include_deleted)


@router.post("/api/library/folders", response_model=DocumentTreeRead)
def create_library_folder(payload: DocumentLibraryCreateFolderRequest, db: Session = Depends(get_db)) -> DocumentTreeRead:
    return library_service.create_library_folder(payload, db)


@router.post("/api/library/move", response_model=DocumentLibraryActionRead)
def move_library_entries(payload: DocumentLibraryClipboardRequest, db: Session = Depends(get_db)) -> DocumentLibraryActionRead:
    result = library_service.move_library_entries(payload, db)
    db.commit()
    return result


@router.post("/api/library/copy", response_model=DocumentLibraryActionRead)
def copy_library_entries(
    payload: DocumentLibraryClipboardRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> DocumentLibraryActionRead:
    result, conversion_job_ids = library_service.copy_library_entries(payload, db)
    db.commit()
    schedule_job(background_tasks, _conversion_dispatches(conversion_job_ids))
    return result
