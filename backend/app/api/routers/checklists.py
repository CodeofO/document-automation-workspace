from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.application import definitions as definitions_service
from app.application.definitions import checklist_read
from app.core.errors import ensure_found
from app.models import RequiredFieldChecklist
from app.schemas import (
    RequiredFieldChecklistCreate,
    RequiredFieldChecklistRead,
    RequiredFieldChecklistRecommendationRead,
    RequiredFieldChecklistRecommendationRequest,
    RequiredFieldChecklistUpdate,
)

router = APIRouter()


@router.post("/api/required-field-checklists", response_model=RequiredFieldChecklistRead)
def create_required_field_checklist(payload: RequiredFieldChecklistCreate, db: Session = Depends(get_db)) -> RequiredFieldChecklistRead:
    return definitions_service.create_required_field_checklist(payload, db)


@router.get("/api/required-field-checklists", response_model=list[RequiredFieldChecklistRead])
def list_required_field_checklists(
    include_archived: bool = False,
    db: Session = Depends(get_db),
) -> list[RequiredFieldChecklistRead]:
    query = db.query(RequiredFieldChecklist)
    if not include_archived:
        query = query.filter(RequiredFieldChecklist.archived == False)  # noqa: E712
    rows = query.order_by(RequiredFieldChecklist.created_at.desc()).all()
    return [checklist_read(row) for row in rows]


@router.post("/api/required-field-checklists/recommendations", response_model=RequiredFieldChecklistRecommendationRead)
def recommend_required_field_checklist(
    payload: RequiredFieldChecklistRecommendationRequest,
    db: Session = Depends(get_db),
) -> RequiredFieldChecklistRecommendationRead:
    return definitions_service.recommend_required_field_checklist(payload, db)


@router.get("/api/required-field-checklists/{checklist_id}", response_model=RequiredFieldChecklistRead)
def get_required_field_checklist(checklist_id: str, db: Session = Depends(get_db)) -> RequiredFieldChecklistRead:
    checklist = db.get(RequiredFieldChecklist, checklist_id)
    ensure_found(checklist, "Required field checklist not found")
    return checklist_read(checklist)


@router.post("/api/required-field-checklists/{checklist_id}/duplicate", response_model=RequiredFieldChecklistRead)
def duplicate_required_field_checklist(checklist_id: str, db: Session = Depends(get_db)) -> RequiredFieldChecklistRead:
    return definitions_service.duplicate_required_field_checklist(checklist_id, db)


@router.patch("/api/required-field-checklists/{checklist_id}", response_model=RequiredFieldChecklistRead)
def update_required_field_checklist(
    checklist_id: str,
    payload: RequiredFieldChecklistUpdate,
    db: Session = Depends(get_db),
) -> RequiredFieldChecklistRead:
    return definitions_service.update_required_field_checklist(checklist_id, payload, db)


@router.delete("/api/required-field-checklists/{checklist_id}", response_model=RequiredFieldChecklistRead)
def delete_required_field_checklist(checklist_id: str, db: Session = Depends(get_db)) -> RequiredFieldChecklistRead:
    return definitions_service.delete_required_field_checklist(checklist_id, db)
