from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.application import definitions as definitions_service
from app.application.definitions import classifier_read
from app.core.errors import ensure_found
from app.models import DocumentClassifier
from app.schemas import (
    DocumentClassifierCreate,
    DocumentClassifierRead,
    DocumentClassifierUpdate,
)

router = APIRouter()


@router.post("/api/document-classifiers", response_model=DocumentClassifierRead)
def create_document_classifier(payload: DocumentClassifierCreate, db: Session = Depends(get_db)) -> DocumentClassifierRead:
    return definitions_service.create_document_classifier(payload, db)


@router.get("/api/document-classifiers", response_model=list[DocumentClassifierRead])
def list_document_classifiers(
    include_archived: bool = False,
    db: Session = Depends(get_db),
) -> list[DocumentClassifierRead]:
    query = db.query(DocumentClassifier)
    if not include_archived:
        query = query.filter(DocumentClassifier.archived == False)  # noqa: E712
    rows = query.order_by(DocumentClassifier.created_at.desc()).all()
    return [classifier_read(row) for row in rows]


@router.get("/api/document-classifiers/{classifier_id}", response_model=DocumentClassifierRead)
def get_document_classifier(classifier_id: str, db: Session = Depends(get_db)) -> DocumentClassifierRead:
    classifier = db.get(DocumentClassifier, classifier_id)
    ensure_found(classifier, "Document classifier not found")
    return classifier_read(classifier)


@router.post("/api/document-classifiers/{classifier_id}/duplicate", response_model=DocumentClassifierRead)
def duplicate_document_classifier(classifier_id: str, db: Session = Depends(get_db)) -> DocumentClassifierRead:
    return definitions_service.duplicate_document_classifier(classifier_id, db)


@router.patch("/api/document-classifiers/{classifier_id}", response_model=DocumentClassifierRead)
def update_document_classifier(
    classifier_id: str,
    payload: DocumentClassifierUpdate,
    db: Session = Depends(get_db),
) -> DocumentClassifierRead:
    return definitions_service.update_document_classifier(classifier_id, payload, db)


@router.delete("/api/document-classifiers/{classifier_id}", response_model=DocumentClassifierRead)
def delete_document_classifier(classifier_id: str, db: Session = Depends(get_db)) -> DocumentClassifierRead:
    return definitions_service.delete_document_classifier(classifier_id, db)
