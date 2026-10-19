from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.application import exports as exports_service
from app.application.exports import export_preset_read
from app.core.errors import ensure_found
from app.models import (
    ExportPreset,
    Schema,
)
from app.schemas import (
    ExportPresetCreate,
    ExportPresetRead,
    ExportPresetUpdate,
)

router = APIRouter()


@router.post("/api/export-presets", response_model=ExportPresetRead)
def create_export_preset(payload: ExportPresetCreate, db: Session = Depends(get_db)) -> ExportPresetRead:
    return exports_service.create_export_preset(payload, db)


@router.get("/api/export-presets", response_model=list[ExportPresetRead])
def list_export_presets(schema_id: str | None = None, db: Session = Depends(get_db)) -> list[ExportPresetRead]:
    query = db.query(ExportPreset)
    if schema_id:
        schema = db.get(Schema, schema_id)
        ensure_found(schema, "Schema not found")
        query = query.filter((ExportPreset.schema_id == schema_id) | (ExportPreset.schema_id.is_(None)))
    presets = query.order_by(ExportPreset.created_at.desc()).all()
    return [export_preset_read(preset) for preset in presets]


@router.patch("/api/export-presets/{preset_id}", response_model=ExportPresetRead)
def update_export_preset(
    preset_id: str,
    payload: ExportPresetUpdate,
    db: Session = Depends(get_db),
) -> ExportPresetRead:
    return exports_service.update_export_preset(preset_id, payload, db)


@router.delete("/api/export-presets/{preset_id}")
def delete_export_preset(preset_id: str, db: Session = Depends(get_db)) -> dict[str, str]:
    return exports_service.delete_export_preset(preset_id, db)
