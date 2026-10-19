"""Table extraction (표 추출): templates, single/draft jobs, reviewer edits and batches (docs/table-extraction-api.md)."""

from fastapi import APIRouter, BackgroundTasks, Depends, Query, Response
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.api.jobs import schedule_job
from app.api.responses import export_artifact_response
from app.application import batches as batches_service
from app.application import table_jobs as table_jobs_service
from app.application import table_templates as table_templates_service
from app.application.batches import ModuleKind, table_extraction_batch_read
from app.application.exports import build_export_artifact, table_job_export_artifact
from app.audit import log_audit_event
from app.core.errors import ensure_found
from app.models import TableExtractionBatch
from app.table_schemas import (
    TableExtractionBatchFromDocumentsRequest,
    TableExtractionBatchRead,
    TableExtractionDraftJobCreate,
    TableExtractionJobCreate,
    TableExtractionJobRead,
    TableExtractionResultPatch,
    TableExtractionResultRead,
    TableRecommendationRead,
    TableRecommendationRequest,
    TableTemplateCreate,
    TableTemplateRead,
    TableTemplateUpdate,
)

router = APIRouter()

# --- templates ------------------------------------------------------------------------------


@router.post("/api/table-templates", response_model=TableTemplateRead)
def create_table_template(payload: TableTemplateCreate, db: Session = Depends(get_db)) -> TableTemplateRead:
    return table_templates_service.create_template(payload, db)


@router.get("/api/table-templates", response_model=list[TableTemplateRead])
def list_table_templates(
    include_archived: bool = False,
    include_ephemeral: bool = False,
    db: Session = Depends(get_db),
) -> list[TableTemplateRead]:
    return table_templates_service.list_templates(db, include_archived=include_archived, include_ephemeral=include_ephemeral)


@router.post("/api/table-templates/recommendations", response_model=TableRecommendationRead)
def recommend_table(payload: TableRecommendationRequest, db: Session = Depends(get_db)) -> TableRecommendationRead:
    return table_templates_service.recommend_table(payload, db)


@router.get("/api/table-templates/{template_id}", response_model=TableTemplateRead)
def get_table_template(template_id: str, db: Session = Depends(get_db)) -> TableTemplateRead:
    return table_templates_service.template_read(table_templates_service.get_template(template_id, db))


@router.patch("/api/table-templates/{template_id}", response_model=TableTemplateRead)
def update_table_template(template_id: str, payload: TableTemplateUpdate, db: Session = Depends(get_db)) -> TableTemplateRead:
    return table_templates_service.update_template(template_id, payload, db)


@router.delete("/api/table-templates/{template_id}", response_model=TableTemplateRead)
def archive_table_template(template_id: str, db: Session = Depends(get_db)) -> TableTemplateRead:
    return table_templates_service.archive_template(template_id, db)


@router.post("/api/table-templates/{template_id}/duplicate", response_model=TableTemplateRead)
def duplicate_table_template(template_id: str, db: Session = Depends(get_db)) -> TableTemplateRead:
    return table_templates_service.duplicate_template(template_id, db)


# --- jobs and results -----------------------------------------------------------------------


@router.post("/api/table-extraction-jobs", response_model=TableExtractionJobRead)
def create_table_extraction_job(
    payload: TableExtractionJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TableExtractionJobRead:
    response, dispatch = table_jobs_service.create_table_job(payload, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.post("/api/table-extraction-jobs/draft", response_model=TableExtractionJobRead)
def create_draft_table_extraction_job(
    payload: TableExtractionDraftJobCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TableExtractionJobRead:
    response, dispatch = table_jobs_service.create_draft_table_job(payload, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.get("/api/table-extraction-jobs", response_model=list[TableExtractionJobRead])
def list_table_extraction_jobs(
    document_id: str | None = None,
    limit: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> list[TableExtractionJobRead]:
    return table_jobs_service.list_table_jobs(db, document_id=document_id, limit=limit)


@router.get("/api/table-extraction-jobs/{job_id}", response_model=TableExtractionJobRead)
def get_table_extraction_job(job_id: str, db: Session = Depends(get_db)) -> TableExtractionJobRead:
    return table_jobs_service.get_table_job(job_id, db)


_EXPORT_RESPONSES = {
    200: {
        "description": "xlsx (one sheet per table + 검토_칸 + 검증_위반), csv (zip of per-table CSVs) or json (TableResults per page)",
        "content": {
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {},
            "application/zip": {},
            "application/json": {},
        },
    }
}


@router.get("/api/table-extraction-jobs/{job_id}/export", responses=_EXPORT_RESPONSES)
def export_table_extraction_job(
    job_id: str,
    format: str = Query(default="xlsx", pattern="^(json|csv|xlsx)$"),
    include_raw: bool = False,
    include_confidence: bool = False,
    db: Session = Depends(get_db),
) -> Response:
    artifact = table_job_export_artifact(db, job_id, format, include_raw=include_raw, include_confidence=include_confidence)
    return export_artifact_response(artifact)


@router.patch("/api/table-extraction-results/{result_id}", response_model=TableExtractionResultRead)
def patch_table_extraction_result(
    result_id: str,
    payload: TableExtractionResultPatch,
    db: Session = Depends(get_db),
) -> TableExtractionResultRead:
    return table_jobs_service.patch_table_result(result_id, payload, db)


# --- batches --------------------------------------------------------------------------------


@router.post("/api/table-extraction-batches/from-documents", response_model=TableExtractionBatchRead)
def create_table_extraction_batch_from_documents(
    payload: TableExtractionBatchFromDocumentsRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TableExtractionBatchRead:
    response, dispatch = table_jobs_service.create_table_batch_from_documents(payload, db)
    schedule_job(background_tasks, dispatch, db)
    return response


@router.get("/api/table-extraction-batches", response_model=list[TableExtractionBatchRead])
def list_table_extraction_batches(
    limit: int = Query(default=20, ge=1, le=100),
    include_items: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[TableExtractionBatchRead]:
    batches = db.query(TableExtractionBatch).order_by(TableExtractionBatch.created_at.desc()).limit(limit).all()
    return [table_extraction_batch_read(batch, include_items=include_items, db=db) for batch in batches]


@router.get("/api/table-extraction-batches/{batch_id}", response_model=TableExtractionBatchRead)
def get_table_extraction_batch(batch_id: str, db: Session = Depends(get_db)) -> TableExtractionBatchRead:
    batch = db.get(TableExtractionBatch, batch_id)
    ensure_found(batch, "Table extraction batch not found")
    return table_extraction_batch_read(batch)


@router.get("/api/table-extraction-batches/{batch_id}/summary", response_model=TableExtractionBatchRead)
def get_table_extraction_batch_summary(batch_id: str, db: Session = Depends(get_db)) -> TableExtractionBatchRead:
    batch = db.get(TableExtractionBatch, batch_id)
    ensure_found(batch, "Table extraction batch not found")
    return table_extraction_batch_read(batch, include_items=False, db=db)


@router.get("/api/table-extraction-batches/{batch_id}/export", responses=_EXPORT_RESPONSES)
def export_table_extraction_batch(
    batch_id: str,
    format: str = Query(default="xlsx", pattern="^(json|csv|xlsx)$"),
    include_raw: bool = False,
    include_confidence: bool = False,
    db: Session = Depends(get_db),
) -> Response:
    batch = db.get(TableExtractionBatch, batch_id)
    ensure_found(batch, "Table extraction batch not found")
    artifact = build_export_artifact(
        db, "table_extraction_batch", batch.id, format, include_raw=include_raw, include_confidence=include_confidence
    )
    log_audit_event(
        db,
        entity_type="table_extraction_batch",
        entity_id=batch.id,
        action="exported",
        message=f"Exported table extraction batch {format.upper()}",
        metadata={"format": format, "include_raw": include_raw, "include_confidence": include_confidence},
    )
    db.commit()
    return export_artifact_response(artifact)


@router.post("/api/table-extraction-batches/{batch_id}/cancel", response_model=TableExtractionBatchRead)
def cancel_table_extraction_batch(batch_id: str, db: Session = Depends(get_db)) -> TableExtractionBatchRead:
    return batches_service.cancel_batch(ModuleKind.TABLE, batch_id, db)


@router.post("/api/table-extraction-batches/{batch_id}/discard", response_model=TableExtractionBatchRead)
def discard_table_extraction_batch(batch_id: str, db: Session = Depends(get_db)) -> TableExtractionBatchRead:
    return batches_service.discard_batch(ModuleKind.TABLE, batch_id, db)


@router.post("/api/table-extraction-batches/{batch_id}/resume", response_model=TableExtractionBatchRead)
def resume_table_extraction_batch(
    batch_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
) -> TableExtractionBatchRead:
    response, dispatch = batches_service.resume_batch(ModuleKind.TABLE, batch_id, db)
    schedule_job(background_tasks, dispatch, db)
    return response
