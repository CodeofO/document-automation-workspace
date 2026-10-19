from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.core.errors import AppError


async def _app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    # Same body shape and status as ``HTTPException(status_code, detail)``.
    return JSONResponse({"detail": exc.detail}, status_code=exc.status_code, headers=exc.headers)


def register_exception_handlers(app: FastAPI) -> None:
    app.add_exception_handler(AppError, _app_error_handler)
