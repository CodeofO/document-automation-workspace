"""Domain/application exceptions.

Application services raise these instead of FastAPI's ``HTTPException`` so they stay
framework-independent. ``app.api.errors.register_exception_handlers`` maps every
``AppError`` to an HTTP response with the same ``{"detail": ...}`` body FastAPI produces
for ``HTTPException``.
"""

from typing import Any


class AppError(Exception):
    status_code = 400

    def __init__(self, detail: Any, *, status_code: int | None = None, headers: dict[str, str] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        if status_code is not None:
            self.status_code = status_code
        self.headers = headers


class InvalidRequestError(AppError):
    status_code = 400


class ForbiddenError(AppError):
    status_code = 403


class NotFoundError(AppError):
    status_code = 404


class ConflictError(AppError):
    status_code = 409


class GoneError(AppError):
    status_code = 410


class PayloadTooLargeError(AppError):
    status_code = 413


class UnprocessableError(AppError):
    status_code = 422


class InternalError(AppError):
    status_code = 500


class UpstreamError(AppError):
    status_code = 502


def ensure_found(row: Any, detail: str) -> None:
    if not row:
        raise NotFoundError(detail)
