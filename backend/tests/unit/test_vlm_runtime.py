import asyncio
import json
from types import SimpleNamespace

import pytest

from app.core.config import get_settings


def test_async_vlm_limit_queues_without_threadpool_deadlock(monkeypatch, settings_env) -> None:
    from app import vlm as vlm_module

    active = 0
    max_active = 0
    lock = asyncio.Lock()

    async def fake_invoke(*args, **kwargs):
        nonlocal active, max_active
        async with lock:
            active += 1
            max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        async with lock:
            active -= 1
        return {"ok": True}

    async def run_many() -> list[dict[str, bool]]:
        tasks = [vlm_module._invoke_vlm_with_limit_async("system", "prompt", [], {}, "google_genai") for _ in range(80)]
        return await asyncio.wait_for(asyncio.gather(*tasks), timeout=3)

    settings_env(VLM_MAX_CONCURRENT_REQUESTS="2", VLM_TIMEOUT_SECONDS="2", VLM_MAX_RETRIES="0")
    monkeypatch.setattr(vlm_module, "_invoke_structured_llm_async", fake_invoke)

    results = asyncio.run(run_many())
    assert results == [{"ok": True}] * 80
    assert max_active == 2
    assert vlm_module.vlm_runtime_counters()["vlm_active_count"] == 0
    assert vlm_module.vlm_runtime_counters()["vlm_waiting_count"] == 0


def test_async_vlm_request_times_out(monkeypatch, settings_env) -> None:
    from app import vlm as vlm_module

    async def slow_invoke(*args, **kwargs):
        await asyncio.sleep(2)
        return {"ok": True}

    async def run_once() -> None:
        with pytest.raises(vlm_module.VlmRuntimeError) as exc_info:
            await vlm_module._invoke_vlm_with_limit_async("system", "prompt", [], {}, "google_genai")
        assert "timed out" in exc_info.value.message

    settings_env(VLM_MAX_CONCURRENT_REQUESTS="2", VLM_TIMEOUT_SECONDS="1", VLM_MAX_RETRIES="0")
    monkeypatch.setattr(vlm_module, "_invoke_structured_llm_async", slow_invoke)

    asyncio.run(run_once())
    assert vlm_module.vlm_runtime_counters()["vlm_active_count"] == 0


def test_vlm_runtime_kwargs_include_speed_controls(settings_env) -> None:
    from app.vlm import _build_llm_kwargs

    settings_env(
        VLM_API_KEY="test-secret",
        VLM_MODEL_NAME="test-model",
        VLM_INFERENCE_PARAMS=json.dumps(
            {
                "reasoning_effort": "minimal",
                "thinking": "minimal",
                "temperature": "0.2",
                "verbosity": "low",
                "max_completion_tokens": "1024",
                "top_p": "0.8",
                "service_tier": "auto",
            }
        ),
    )
    kwargs = _build_llm_kwargs()
    assert kwargs["reasoning_effort"] == "minimal"
    assert kwargs["temperature"] == 0.2
    assert kwargs["verbosity"] == "low"
    assert kwargs["max_completion_tokens"] == 1024
    assert kwargs["top_p"] == 0.8
    assert kwargs["service_tier"] == "auto"


def test_vlm_inference_params_default_reasoning_off(monkeypatch, settings_env) -> None:
    from app.vlm import _build_google_generation_config, _build_llm_kwargs

    for key in [
        "VLM_INFERENCE_PARAMS",
        "VLM_REASONING_EFFORT",
        "VLM_VERBOSITY",
        "VLM_MAX_COMPLETION_TOKENS",
        "VLM_TOP_P",
        "VLM_SERVICE_TIER",
    ]:
        monkeypatch.delenv(key, raising=False)
    settings_env(VLM_API_KEY="test-secret", VLM_MODEL_NAME="test-model")

    kwargs = _build_llm_kwargs()
    assert "reasoning_effort" not in kwargs
    assert "verbosity" not in kwargs
    assert kwargs["temperature"] == 0

    schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
    config = _build_google_generation_config("system", schema)
    assert config["thinking_config"] == {"thinking_budget": 0}


def test_vlm_api_style_auto_detects_google_and_base_url(settings_env) -> None:
    from app.vlm import resolve_vlm_api_style

    settings_env(VLM_PROVIDER="auto", VLM_API_KEY="AIzaSyCP_test_key", VLM_MODEL_NAME="gemini-3.1-flash-lite", VLM_BASE_URL="")
    assert resolve_vlm_api_style() == "google_genai"

    settings_env(VLM_BASE_URL="https://openrouter.ai/api/v1")
    assert resolve_vlm_api_style() == "openai_compatible"

    settings_env(VLM_PROVIDER="openai", VLM_BASE_URL="")
    assert resolve_vlm_api_style() == "google_genai"


def test_vlm_base_url_allows_local_provider_without_api_key(settings_env) -> None:
    from app.vlm import _build_llm_kwargs, _ensure_vlm_credentials

    settings_env(
        VLM_PROVIDER="auto", VLM_API_KEY="", OPENAI_API_KEY="", VLM_MODEL_NAME="local-model", VLM_BASE_URL="http://127.0.0.1:11434/v1"
    )
    settings = get_settings()
    _ensure_vlm_credentials(settings)
    kwargs = _build_llm_kwargs()
    assert kwargs["base_url"] == "http://127.0.0.1:11434/v1"
    assert kwargs["api_key"] == "local-vlm"


def test_vlm_base_url_does_not_replace_google_api_key(settings_env) -> None:
    from app.vlm import VlmRuntimeError, _ensure_vlm_credentials

    settings_env(
        VLM_PROVIDER="google_genai",
        VLM_API_KEY="",
        GOOGLE_API_KEY="",
        VLM_MODEL_NAME="gemini-test-model",
        VLM_BASE_URL="http://127.0.0.1:11434/v1",
    )
    settings = get_settings()
    with pytest.raises(VlmRuntimeError) as exc:
        _ensure_vlm_credentials(settings)
    assert exc.value.code == "VLM_CREDENTIALS_MISSING"
    assert "VLM API key is required" in str(exc.value)


def test_vlm_errors_have_stable_codes_and_redact_secrets(settings_env) -> None:
    from app.vlm import VlmRuntimeError, _coerce_structured_response, _sanitize_provider_error, resolve_vlm_api_style

    settings_env(VLM_PROVIDER="unknown_provider")
    with pytest.raises(VlmRuntimeError) as provider_error:
        resolve_vlm_api_style()
    assert provider_error.value.code == "VLM_PROVIDER_UNSUPPORTED"
    assert provider_error.value.as_detail()["code"] == "VLM_PROVIDER_UNSUPPORTED"

    settings_env(VLM_API_KEY="AIzaSyCP_test_key_should_not_leak")
    sanitized = _sanitize_provider_error(RuntimeError("bad key AIzaSyCP_test_key_should_not_leak"))
    assert "AIzaSyCP_test_key_should_not_leak" not in sanitized
    assert "[redacted]" in sanitized

    with pytest.raises(VlmRuntimeError) as response_error:
        _coerce_structured_response(SimpleNamespace(text="not-json"))
    assert response_error.value.code == "VLM_RESPONSE_INVALID_JSON"


def test_vlm_provider_request_retries_transient_broken_pipe(monkeypatch, settings_env) -> None:
    from app import vlm as vlm_module
    from app.vlm import VlmRuntimeError, _invoke_vlm_with_limit

    calls = 0

    def fake_invoke(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise VlmRuntimeError("VLM_PROVIDER_REQUEST_FAILED", "Google GenAI VLM request failed: [Errno 32] Broken pipe")
        return {"ok": True}

    settings_env(VLM_MAX_RETRIES="2")
    monkeypatch.setattr(vlm_module.time, "sleep", lambda _delay: None)
    monkeypatch.setattr(vlm_module, "_invoke_structured_llm", fake_invoke)

    assert _invoke_vlm_with_limit("system", "prompt", [], {}, "google_genai") == {"ok": True}
    assert calls == 2


def test_google_generation_config_uses_structured_output_and_explicit_thinking_level(settings_env) -> None:
    from app.vlm import _build_google_generation_config

    settings_env(
        VLM_PROVIDER="auto",
        VLM_API_KEY="AIzaSyCP_test_key",
        VLM_MODEL_NAME="gemini-3.1-flash-lite",
        VLM_INFERENCE_PARAMS=json.dumps({"reasoning_effort": "minimal", "thinking": "minimal"}),
    )
    schema = {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}
    config = _build_google_generation_config("system", schema)
    assert config["system_instruction"] == "system"
    assert config["response_mime_type"] == "application/json"
    assert config["response_json_schema"] == schema
    assert config["thinking_config"] == {"thinking_level": "minimal"}


def test_classification_schema_uses_classes_or_unknown_only() -> None:
    from app.schemas import ClassCandidate
    from app.vlm import _classification_output_schema

    spec = _classification_output_schema(
        classes=[ClassCandidate(class_name="contract", description="Contract", signals=[])],
        allow_unknown=False,
    )
    schema = spec.json_schema()
    assert schema["properties"]["status"]["enum"] == ["classified", "unknown"]
    class_name_schema = schema["properties"]["class_name"]
    assert {"type": "null"} in class_name_schema["anyOf"]


def test_dynamic_pydantic_output_schemas_require_configured_keys() -> None:
    from app.schemas import FieldDefinition, RequiredFieldItem
    from app.vlm import _required_field_output_schema, build_structured_output_schema

    kie_spec = build_structured_output_schema(
        [
            FieldDefinition(key_name="본인 성명", description="우측 하단 본인 성명", output_format="string"),
            FieldDefinition(key_name="금액", description="금액", output_format="float"),
        ]
    )
    kie_schema = kie_spec.json_schema()
    assert kie_schema["required"] == ["본인 성명", "금액"]
    assert set(kie_schema["properties"]) == {"본인 성명", "금액"}

    required_spec = _required_field_output_schema(
        [
            RequiredFieldItem(item_name="서명", description="서명 확인"),
            RequiredFieldItem(item_name="작성일", description="작성일 확인"),
        ]
    )
    required_schema = required_spec.json_schema()
    item_ref = required_schema["properties"]["items"]["$ref"]
    ref_name = item_ref.removeprefix("#/$defs/")
    item_schema = required_schema["$defs"][ref_name]
    assert item_schema["required"] == ["서명", "작성일"]
    assert set(item_schema["properties"]) == {"서명", "작성일"}


def test_classification_validation_clears_unknown_class_name() -> None:
    from app.document_modules import ClassificationContext, _validate_classification_output
    from app.extraction import DocumentSnapshot
    from app.schemas import ClassCandidate

    context = ClassificationContext(
        document=DocumentSnapshot(id="doc_1", storage_path="", pages=[]),
        classifier_id="clf_1",
        classes=[ClassCandidate(class_name="contract", description="Contract", signals=[])],
        allow_unknown=True,
    )
    output = _validate_classification_output(
        {
            "status": "unknown",
            "class_name": "contract",
            "confidence": 0.3,
            "reason": "No class matched.",
            "evidence": [],
        },
        context,
    )
    assert output["status"] == "unknown"
    assert output["class_name"] is None
