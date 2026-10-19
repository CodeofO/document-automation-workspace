"""Serve the built single-page frontend from the API process (optional, ``SERVE_FRONTEND``).

Client-side routes such as ``/documents`` or ``/workflow-runs/<id>`` have no file in the
build output, so every GET that is not an API call and not an existing file falls back to
``index.html`` and the frontend router takes over.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.errors import NotFoundError


def mount_frontend(app: FastAPI) -> None:
    """Register the static frontend. Must run after every API router is included."""
    settings = get_settings()
    if not settings.serve_frontend:
        return

    dist_dir = settings.resolved_frontend_dist_dir
    index_path = dist_dir / "index.html"
    if not index_path.exists():
        return

    assets_dir = dist_dir / "assets"
    if assets_dir.exists():
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend_assets")

    @app.get("/", include_in_schema=False)
    def _frontend_index() -> FileResponse:
        return FileResponse(index_path)

    @app.get("/{full_path:path}", include_in_schema=False)
    def _frontend_spa(full_path: str) -> FileResponse:
        if full_path == "api" or full_path.startswith("api/"):
            raise NotFoundError("Not Found")

        requested = (dist_dir / full_path).resolve()
        if requested.is_file() and _is_relative_to(requested, dist_dir.resolve()):
            return FileResponse(requested)
        return FileResponse(index_path)


def _is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True
