from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.application import definitions as definitions_service
from app.application.definitions import schema_read
from app.core.errors import ensure_found
from app.models import Schema
from app.schemas import (
    SchemaCreate,
    SchemaDescriptionRecommendationRead,
    SchemaDescriptionRecommendationRequest,
    SchemaRead,
    SchemaRecommendationRead,
    SchemaRecommendationRequest,
    SchemaUpdate,
)

router = APIRouter()


@router.post("/api/schemas", response_model=SchemaRead)
def create_schema(payload: SchemaCreate, db: Session = Depends(get_db)) -> SchemaRead:
    return definitions_service.create_schema(payload, db)


@router.get("/api/schemas", response_model=list[SchemaRead])
def list_schemas(
    templates: bool | None = None,
    include_ephemeral: bool = False,
    include_archived: bool = False,
    db: Session = Depends(get_db),
) -> list[SchemaRead]:
    query = db.query(Schema)
    if not include_ephemeral:
        query = query.filter(Schema.ephemeral == False)  # noqa: E712
    if not include_archived:
        query = query.filter(Schema.archived == False)  # noqa: E712
    if templates is not None:
        query = query.filter(Schema.is_template == templates)
    schemas = query.order_by(Schema.pinned.desc(), Schema.created_at.desc()).all()
    return [schema_read(schema) for schema in schemas]


@router.post("/api/schemas/recommendations", response_model=SchemaRecommendationRead)
def recommend_schema(
    payload: SchemaRecommendationRequest,
    db: Session = Depends(get_db),
) -> SchemaRecommendationRead:
    return definitions_service.recommend_schema(payload, db)


@router.post("/api/schemas/description-recommendations", response_model=SchemaDescriptionRecommendationRead)
def recommend_schema_description(
    payload: SchemaDescriptionRecommendationRequest,
    db: Session = Depends(get_db),
) -> SchemaDescriptionRecommendationRead:
    return definitions_service.recommend_schema_description(payload, db)


@router.get("/api/schemas/{schema_id}", response_model=SchemaRead)
def get_schema(schema_id: str, db: Session = Depends(get_db)) -> SchemaRead:
    schema = db.get(Schema, schema_id)
    ensure_found(schema, "Schema not found")
    return schema_read(schema)


@router.post("/api/schemas/{schema_id}/duplicate", response_model=SchemaRead)
def duplicate_schema(schema_id: str, db: Session = Depends(get_db)) -> SchemaRead:
    return definitions_service.duplicate_schema(schema_id, db)


@router.patch("/api/schemas/{schema_id}", response_model=SchemaRead)
def update_schema(schema_id: str, payload: SchemaUpdate, db: Session = Depends(get_db)) -> SchemaRead:
    return definitions_service.update_schema(schema_id, payload, db)


@router.delete("/api/schemas/{schema_id}", response_model=SchemaRead)
def delete_schema(schema_id: str, db: Session = Depends(get_db)) -> SchemaRead:
    return definitions_service.delete_schema(schema_id, db)
