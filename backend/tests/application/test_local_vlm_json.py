import pytest

from app.core.config import get_settings
from app.vlm import OpenAiCompatibleVlmClient, VlmRuntimeError, _json_object_from_text


def test_local_vlm_json_parser_accepts_markdown_wrapped_json() -> None:
    assert _json_object_from_text('```json\n{"ok": true}\n```') == {"ok": True}


def test_local_vlm_json_parser_accepts_json_embedded_in_text() -> None:
    assert _json_object_from_text('result:\n{"ok": true}\nfinished') == {"ok": True}


def test_local_vlm_json_parser_repairs_missing_trailing_braces_after_whitespace_loop() -> None:
    text = '{"본인 성명":{"value":"최예솔","page":1,"evidence":"본인 성명: 최예솔 (서명)"' + (" " * 4096)

    parsed = _json_object_from_text(text)

    assert parsed == {"본인 성명": {"value": "최예솔", "page": 1, "evidence": "본인 성명: 최예솔 (서명)"}}


def test_local_vlm_json_parser_rejects_unparseable_text() -> None:
    with pytest.raises(VlmRuntimeError) as exc_info:
        _json_object_from_text("no json here")

    assert exc_info.value.code == "VLM_RESPONSE_INVALID_JSON"


def test_openai_compatible_client_uses_raw_json_mode_for_base_url(monkeypatch) -> None:
    from app import vlm as vlm_module

    try:
        monkeypatch.setenv("VLM_PROVIDER", "openai_compatible")
        monkeypatch.setenv("VLM_BASE_URL", "http://127.0.0.1:1234/v1")
        get_settings.cache_clear()

        monkeypatch.setattr(vlm_module, "_invoke_openai_compatible_raw_json", lambda *args, **kwargs: {"ok": True})
        monkeypatch.setattr(
            vlm_module,
            "_invoke_openai_compatible",
            lambda *args, **kwargs: pytest.fail("structured json_schema path should not be used for local base_url"),
        )

        assert OpenAiCompatibleVlmClient().invoke("system", "prompt", [], {}) == {"ok": True}
    finally:
        get_settings.cache_clear()


def test_openai_compatible_async_calls_survive_separate_event_loops(monkeypatch) -> None:
    """Background jobs each run their own asyncio.run(); a shared HTTP pool breaks the second loop."""
    import asyncio
    import json
    import threading
    from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

    class StubChatCompletions(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self) -> None:  # noqa: N802
            self.rfile.read(int(self.headers.get("Content-Length", "0")))
            body = json.dumps(
                {
                    "id": "stub",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "stub-vlm",
                    "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": '{"ok": true}'}}],
                }
            ).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args) -> None:
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), StubChatCompletions)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        monkeypatch.setenv("VLM_PROVIDER", "openai_compatible")
        monkeypatch.setenv("VLM_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
        monkeypatch.setenv("VLM_MODEL_NAME", "stub-vlm")
        monkeypatch.setenv("VLM_TIMEOUT_SECONDS", "5")
        get_settings.cache_clear()

        for _ in range(3):
            assert asyncio.run(OpenAiCompatibleVlmClient().ainvoke("system", "prompt", [], {})) == {"ok": True}
    finally:
        server.shutdown()
        get_settings.cache_clear()
