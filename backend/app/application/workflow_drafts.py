import shutil
import tempfile
from pathlib import Path
from typing import Any

from app.application.uploads import UploadedFile
from app.core.config import get_settings
from app.core.errors import AppError, InvalidRequestError, PayloadTooLargeError, UnprocessableError
from app.document_processor import (
    DocumentProcessingError,
    read_image_size,
)
from app.schemas import SchemaCreate

WORKFLOW_AI_DRAFT_MAX_IMAGES = 10


WORKFLOW_AI_DRAFT_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg"}


def save_workflow_ai_draft_images(files: list[UploadedFile]) -> list[Path]:
    if not files:
        raise UnprocessableError("At least one sample image is required")
    if len(files) > WORKFLOW_AI_DRAFT_MAX_IMAGES:
        raise PayloadTooLargeError(f"AI workflow draft supports up to {WORKFLOW_AI_DRAFT_MAX_IMAGES} sample images")

    temp_dir = Path(tempfile.mkdtemp(prefix="workflow_ai_draft_"))
    saved_paths: list[Path] = []
    try:
        for index, file in enumerate(files, start=1):
            suffix = Path(file.filename or "").suffix.lower()
            if suffix not in WORKFLOW_AI_DRAFT_IMAGE_EXTENSIONS:
                raise InvalidRequestError("Only PNG, JPG, and JPEG sample images are supported")
            image_path = temp_dir / f"sample_{index}{suffix}"
            size = 0
            with image_path.open("wb") as destination:
                while True:
                    chunk = file.file.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > get_settings().upload_max_file_bytes:
                        raise PayloadTooLargeError("Uploaded sample image is too large")
                    destination.write(chunk)
            if size <= 0:
                raise InvalidRequestError("Uploaded sample image is empty")
            read_image_size(image_path)
            saved_paths.append(image_path)
        return saved_paths
    except AppError:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise
    except DocumentProcessingError as exc:
        shutil.rmtree(temp_dir, ignore_errors=True)
        raise InvalidRequestError(str(exc)) from exc


def workflow_ai_draft_definition(*, include_checklist: bool) -> dict[str, Any]:
    nodes = [
        {
            "id": "ai_input",
            "type": "workflow",
            "position": {"x": 0, "y": 150},
            "data": {"kind": "input", "label": "문서 입력", "config": {}},
        },
        {
            "id": "ai_kie",
            "type": "workflow",
            "position": {"x": 270, "y": 110},
            "data": {"kind": "kie", "label": "핵심 정보 추출", "config": {}},
        },
        {
            "id": "ai_merge",
            "type": "workflow",
            "position": {"x": 820 if include_checklist else 560, "y": 150},
            "data": {"kind": "merge", "label": "결과 병합", "config": {}},
        },
        {
            "id": "ai_export",
            "type": "workflow",
            "position": {"x": 1080 if include_checklist else 800, "y": 150},
            "data": {"kind": "export", "label": "Export", "config": {}},
        },
    ]
    if include_checklist:
        nodes.insert(
            2,
            {
                "id": "ai_required",
                "type": "workflow",
                "position": {"x": 560, "y": 110},
                "data": {"kind": "required-checker", "label": "필수 항목 확인", "config": {}},
            },
        )
        edges = [
            {"id": "ai_input-out-ai_kie", "source": "ai_input", "target": "ai_kie"},
            {"id": "ai_kie-out-ai_required", "source": "ai_kie", "target": "ai_required"},
            {"id": "ai_required-out-ai_merge", "source": "ai_required", "target": "ai_merge"},
            {"id": "ai_merge-out-ai_export", "source": "ai_merge", "target": "ai_export"},
        ]
    else:
        edges = [
            {"id": "ai_input-out-ai_kie", "source": "ai_input", "target": "ai_kie"},
            {"id": "ai_kie-out-ai_merge", "source": "ai_kie", "target": "ai_merge"},
            {"id": "ai_merge-out-ai_export", "source": "ai_merge", "target": "ai_export"},
        ]
    return {"nodes": nodes, "edges": edges}


def workflow_ai_draft_name(schema_draft: SchemaCreate, *, sample_count: int) -> str:
    base = schema_draft.display_name or schema_draft.name or "AI 생성 워크플로우"
    return f"{base} 워크플로우 초안 · 샘플 {sample_count}장"
