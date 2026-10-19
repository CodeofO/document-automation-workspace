import io
import time
from typing import Any

from PIL import Image

from app.workflow_graph import build_workflow_graph, validate_workflow_branch_shape, validate_workflow_graph_shape, workflow_summary
from tests.support.api import create_schema


def _landscape_png(width: int = 40, height: int = 20) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), "white").save(buffer, format="PNG")
    return buffer.getvalue()


def _rotation_workflow_definition(schema_id: str) -> dict[str, Any]:
    return {
        "nodes": [
            {"id": "input", "data": {"kind": "input", "label": "Input"}},
            {"id": "rotation", "data": {"kind": "rotation", "label": "회전 보정", "config": {}}},
            {"id": "kie", "data": {"kind": "kie", "label": "KIE", "config": {"schema_id": schema_id}}},
            {"id": "export", "data": {"kind": "export", "label": "Export"}},
        ],
        "edges": [
            {"id": "input-rotation", "source": "input", "target": "rotation"},
            {"id": "rotation-kie", "source": "rotation", "target": "kie"},
            {"id": "kie-export", "source": "kie", "target": "export"},
        ],
    }


def _wait_for_workflow_run(client, run_id: str) -> dict[str, Any]:
    deadline = time.time() + 10
    run = client.get(f"/api/workflow-runs/{run_id}").json()
    while run["status"] not in {"completed", "needs_review", "failed", "completed_with_errors", "canceled"} and time.time() < deadline:
        time.sleep(0.05)
        run = client.get(f"/api/workflow-runs/{run_id}").json()
    return run


def _run_rotation_workflow(client, name: str, filename: str, payload: bytes) -> dict[str, Any]:
    schema = create_schema(client, name=f"{name}_schema")
    workflow = client.post("/api/workflows", json={"name": name, "definition": _rotation_workflow_definition(schema["id"])})
    assert workflow.status_code == 200, workflow.text
    assert workflow.json()["validation_warnings"] == []
    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[("files", (filename, payload, "image/png"))],
    )
    assert run_response.status_code == 200, run_response.text
    return _wait_for_workflow_run(client, run_response.json()["id"])


def _document_pages(document_id: str) -> list[Any]:
    from app.core.db import SessionLocal
    from app.models import DocumentPage

    db = SessionLocal()
    try:
        pages = db.query(DocumentPage).filter(DocumentPage.document_id == document_id).order_by(DocumentPage.page_number).all()
        for page in pages:
            db.expunge(page)
        return pages
    finally:
        db.close()


def test_rotation_node_validates_anywhere_between_input_and_export() -> None:
    graph = build_workflow_graph(
        {
            "nodes": [
                {"id": "input", "type": "input"},
                {"id": "rotate-first", "type": "rotation"},
                {"id": "classifier", "type": "classifier"},
                {"id": "branch", "type": "branch"},
                {"id": "rotate-branch", "type": "rotation_correction"},
                {"id": "kie", "type": "kie"},
                {"id": "export", "type": "export"},
            ],
            "edges": [
                {"id": "e1", "source": "input", "target": "rotate-first"},
                {"id": "e2", "source": "rotate-first", "target": "classifier"},
                {"id": "e3", "source": "classifier", "target": "branch"},
                {"id": "e4", "source": "branch", "target": "rotate-branch", "sourceHandle": "class:invoice"},
                {"id": "e5", "source": "branch", "target": "export", "sourceHandle": "unknown"},
                {"id": "e6", "source": "rotate-branch", "target": "kie"},
                {"id": "e7", "source": "kie", "target": "export"},
            ],
        }
    )

    assert validate_workflow_graph_shape(graph) == []
    assert validate_workflow_branch_shape(graph) == []


def test_workflow_summary_reports_applied_rotation_corrections_only_for_rotation_workflows() -> None:
    node_results = {
        "rotation": {
            "kind": "rotation",
            "status": "needs_review",
            "pages": [
                {"page_number": 1, "status": "corrected", "applied": True, "correction": 90},
                {"page_number": 2, "status": "upright", "applied": False, "correction": 0},
                {"page_number": 3, "status": "low_confidence", "applied": False, "correction": 180},
            ],
        }
    }

    summary = workflow_summary(node_results, None)

    assert summary["rotation_corrected_page_count"] == 1
    assert summary["rotation_corrections"] == [{"page_number": 1, "correction": 90}]
    assert "rotation_corrections" not in workflow_summary({}, None)


def test_rotation_workflow_runs_in_mock_mode_and_exports_rotation_columns(mock_vlm, client) -> None:
    run = _run_rotation_workflow(client, "rotation_mock_workflow", "upright.png", _landscape_png())
    assert run["status"] == "completed", run
    item = run["items"][0]
    assert item["status"] == "completed"
    result = item["result"]
    rotation = result["node_results"]["rotation"]
    assert rotation["kind"] == "rotation"
    assert rotation["label"] == "회전 보정"
    assert rotation["status"] == "completed"
    assert rotation["job_id"]
    assert rotation["corrected_page_count"] == 0
    assert rotation["error_message"] is None
    assert [page["status"] for page in rotation["pages"]] == ["upright"]
    assert result["node_results"]["kie"]["status"] in {"completed", "needs_review"}
    assert result["completed_node_ids"][:2] == ["rotation", "kie"]
    assert result["rotation_corrected_page_count"] == 0

    json_rows = client.get(f"/api/workflow-runs/{run['id']}/export?format=json").json()["rows"]
    assert json_rows[0]["rotation_corrected_pages"] == 0
    assert json_rows[0]["rotation_corrections"] == ""
    header = client.get(f"/api/workflow-runs/{run['id']}/export?format=csv").text.splitlines()[0]
    assert "rotation_corrected_pages" in header
    assert "rotation_corrections" in header


def test_rotation_workflow_rotates_library_pages_before_downstream_nodes(mock_vlm, fake_vlm, client) -> None:
    async def detect_sideways(_inputs):
        return {"upright_candidate": "B", "confidence": 0.95, "reason": "text runs bottom-to-top"}

    fake_vlm.set(detect_page_orientation=detect_sideways)
    run = _run_rotation_workflow(client, "rotation_apply_workflow", "sideways.png", _landscape_png(40, 20))
    item = run["items"][0]
    assert item["status"] in {"completed", "needs_review"}, item
    result = item["result"]
    rotation = result["node_results"]["rotation"]
    assert rotation["status"] == "completed"
    assert rotation["corrected_page_count"] == 1
    assert rotation["pages"][0]["status"] == "corrected"
    assert rotation["pages"][0]["applied"] is True
    assert rotation["pages"][0]["correction"] == 90
    assert "kie" in result["completed_node_ids"]

    pages = _document_pages(item["document_id"])
    assert (pages[0].width, pages[0].height) == (20, 40)
    assert pages[0].rotation_applied == 90
    with Image.open(pages[0].image_path) as image:
        assert image.size == (20, 40)

    json_rows = client.get(f"/api/workflow-runs/{run['id']}/export?format=json").json()["rows"]
    assert json_rows[0]["rotation_corrected_pages"] == 1
    assert json_rows[0]["rotation_corrections"] == "p1:90"
    csv_text = client.get(f"/api/workflow-runs/{run['id']}/export?format=csv").text
    assert "p1:90" in csv_text


def test_rotation_workflow_low_confidence_marks_item_needs_review(mock_vlm, fake_vlm, client) -> None:
    async def detect_unsure(_inputs):
        return {"upright_candidate": "C", "confidence": 0.3, "reason": "blank page"}

    fake_vlm.set(detect_page_orientation=detect_unsure)
    run = _run_rotation_workflow(client, "rotation_review_workflow", "unsure.png", _landscape_png(40, 20))
    item = run["items"][0]
    assert item["status"] == "needs_review", item
    rotation = item["result"]["node_results"]["rotation"]
    assert rotation["status"] == "needs_review"
    assert rotation["pages"][0]["status"] == "low_confidence"
    assert "kie" in item["result"]["completed_node_ids"]
    pages = _document_pages(item["document_id"])
    assert pages[0].rotation_applied == 0
    assert (pages[0].width, pages[0].height) == (40, 20)


def test_rotation_workflow_failure_fails_item_and_skips_downstream(mock_vlm, fake_vlm, client) -> None:
    async def detect_broken(_inputs):
        raise RuntimeError("orientation model offline")

    fake_vlm.set(detect_page_orientation=detect_broken)
    run = _run_rotation_workflow(client, "rotation_failed_workflow", "broken.png", _landscape_png())
    item = run["items"][0]
    assert item["status"] == "failed", item
    assert "orientation model offline" in (item["error_message"] or "")
    result = item["result"]
    assert result["node_results"]["rotation"]["status"] == "failed"
    assert "kie" not in result["node_results"]
