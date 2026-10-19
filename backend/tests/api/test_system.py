import json
import os
import re
from pathlib import Path

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models import AppSetting
from tests.conftest import get_client
from tests.support.api import (
    _read_env_example,
)


def test_health(client) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_system_status_mock_mode(mock_vlm, settings_env) -> None:
    settings_env(UPLOAD_MAX_BATCH_FILES="1234", UPLOAD_CHUNK_FILES="10", WORKFLOW_MAX_WORKERS="16", VLM_MAX_CONCURRENT_REQUESTS="8")
    with get_client() as client:
        response = client.get("/api/system/status")
    assert response.status_code == 200
    payload = response.json()
    assert payload["vlm_provider"] == "mock"
    assert payload["is_mock"] is True
    assert payload["upload_max_batch_files"] == 1234
    assert payload["upload_chunk_files"] == 10
    assert payload["workflow_max_workers"] == 16
    assert payload["vlm_max_concurrent_requests"] == 8
    assert "batch_max_workers" not in payload
    assert payload["document_page_max_long_edge"] == 3000
    assert payload["document_page_jpeg_quality"] == 88
    assert "vlm_api_key" not in payload


def test_database_pool_defaults_to_64_connections() -> None:
    from app.core.db import engine

    pool_size = getattr(engine.pool, "size", None)
    assert callable(pool_size)
    assert pool_size() == 64
    assert getattr(engine.pool, "_max_overflow", None) == 0


def test_vlm_settings_include_libreoffice_path(monkeypatch, tmp_path, client) -> None:
    from app.core import config as config_module

    env_path = tmp_path / ".env"
    monkeypatch.setattr(config_module, "ROOT_ENV_PATH", env_path)

    response = client.put(
        "/api/settings/vlm",
        json={
            "api_key": "test-secret",
            "model_name": "test-model",
            "base_url": "http://127.0.0.1:11434/v1",
            "libreoffice_path": "/Applications/LibreOffice.app/Contents/MacOS/soffice",
            "provider": "openai",
            "workflow_max_workers": 11,
            "vlm_max_concurrent_requests": 7,
            "vlm_timeout_seconds": 600,
            "kie_field_group_size": 3,
            "inference_params": {
                "reasoning_effort": "off",
                "thinking": "off",
                "temperature": "0",
                "verbosity": "",
                "max_completion_tokens": "2048",
                "top_p": "0.9",
                "service_tier": "",
            },
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["base_url"] == "http://127.0.0.1:11434/v1"
    assert payload["libreoffice_path"] == "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    assert payload["inference_params"]["reasoning_effort"] == "off"
    assert payload["inference_params"]["thinking"] == "off"
    assert payload["inference_params"]["max_completion_tokens"] == "2048"
    assert "vlm_max_concurrent_requests" in payload
    assert payload["workflow_max_workers"] == 11
    assert payload["vlm_timeout_seconds"] == 600
    assert "batch_max_workers" not in payload
    assert "kie_field_group_size" in payload
    assert payload["runtime_settings_writable"] is True

    # Saved as runtime overrides in the database; neither .env nor the process environment changes.
    assert not env_path.exists()
    assert "VLM_API_KEY" not in os.environ or os.environ["VLM_API_KEY"] != "test-secret"
    db = SessionLocal()
    try:
        stored = {row.key: row.value for row in db.query(AppSetting).all()}
    finally:
        db.close()
    assert stored["VLM_BASE_URL"] == "http://127.0.0.1:11434/v1"
    assert stored["LIBREOFFICE_PATH"] == "/Applications/LibreOffice.app/Contents/MacOS/soffice"
    assert stored["WORKFLOW_MAX_WORKERS"] == "11"
    assert stored["VLM_MAX_CONCURRENT_REQUESTS"] == "7"
    assert stored["VLM_TIMEOUT_SECONDS"] == "600"
    assert stored["KIE_FIELD_GROUP_SIZE"] == "3"
    assert stored["VLM_API_KEY"] == "test-secret"
    assert "VLM_INFERENCE_PARAMS" in stored
    assert "BATCH_MAX_WORKERS" not in stored

    # Every reader of get_settings() sees the new values right away.
    settings = get_settings()
    assert settings.workflow_max_workers == 11
    assert settings.vlm_max_concurrent_requests == 7
    assert settings.vlm_base_url == "http://127.0.0.1:11434/v1"
    assert settings.resolved_vlm_api_key == "test-secret"
    again = client.get("/api/settings/vlm").json()
    assert again["workflow_max_workers"] == 11
    assert again["has_api_key"] is True


def test_runtime_settings_override_environment_defaults(settings_env) -> None:
    settings_env(WORKFLOW_MAX_WORKERS="5", VLM_MODEL_NAME="env-model")
    assert get_settings().workflow_max_workers == 5
    db = SessionLocal()
    try:
        db.add(AppSetting(key="WORKFLOW_MAX_WORKERS", value="9"))
        db.add(AppSetting(key="NOT_A_RUNTIME_SETTING", value="x"))
        db.commit()
    finally:
        db.close()
    assert get_settings().workflow_max_workers == 5  # cached until invalidated
    get_settings.cache_clear()
    settings = get_settings()
    assert settings.workflow_max_workers == 9
    assert settings.vlm_model_name == "env-model"  # no override: the environment default


def test_vlm_settings_are_readonly_in_production(monkeypatch, tmp_path, settings_env) -> None:
    from app.core import config as config_module

    env_path = tmp_path / ".env"
    monkeypatch.setattr(config_module, "ROOT_ENV_PATH", env_path)
    settings_env(APP_ENV="production", ALLOW_RUNTIME_SETTINGS=None)

    with get_client() as client:
        settings_response = client.get("/api/settings/vlm")
        assert settings_response.status_code == 200
        assert settings_response.json()["runtime_settings_writable"] is False

        response = client.put(
            "/api/settings/vlm",
            json={
                "api_key": "test-secret",
                "model_name": "test-model",
                "libreoffice_path": "/Applications/LibreOffice.app/Contents/MacOS/soffice",
                "provider": "openai",
            },
        )
        assert response.status_code == 403
        assert not env_path.exists()
    db = SessionLocal()
    try:
        assert db.query(AppSetting).count() == 0
    finally:
        db.close()


def test_cors_origin_env_parser() -> None:
    from app.core.config import parse_cors_allowed_origins, resolved_cors_allow_origin_regex

    assert parse_cors_allowed_origins("https://app.example.com, https://admin.example.com") == [
        "https://app.example.com",
        "https://admin.example.com",
    ]
    default_origins = parse_cors_allowed_origins("")
    assert "http://127.0.0.1:5173" in default_origins
    assert "http://localhost:4173" in default_origins
    default_regex = resolved_cors_allow_origin_regex(None)
    assert default_regex is not None
    assert re.match(default_regex, "http://127.0.0.1:53123")
    assert re.match(default_regex, "http://localhost:53123")
    assert not re.match(default_regex, "https://example.com")


def test_production_env_examples_disable_local_cors_regex() -> None:
    from app.core.config import resolved_cors_allow_origin_regex

    root = Path(__file__).resolve().parents[3]
    production_values = _read_env_example(root / "backend/.env.production.example")
    assert production_values["APP_ENV"] == "production"
    cors_regex = resolved_cors_allow_origin_regex(production_values["CORS_ALLOW_ORIGIN_REGEX"])
    assert cors_regex == "^$"
    assert not re.match(cors_regex, "http://localhost:53123")
    assert not re.match(cors_regex, "http://127.0.0.1:53123")

    local_values = _read_env_example(root / ".env.example")
    assert local_values["APP_ENV"] == "development"
    assert local_values["VLM_PROVIDER"] == "mock"
    assert json.loads(local_values["VLM_INFERENCE_PARAMS"].strip("'\""))["reasoning_effort"] == "off"
    assert json.loads(production_values["VLM_INFERENCE_PARAMS"].strip("'\""))["thinking"] == "off"


def test_production_security_headers(settings_env) -> None:
    from fastapi.testclient import TestClient

    from app.main import app

    settings_env(APP_ENV="production", SECURITY_HEADERS_ENABLED="true")

    with TestClient(app, base_url="https://testserver") as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.headers["x-content-type-options"] == "nosniff"
        assert health.headers["x-frame-options"] == "DENY"
        assert health.headers["referrer-policy"] == "strict-origin-when-cross-origin"
        assert "camera=()" in health.headers["permissions-policy"]
        assert "default-src 'self'" in health.headers["content-security-policy"]
