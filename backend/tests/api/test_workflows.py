from uuid import uuid4

from app.models import (
    Batch,
    Document,
    WorkflowRunItem,
)
from tests.conftest import get_client
from tests.support.api import (
    ONE_BY_ONE_PNG,
    assert_xlsx_response,
    create_document_classifier,
    create_required_field_checklist,
    create_schema,
    wait_for_export_job,
    workflow_definition,
)


def test_workflow_ai_draft_mock_mode_does_not_persist_sample_images(mock_vlm) -> None:
    from app.core.db import SessionLocal
    from app.core.migrations import upgrade_database

    upgrade_database()
    db = SessionLocal()
    try:
        before_documents = db.query(Document).count()
        before_batches = db.query(Batch).count()
    finally:
        db.close()

    with get_client() as client:
        response = client.post(
            "/api/workflows/ai-draft",
            files=[
                ("files", ("sample-one.png", ONE_BY_ONE_PNG, "image/png")),
                ("files", ("sample-two.png", ONE_BY_ONE_PNG, "image/png")),
            ],
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["sample_count"] == 2
        assert payload["images_persisted"] is False
        assert payload["schema_draft"]["name"] == "ai_recommended_schema"
        assert len(payload["schema_draft"]["fields"]) >= 3
        assert payload["checklist_draft"]["name"] == "ai_recommended_checklist"
        assert len(payload["definition"]["nodes"]) == 5
        assert any(node["id"] == "ai_kie" for node in payload["definition"]["nodes"])
        assert any(node["id"] == "ai_required" for node in payload["definition"]["nodes"])

    db = SessionLocal()
    try:
        assert db.query(Document).count() == before_documents
        assert db.query(Batch).count() == before_batches
    finally:
        db.close()


def test_workflow_ai_draft_rejects_more_than_ten_images(mock_vlm, client) -> None:
    response = client.post(
        "/api/workflows/ai-draft",
        files=[("files", (f"sample-{index}.png", ONE_BY_ONE_PNG, "image/png")) for index in range(11)],
    )
    assert response.status_code == 413, response.text
    assert "up to 10" in response.json()["detail"]


def test_workflow_ai_draft_can_be_edited_and_saved_as_workflow(mock_vlm, client) -> None:
    unique = uuid4().hex[:8]
    draft_response = client.post(
        "/api/workflows/ai-draft",
        files=[("files", ("sample.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert draft_response.status_code == 200, draft_response.text
    draft = draft_response.json()

    schema_payload = draft["schema_draft"]
    schema_payload["name"] = f"edited_ai_schema_{unique}"
    schema_payload["display_name"] = "Edited AI Schema"
    schema_payload["fields"][0]["key_name"] = "edited_customer_name"
    schema_payload["fields"][0]["description"] = "Customer name edited inside Workflow Builder."
    schema_payload["fields"][0]["judgement_enabled"] = True
    schema_response = client.post("/api/schemas", json=schema_payload)
    assert schema_response.status_code == 200, schema_response.text
    schema = schema_response.json()
    assert schema["fields"][0]["key_name"] == "edited_customer_name"
    assert schema["fields"][0]["judgement_enabled"] is True

    checklist_payload = draft["checklist_draft"]
    assert checklist_payload is not None
    checklist_payload["name"] = f"edited_ai_checklist_{unique}"
    checklist_payload["items"][0]["item_name"] = "edited_required_item"
    checklist_response = client.post("/api/required-field-checklists", json=checklist_payload)
    assert checklist_response.status_code == 200, checklist_response.text
    checklist = checklist_response.json()
    assert checklist["items"][0]["item_name"] == "edited_required_item"

    definition = draft["definition"]
    for node in definition["nodes"]:
        if node["data"]["kind"] == "kie":
            node["data"]["config"] = {"schema_id": schema["id"]}
        if node["data"]["kind"] == "required-checker":
            node["data"]["config"] = {"checklist_id": checklist["id"]}

    workflow_response = client.post(
        "/api/workflows",
        json={"name": f"edited_ai_workflow_{unique}", "definition": definition},
    )
    assert workflow_response.status_code == 200, workflow_response.text
    workflow = workflow_response.json()
    assert workflow["validation_warnings"] == []
    kie_node = next(node for node in workflow["definition"]["nodes"] if node["data"]["kind"] == "kie")
    required_node = next(node for node in workflow["definition"]["nodes"] if node["data"]["kind"] == "required-checker")
    assert kie_node["data"]["config"]["schema_id"] == schema["id"]
    assert required_node["data"]["config"]["checklist_id"] == checklist["id"]


def test_workflow_definition_validation_and_branch_run_mock_mode(mock_vlm, client) -> None:
    schema = create_schema(client, name="workflow_invoice_schema")
    classifier = create_document_classifier(client, name="workflow_classifier")
    checklist = create_required_field_checklist(client, name="workflow_checklist")

    invalid = client.post(
        "/api/workflows",
        json={
            "name": "invalid_workflow",
            "definition": {
                "nodes": [
                    {"id": "input", "data": {"kind": "input"}},
                    {"id": "classifier", "data": {"kind": "classifier", "config": {}}},
                    {"id": "export", "data": {"kind": "export"}},
                ],
                "edges": [
                    {"id": "e1", "source": "input", "target": "classifier"},
                    {"id": "e2", "source": "classifier", "target": "export"},
                ],
            },
        },
    )
    assert invalid.status_code == 422
    assert "Classifier node classifier" in invalid.text

    workflow = client.post(
        "/api/workflows",
        json={
            "name": "분기 워크플로우",
            "description": "Classifier 결과에 따라 계약서 경로를 실행합니다.",
            "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"]),
        },
    )
    assert workflow.status_code == 200, workflow.text
    assert workflow.json()["validation_warnings"] == []

    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[
            ("files", ("z_last.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("a_first.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert run_response.status_code == 200, run_response.text
    run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
    assert run["status"] in {"completed", "needs_review"}
    assert run["total_count"] == 2
    assert [item["filename"] for item in run["items"]] == ["a_first.png", "z_last.png"]
    first = run["items"][0]["result"]
    assert first["classification"]["class_name"] == "contract"
    assert first["branch_path"] == "class:contract"
    assert "invoice_number" in first["kie_values"]
    assert first["required_items"]["성명"]["status"] == "present"

    csv_response = client.get(f"/api/workflow-runs/{run['id']}/export?format=csv")
    assert csv_response.status_code == 200, csv_response.text
    assert csv_response.content.startswith(b"\xef\xbb\xbf")
    assert "charset=utf-8" in csv_response.headers["content-type"]
    header = csv_response.text.splitlines()[0]
    assert "classification_status" in header
    assert "upload_duration_ms" in header
    assert "inference_duration_ms" in header
    assert "kie_invoice_number" in header
    assert "required_성명_status" in header
    assert csv_response.text.index("a_first.png") < csv_response.text.index("z_last.png")

    json_response = client.get(f"/api/workflow-runs/{run['id']}/export?format=json")
    assert json_response.status_code == 200
    assert isinstance(run["upload_duration_ms"], int)
    assert isinstance(run["inference_duration_ms"], int)
    assert all(isinstance(item["upload_duration_ms"], int) for item in run["items"])
    assert all(isinstance(item["inference_duration_ms"], int) for item in run["items"])
    assert json_response.json()["rows"][0]["upload_duration_ms"] is not None
    assert json_response.json()["rows"][0]["class_name"] == "contract"

    xlsx_response = client.get(f"/api/workflow-runs/{run['id']}/export?format=xlsx")
    assert_xlsx_response(xlsx_response)

    export_job = client.post(
        "/api/export-jobs",
        json={"owner_type": "workflow_run", "owner_id": run["id"], "format": "json"},
    )
    assert export_job.status_code == 202, export_job.text
    completed_export = wait_for_export_job(client, export_job.json()["id"])
    assert completed_export["status"] == "completed", completed_export
    async_download = client.get(f"/api/export-jobs/{completed_export['id']}/download")
    assert async_download.status_code == 200, async_download.text
    assert async_download.json()["workflow_run_id"] == run["id"]


def test_workflow_branch_without_fallback_exports_classification_only(mock_vlm, fake_vlm, client) -> None:
    fake_vlm.set(
        classify_document=lambda classes, allow_unknown, image_paths: {
            "status": "unknown",
            "class_name": None,
            "confidence": 0.2,
            "reason": "No class matched.",
            "evidence": [],
        },
    )
    schema = create_schema(client, name="workflow_fallback_schema")
    classifier = create_document_classifier(client, name="workflow_fallback_classifier")
    checklist = create_required_field_checklist(client, name="workflow_fallback_checklist")
    definition = workflow_definition(schema["id"], classifier["id"], checklist["id"])
    definition["edges"] = [
        edge for edge in definition["edges"] if edge.get("sourceHandle") == "class:contract" or edge["source"] != "branch"
    ]
    workflow = client.post("/api/workflows", json={"name": "fallback_missing", "definition": definition})
    assert workflow.status_code == 200, workflow.text
    assert workflow.json()["validation_warnings"]

    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[("files", ("invoice.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert run_response.status_code == 200, run_response.text
    run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
    assert run["status"] == "completed"
    item = run["items"][0]
    assert item["status"] == "completed"
    assert item["error_message"] is None
    assert item["result"]["branch_path"] == "unknown"
    assert item["result"]["kie_values"] == {}


def test_workflow_branch_without_downstream_path_completes_classification_only(mock_vlm, client) -> None:
    schema = create_schema(client, name="workflow_no_downstream_schema")
    classifier = create_document_classifier(client, name="workflow_no_downstream_classifier")
    checklist = create_required_field_checklist(client, name="workflow_no_downstream_checklist")
    definition = workflow_definition(schema["id"], classifier["id"], checklist["id"])
    definition["edges"] = [edge for edge in definition["edges"] if edge["source"] != "branch"]
    workflow = client.post("/api/workflows", json={"name": "classification_only", "definition": definition})
    assert workflow.status_code == 200, workflow.text
    assert workflow.json()["validation_warnings"]

    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[("files", ("contract.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert run_response.status_code == 200, run_response.text
    run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
    item = run["items"][0]
    assert item["status"] == "completed"
    assert item["error_message"] is None
    assert item["result"]["classification"]["class_name"] == "contract"
    assert item["result"]["branch_path"] == "class:contract"
    assert item["result"]["kie_values"] == {}
    assert item["result"]["required_items"] == {}


def test_workflow_progress_payload_marks_current_and_completed_nodes(mock_vlm, fake_vlm, client) -> None:
    from app.core.db import SessionLocal

    observed_current_nodes: list[str | None] = []

    def fake_classify(classes, allow_unknown, image_paths):
        db = SessionLocal()
        try:
            item = db.query(WorkflowRunItem).one()
            observed_current_nodes.append((item.result_json or {}).get("current_node_kind"))
        finally:
            db.close()
        return {"status": "classified", "class_name": "contract", "confidence": 0.9, "reason": "test", "evidence": []}

    fake_vlm.set(classify_document=fake_classify)
    schema = create_schema(client, name="workflow_progress_schema")
    classifier = create_document_classifier(client, name="workflow_progress_classifier")
    checklist = create_required_field_checklist(client, name="workflow_progress_checklist")
    definition = workflow_definition(schema["id"], classifier["id"], checklist["id"])
    definition["edges"] = [edge for edge in definition["edges"] if edge["source"] != "branch"]
    workflow = client.post("/api/workflows", json={"name": "progress_payload", "definition": definition})
    assert workflow.status_code == 200, workflow.text

    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[("files", ("progress.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert run_response.status_code == 200, run_response.text
    run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
    result = run["items"][0]["result"]
    assert observed_current_nodes == ["classifier"]
    assert result["current_node_id"] is None
    assert "classifier" in result["completed_node_ids"]
    assert "branch" in result["completed_node_ids"]
