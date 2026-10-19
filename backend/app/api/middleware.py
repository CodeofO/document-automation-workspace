from fastapi import FastAPI, Request, Response

from app.core.config import get_settings

CONTENT_SECURITY_POLICY = (
    "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; "
    "connect-src 'self' http://localhost:* http://127.0.0.1:*"
)


def apply_security_headers(response: Response) -> None:
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
    response.headers.setdefault("Content-Security-Policy", CONTENT_SECURITY_POLICY)


def register_security_headers(app: FastAPI) -> None:
    @app.middleware("http")
    async def security_headers_middleware(request: Request, call_next):
        settings = get_settings()
        response = await call_next(request)
        if settings.security_headers_enabled:
            apply_security_headers(response)
        return response
