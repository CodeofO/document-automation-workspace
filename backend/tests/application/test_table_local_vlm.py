"""Table extraction through the local OpenAI-compatible server (VLM_BASE_URL → raw JSON path)."""

import asyncio
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from app.core.config import get_settings
from app.domain.table_normalization import table_result_from_model
from app.domain.table_spec import TableSpec
from app.vlm import ProviderVlmGateway


def test_extract_table_uses_raw_json_path_with_the_cell_schema(monkeypatch) -> None:
    requests: list[dict] = []
    reply = {
        "headers_seen": ["품명", "중량"],
        "rows": [
            {"source_line": 1, "y_center": 0.2, "cells": [{"raw": "MBS", "conf": 0.9}, {"raw": "21.696", "conf": 0.8}]},
            {"source_line": 2, "y_center": 0.4, "cells": [{"raw": "〃", "conf": 0.9}]},
        ],
        "notes": None,
    }

    class StubChatCompletions(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def do_POST(self) -> None:  # noqa: N802
            requests.append(json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0")))))
            content = "```json\n" + json.dumps(reply, ensure_ascii=False) + "\n```"
            body = json.dumps(
                {
                    "id": "stub",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "stub-vlm",
                    "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": content}}],
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
    table = TableSpec(key="t", name="주입", columns=[{"key": "품명"}, {"key": "중량", "type": "number"}])
    try:
        monkeypatch.setenv("VLM_PROVIDER", "openai_compatible")
        monkeypatch.setenv("VLM_BASE_URL", f"http://127.0.0.1:{server.server_port}/v1")
        monkeypatch.setenv("VLM_MODEL_NAME", "stub-vlm")
        monkeypatch.setenv("VLM_TIMEOUT_SECONDS", "5")
        get_settings.cache_clear()
        output = asyncio.run(ProviderVlmGateway().extract_table(table, [], has_region_crop=False))
    finally:
        server.shutdown()
        get_settings.cache_clear()

    assert output == reply
    system_prompt = requests[0]["messages"][0]["content"]
    assert '"minItems":2' in system_prompt and '"maxItems":2' in system_prompt
    assert "Return exactly one valid JSON object" in system_prompt

    result = table_result_from_model(table, output, None)
    first, second = result["rows"]
    assert first["cells"]["중량"] == {"value": 21.696, "raw": "21.696", "confidence": 0.8, "flags": ["ambiguous_separator"]}
    assert second["flags"] == ["cells_length_mismatch"] and second["status"] == "needs_review"


# --- lenient provider validation (Q3): wrong-length cells are flagged, never fail the table --------------


class _StubProvider:
    """OpenAI-compatible chat completions stub; optionally rejects schemas that carry minItems/maxItems."""

    def __init__(self, reply: dict, *, reject_length_keywords: bool = False) -> None:
        self.reply = reply
        self.reject_length_keywords = reject_length_keywords
        self.requests: list[dict] = []
        stub = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_POST(self) -> None:  # noqa: N802
                request = json.loads(self.rfile.read(int(self.headers.get("Content-Length", "0"))))
                stub.requests.append(request)
                schema_text = json.dumps(request.get("response_format") or {})
                if stub.reject_length_keywords and '"minItems"' in schema_text:
                    status = 400
                    body = {
                        "error": {
                            "message": "Invalid schema for response_format 'TableExtraction': 'minItems' is not permitted.",
                            "type": "invalid_request_error",
                            "param": "response_format",
                            "code": None,
                        }
                    }
                else:
                    status = 200
                    body = {
                        "id": "stub",
                        "object": "chat.completion",
                        "created": 0,
                        "model": "stub-vlm",
                        "choices": [
                            {
                                "index": 0,
                                "finish_reason": "stop",
                                "message": {"role": "assistant", "content": json.dumps(stub.reply, ensure_ascii=False)},
                            }
                        ],
                    }
                encoded = json.dumps(body).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            def log_message(self, *args) -> None:
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.server.server_port}/v1"


_SHORT_LONG_REPLY = {
    "headers_seen": ["품명", "중량"],
    "rows": [
        {"source_line": 1, "y_center": 0.2, "cells": [{"raw": "MBS", "conf": 0.9}, {"raw": "12", "conf": 0.9}]},
        {"source_line": 2, "y_center": 0.4, "cells": [{"raw": "PP", "conf": 0.9}]},
        {
            "source_line": 3,
            "y_center": 0.6,
            "cells": [{"raw": "PE", "conf": 0.9}, {"raw": "7", "conf": 0.9}, {"raw": "덤", "conf": 0.5}],
        },
    ],
    "notes": None,
}


def _hosted_strict_path(monkeypatch, base_url: str) -> None:
    """The hosted OpenAI json_schema (strict) path, pointed at the stub server."""
    import app.vlm as vlm_module

    monkeypatch.setenv("VLM_PROVIDER", "openai_compatible")
    monkeypatch.setenv("VLM_BASE_URL", base_url)
    monkeypatch.setenv("VLM_MODEL_NAME", "stub-vlm")
    monkeypatch.setenv("VLM_TIMEOUT_SECONDS", "5")
    monkeypatch.setenv("VLM_MAX_RETRIES", "0")
    monkeypatch.setattr(vlm_module, "_uses_local_openai_compatible_server", lambda: False)
    get_settings.cache_clear()


def _run_job_through_fake_gateway(client) -> dict:
    """A job whose ``extract_table`` falls through FakeVlmGateway to the real provider gateway."""
    from tests.api.test_table_extraction import _upload_image

    template = client.post(
        "/api/table-templates",
        json={"name": "lenient", "tables": [{"key": "t", "name": "주입", "columns": [{"key": "품명"}, {"key": "중량", "type": "number"}]}]},
    ).json()
    document = _upload_image(client)
    response = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"]})
    assert response.status_code == 200, response.text
    return client.get(f"/api/table-extraction-jobs/{response.json()['job_id']}").json()


def _assert_short_and_long_rows_flagged(job: dict) -> None:
    assert job["status"] == "needs_review", job
    table = job["result"]["tables"][0]
    assert table["status"] == "needs_review"
    ok_row, short_row, long_row = table["rows"]
    assert ok_row["status"] == "ok" and ok_row["cells"]["중량"]["value"] == 12
    assert short_row["flags"] == ["cells_length_mismatch"] and short_row["status"] == "needs_review"
    assert short_row["cells"]["중량"]["flags"][0] == "empty"
    assert long_row["flags"] == ["cells_length_mismatch"] and long_row["status"] == "needs_review"
    assert [cell["raw"] for cell in long_row["extra_cells"]] == ["덤"]
    assert sum("cell(s) for 2 column(s)" in warning for warning in table["warnings"]) == 2


def test_hosted_strict_path_flags_short_and_long_cells_instead_of_failing(monkeypatch, fake_vlm, client) -> None:
    stub = _StubProvider(_SHORT_LONG_REPLY)
    try:
        _hosted_strict_path(monkeypatch, stub.base_url)
        job = _run_job_through_fake_gateway(client)
    finally:
        stub.server.shutdown()
    assert fake_vlm.calls == ["extract_table"]
    _assert_short_and_long_rows_flagged(job)
    response_format = stub.requests[0]["response_format"]
    assert response_format["type"] == "json_schema" and response_format["json_schema"]["strict"] is True
    cells_schema = response_format["json_schema"]["schema"]["properties"]["rows"]["items"]["properties"]["cells"]
    assert (cells_schema["minItems"], cells_schema["maxItems"]) == (2, 2)


def test_provider_rejecting_length_keywords_is_retried_once_without_them(monkeypatch, fake_vlm, client) -> None:
    stub = _StubProvider(_SHORT_LONG_REPLY, reject_length_keywords=True)
    try:
        _hosted_strict_path(monkeypatch, stub.base_url)
        job = _run_job_through_fake_gateway(client)
    finally:
        stub.server.shutdown()
    assert len(stub.requests) == 2
    assert '"minItems"' in json.dumps(stub.requests[0]["response_format"])
    assert '"minItems"' not in json.dumps(stub.requests[1]["response_format"])
    _assert_short_and_long_rows_flagged(job)


def test_local_raw_json_path_flags_short_and_long_cells(monkeypatch, fake_vlm, client) -> None:
    stub = _StubProvider(_SHORT_LONG_REPLY)
    try:
        monkeypatch.setenv("VLM_PROVIDER", "openai_compatible")
        monkeypatch.setenv("VLM_BASE_URL", stub.base_url)
        monkeypatch.setenv("VLM_MODEL_NAME", "stub-vlm")
        monkeypatch.setenv("VLM_TIMEOUT_SECONDS", "5")
        get_settings.cache_clear()
        job = _run_job_through_fake_gateway(client)
    finally:
        stub.server.shutdown()
    _assert_short_and_long_rows_flagged(job)
    assert "response_format" not in stub.requests[0]
