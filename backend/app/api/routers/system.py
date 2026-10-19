from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.application.vlm_settings import VlmSettingsService
from app.schemas import SystemStatusRead, VlmSettingsRead, VlmSettingsUpdate

router = APIRouter()


def _vlm_settings_service(db: Session = Depends(get_db)) -> VlmSettingsService:
    return VlmSettingsService(db)


@router.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/system/status", response_model=SystemStatusRead)
def system_status(service: VlmSettingsService = Depends(_vlm_settings_service)) -> SystemStatusRead:
    return service.read_system_status()


@router.get("/api/settings/vlm", response_model=VlmSettingsRead)
def get_vlm_settings(service: VlmSettingsService = Depends(_vlm_settings_service)) -> VlmSettingsRead:
    return service.read_vlm_settings()


@router.put("/api/settings/vlm", response_model=VlmSettingsRead)
def update_vlm_settings(
    payload: VlmSettingsUpdate,
    service: VlmSettingsService = Depends(_vlm_settings_service),
) -> VlmSettingsRead:
    return service.update_vlm_settings(payload)
