import threading
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter, ValidationError, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

from app.vlm_params import VlmInferenceParams

BACKEND_DIR = Path(__file__).resolve().parents[2]
PROJECT_ROOT = BACKEND_DIR.parent
ROOT_ENV_PATH = PROJECT_ROOT / ".env"
DEFAULT_LIBREOFFICE_PATH = "/Applications/LibreOffice.app/Contents/MacOS/soffice"
DEFAULT_CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
]
DEFAULT_CORS_ALLOW_ORIGIN_REGEX = r"^http://(localhost|127\.0\.0\.1):\d+$"


class Settings(BaseSettings):
    app_env: str = "local"
    database_url: str | None = None
    document_storage_dir: str | None = None
    raw_storage_dir: str | None = None
    libreoffice_path: str | None = None
    cors_allowed_origins: str | None = None
    cors_allow_origin_regex: str | None = None
    database_pool_size: int = 64
    database_max_overflow: int = 0
    database_pool_timeout_seconds: int = 60
    allow_runtime_settings: bool = False
    serve_frontend: bool = False
    frontend_dist_dir: str | None = None
    storage_backend: str = "local"
    object_storage_endpoint_url: str | None = None
    object_storage_region: str | None = None
    object_storage_bucket: str | None = None
    object_storage_access_key_id: str | None = None
    object_storage_secret_access_key: str | None = None
    object_storage_force_path_style: bool = False
    object_storage_prefix: str | None = None
    upload_max_file_bytes: int = 50 * 1024 * 1024
    upload_max_batch_files: int = 10000
    upload_chunk_files: int = 10
    upload_max_pdf_pages: int = 30
    upload_max_image_pixels: int = 50_000_000
    preprocess_max_workers: int = 2
    document_page_max_long_edge: int = 3000
    document_page_jpeg_quality: int = 88
    processing_tmp_dir: str | None = None
    upload_retention_hours: int | None = None
    retention_cleanup_interval_seconds: int = 86400
    security_headers_enabled: bool = True

    vlm_provider: str = "auto"
    vlm_api_key: str | None = None
    vlm_model_name: str | None = None
    vlm_base_url: str | None = None
    vlm_temperature: float = 0
    vlm_max_retries: int = 2
    vlm_timeout_seconds: int = 120
    vlm_inference_params: str | None = None
    vlm_reasoning_effort: str | None = None
    vlm_verbosity: str | None = None
    vlm_max_completion_tokens: str | None = None
    vlm_top_p: str | None = None
    vlm_service_tier: str | None = None
    workflow_max_workers: int = 16
    vlm_max_concurrent_requests: int = 128
    # Background job queue (app.infra.jobs). Single-process deployments reclaim every
    # running job at boot (its process is gone); set false once several workers share a DB.
    job_queue_reclaim_on_boot: bool = True
    job_queue_lease_seconds: int = 60
    job_queue_poll_seconds: float = 1.0
    job_queue_max_attempts: int = 5
    kie_field_group_size: int = 2

    openai_api_key: str | None = None
    openai_model_name: str | None = None

    model_config = SettingsConfigDict(
        env_file=(PROJECT_ROOT / ".env", BACKEND_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @field_validator("upload_retention_hours", mode="before")
    @classmethod
    def blank_optional_int_to_none(cls, value):
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return _normalize_sqlite_url(self.database_url)
        return f"sqlite:///{BACKEND_DIR / 'digitize_documents.db'}"

    @property
    def resolved_storage_dir(self) -> Path:
        raw = self.document_storage_dir or str(BACKEND_DIR / "storage" / "documents")
        path = Path(raw)
        if not path.is_absolute():
            path = BACKEND_DIR / path
        return path

    @property
    def resolved_raw_storage_dir(self) -> Path:
        raw = self.raw_storage_dir or str(BACKEND_DIR / "storage" / "raw")
        path = Path(raw)
        if not path.is_absolute():
            path = BACKEND_DIR / path
        return path

    @property
    def resolved_processing_tmp_dir(self) -> Path:
        raw = self.processing_tmp_dir or str(BACKEND_DIR / "storage" / "processing")
        path = Path(raw)
        if not path.is_absolute():
            path = BACKEND_DIR / path
        return path

    @property
    def resolved_frontend_dist_dir(self) -> Path:
        raw = self.frontend_dist_dir or str(PROJECT_ROOT / "frontend" / "dist")
        path = Path(raw)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() in {"prod", "production"}

    @property
    def runtime_settings_writable(self) -> bool:
        return not self.is_production or self.allow_runtime_settings

    @property
    def resolved_upload_retention_hours(self) -> int:
        if self.upload_retention_hours is not None:
            return max(0, self.upload_retention_hours)
        return 24 if self.is_production else 0

    @property
    def resolved_vlm_api_key(self) -> str | None:
        return self.vlm_api_key or self.openai_api_key

    @property
    def resolved_vlm_model_name(self) -> str | None:
        return self.vlm_model_name or self.openai_model_name

    @property
    def resolved_vlm_inference_params(self) -> dict[str, str]:
        return VlmInferenceParams.from_raw_env(
            self.vlm_inference_params,
            legacy_values={
                "reasoning_effort": self.vlm_reasoning_effort,
                "verbosity": self.vlm_verbosity,
                "max_completion_tokens": self.vlm_max_completion_tokens,
                "top_p": self.vlm_top_p,
                "service_tier": self.vlm_service_tier,
            },
            legacy_temperature=self.vlm_temperature,
        ).as_dict()


# Settings a user may change at runtime (``PUT /api/settings/vlm``), keyed by env variable name.
# The environment / ``.env`` provides the defaults; rows in ``app_settings`` override them.
RUNTIME_SETTING_FIELDS: dict[str, str] = {
    "VLM_PROVIDER": "vlm_provider",
    "VLM_API_KEY": "vlm_api_key",
    "VLM_MODEL_NAME": "vlm_model_name",
    "VLM_BASE_URL": "vlm_base_url",
    "LIBREOFFICE_PATH": "libreoffice_path",
    "VLM_INFERENCE_PARAMS": "vlm_inference_params",
    "WORKFLOW_MAX_WORKERS": "workflow_max_workers",
    "VLM_MAX_CONCURRENT_REQUESTS": "vlm_max_concurrent_requests",
    "VLM_TIMEOUT_SECONDS": "vlm_timeout_seconds",
    "KIE_FIELD_GROUP_SIZE": "kie_field_group_size",
}


@lru_cache
def get_env_settings() -> Settings:
    """Settings from the environment and ``.env`` only (what the database engine is built from)."""
    return Settings()


class _LayeredSettings:
    """``get_settings()``: environment defaults with the runtime overrides stored in the database.

    The result is cached; ``get_settings.cache_clear()`` drops it (and the environment cache),
    which the settings PUT does after writing. Each process keeps its own cache, so another
    process sees a change only after its cache is cleared or it restarts.
    """

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._cached: Settings | None = None
        self._loading = False

    def __call__(self) -> Settings:
        cached = self._cached
        if cached is not None:
            return cached
        with self._lock:
            if self._cached is not None:
                return self._cached
            base = get_env_settings()
            if self._loading:
                return base
            self._loading = True
            try:
                overrides = _load_runtime_overrides()
            finally:
                self._loading = False
            self._cached = apply_runtime_overrides(base, overrides)
            return self._cached

    def cache_clear(self) -> None:
        with self._lock:
            self._cached = None
            get_env_settings.cache_clear()


get_settings = _LayeredSettings()


def apply_runtime_overrides(base: Settings, overrides: Mapping[str, str]) -> Settings:
    update: dict[str, Any] = {}
    for env_key, raw in overrides.items():
        field_name = RUNTIME_SETTING_FIELDS.get(env_key)
        if not field_name:
            continue
        try:
            update[field_name] = TypeAdapter(Settings.model_fields[field_name].annotation).validate_python(raw)
        except ValidationError:
            continue
    return base.model_copy(update=update) if update else base


def _load_runtime_overrides() -> dict[str, str]:
    from sqlalchemy import text
    from sqlalchemy.exc import SQLAlchemyError

    from app.core.db import engine

    try:
        with engine.connect() as connection:
            rows = connection.execute(text("SELECT key, value FROM app_settings")).all()
    except SQLAlchemyError:
        # Not migrated yet (no app_settings table): environment only.
        return {}
    return {str(key): str(value) for key, value in rows}


def parse_cors_allowed_origins(raw: str | None) -> list[str]:
    if not raw or not raw.strip():
        return DEFAULT_CORS_ALLOWED_ORIGINS
    return [origin.strip() for origin in raw.replace("\n", ",").split(",") if origin.strip()]


def resolved_cors_allow_origin_regex(raw: str | None) -> str | None:
    if raw is None:
        return DEFAULT_CORS_ALLOW_ORIGIN_REGEX
    stripped = raw.strip()
    return stripped or DEFAULT_CORS_ALLOW_ORIGIN_REGEX


def _normalize_sqlite_url(url: str) -> str:
    if url == "sqlite:///:memory:" or not url.startswith("sqlite:///") or url.startswith("sqlite:////"):
        return url
    raw_path = url.removeprefix("sqlite:///")
    path = Path(raw_path)
    if path.is_absolute():
        return url
    return f"sqlite:///{PROJECT_ROOT / path}"
