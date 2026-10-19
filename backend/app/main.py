"""Application factory: middleware, routers, the job runtime and the optional static frontend.

Startup upgrades the database to the latest Alembic revision, then starts the job runtime
(which first recovers work a previous process left unfinished).
"""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.errors import register_exception_handlers
from app.api.frontend import mount_frontend
from app.api.middleware import register_security_headers
from app.api.routers import (
    checklists,
    classification,
    classifiers,
    documents,
    export_jobs,
    export_presets,
    kie,
    kie_batches,
    library,
    maintenance,
    raw,
    required_check,
    rotation,
    schemas,
    system,
    table_extraction,
    workflow_runs,
    workflows,
)
from app.core.config import get_settings, parse_cors_allowed_origins, resolved_cors_allow_origin_regex
from app.core.migrations import upgrade_database
from app.infra.jobs.runtime import get_job_runtime

# Include order mirrors the original single-module registration order.
ROUTERS = (
    system,
    raw,
    documents,
    library,
    schemas,
    classifiers,
    classification,
    checklists,
    required_check,
    kie,
    export_presets,
    workflows,
    workflow_runs,
    export_jobs,
    kie_batches,
    rotation,
    table_extraction,
    maintenance,
)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    upgrade_database()
    runtime = get_job_runtime()
    runtime.start()
    try:
        yield
    finally:
        runtime.stop()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Document Automation Workspace API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=parse_cors_allowed_origins(settings.cors_allowed_origins),
        allow_origin_regex=resolved_cors_allow_origin_regex(settings.cors_allow_origin_regex),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    register_security_headers(app)
    register_exception_handlers(app)
    for module in ROUTERS:
        app.include_router(module.router)
    mount_frontend(app)
    return app


app = create_app()
