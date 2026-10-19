import asyncio
import threading
import time
from datetime import datetime
from typing import Any

import pytest

from app.models import (
    Document,
    WorkflowRun,
    WorkflowRunItem,
)
from tests.conftest import get_client
from tests.support.api import (
    ONE_BY_ONE_PNG,
    create_document_classifier,
    create_required_field_checklist,
    create_schema,
    workflow_definition,
)


def test_workflow_summary_polling_uses_aggregate_counts_without_result_payloads() -> None:
    from sqlalchemy import event

    from app.core.db import SessionLocal, engine
    from app.core.migrations import upgrade_database
    from app.models import WorkflowDefinition, WorkflowRunItem

    upgrade_database()
    db = SessionLocal()
    try:
        workflow = WorkflowDefinition(
            name="summary_polling_workflow",
            definition_json={"nodes": [], "edges": []},
        )
        db.add(workflow)
        db.flush()
        run = WorkflowRun(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            status="running",
            total_count=4,
        )
        db.add(run)
        db.flush()
        for index, status in enumerate(["completed", "needs_review", "failed", "canceled"]):
            db.add(
                WorkflowRunItem(
                    run_id=run.id,
                    document_id=f"doc_summary_{index}",
                    filename=f"summary_{index}.png",
                    upload_index=index,
                    status=status,
                    result_json={"payload": "x" * 10000},
                )
            )
        db.commit()
        run_id = run.id
    finally:
        db.close()

    item_queries: list[str] = []

    def capture_item_queries(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        normalized = " ".join(statement.lower().split())
        if "workflow_run_items" in normalized:
            item_queries.append(normalized)

    event.listen(engine, "before_cursor_execute", capture_item_queries)
    try:
        with get_client() as client:
            summary_response = client.get(f"/api/workflow-runs/{run_id}/summary")
            list_response = client.get("/api/workflow-runs?limit=100")
    finally:
        event.remove(engine, "before_cursor_execute", capture_item_queries)

    assert summary_response.status_code == 200, summary_response.text
    summary = summary_response.json()
    assert summary["items"] == []
    assert summary["status"] == "completed_with_errors"
    assert summary["completed_count"] == 1
    assert summary["failed_count"] == 1
    assert summary["needs_review_count"] == 1
    assert summary["canceled_count"] == 1
    assert summary["progress"] == 1

    assert list_response.status_code == 200, list_response.text
    listed = next(item for item in list_response.json() if item["id"] == run_id)
    assert listed["items"] == []
    assert listed["failed_count"] == 1

    assert item_queries
    assert any("count" in query and "group by" in query for query in item_queries)
    assert all("result_json" not in query for query in item_queries)


def test_workflow_summary_polling_handles_1000_item_run_with_stable_counts() -> None:
    from sqlalchemy import event

    from app.core.db import SessionLocal, engine
    from app.core.migrations import upgrade_database
    from app.models import WorkflowDefinition, WorkflowRunItem

    upgrade_database()
    status_sequence = (
        ["completed"] * 700
        + ["needs_review"] * 100
        + ["failed"] * 50
        + ["canceled"] * 25
        + ["running"] * 75
        + ["waiting_for_document"] * 50
    )
    db = SessionLocal()
    try:
        workflow = WorkflowDefinition(
            name="summary_polling_1000_workflow",
            definition_json={"nodes": [], "edges": []},
        )
        db.add(workflow)
        db.flush()
        run = WorkflowRun(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            status="running",
            total_count=len(status_sequence),
        )
        db.add(run)
        db.flush()
        db.add_all(
            [
                WorkflowRunItem(
                    run_id=run.id,
                    document_id=f"doc_summary_1000_{index}",
                    filename=f"summary_1000_{index:04d}.png",
                    upload_index=index,
                    status=status,
                    result_json={"payload": "x" * 100},
                )
                for index, status in enumerate(status_sequence)
            ]
        )
        db.commit()
        run_id = run.id
    finally:
        db.close()

    item_queries: list[str] = []

    def capture_item_queries(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        normalized = " ".join(statement.lower().split())
        if "workflow_run_items" in normalized:
            item_queries.append(normalized)

    event.listen(engine, "before_cursor_execute", capture_item_queries)
    try:
        with get_client() as client:
            summary_response = client.get(f"/api/workflow-runs/{run_id}/summary")
    finally:
        event.remove(engine, "before_cursor_execute", capture_item_queries)

    assert summary_response.status_code == 200, summary_response.text
    summary = summary_response.json()
    assert summary["items"] == []
    assert summary["total_count"] == 1000
    assert summary["uploaded_count"] == 1000
    assert summary["completed_count"] == 700
    assert summary["needs_review_count"] == 100
    assert summary["failed_count"] == 50
    assert summary["canceled_count"] == 25
    assert summary["running_count"] == 75
    assert summary["preprocessing_count"] == 50
    assert summary["progress_phase"] == "preprocessing"
    assert summary["progress"] == 0.875
    assert {"vlm_active_count", "vlm_waiting_count", "vlm_limit"}.issubset(summary)
    assert item_queries
    assert any("count" in query and "group by" in query for query in item_queries)
    assert all("result_json" not in query for query in item_queries)


@pytest.mark.parametrize(
    "status",
    ["running", "paused", "completed", "completed_with_errors", "needs_review", "failed", "canceled"],
)
def test_workflow_start_rejects_non_startable_statuses(status: str) -> None:
    from app.core.db import SessionLocal
    from app.core.migrations import upgrade_database
    from app.models import WorkflowDefinition, WorkflowRunItem

    upgrade_database()
    db = SessionLocal()
    try:
        workflow = WorkflowDefinition(
            name=f"start_reject_{status}_workflow",
            definition_json={"nodes": [], "edges": []},
        )
        db.add(workflow)
        db.flush()
        run = WorkflowRun(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            status=status,
            total_count=1,
            completed_at=datetime.utcnow()
            if status in {"completed", "completed_with_errors", "needs_review", "failed", "canceled"}
            else None,
        )
        db.add(run)
        db.flush()
        db.add(
            WorkflowRunItem(
                run_id=run.id,
                document_id=f"doc_start_reject_{status}",
                filename=f"start_reject_{status}.png",
                upload_index=0,
                status="completed" if status == "completed_with_errors" else status,
                completed_at=datetime.utcnow()
                if status in {"completed", "completed_with_errors", "needs_review", "failed", "canceled"}
                else None,
            )
        )
        db.commit()
        run_id = run.id
    finally:
        db.close()

    with get_client() as client:
        response = client.post(f"/api/workflow-runs/{run_id}/start")
        assert response.status_code == 409, response.text
        refreshed = client.get(f"/api/workflow-runs/{run_id}").json()

    assert refreshed["status"] == status


@pytest.mark.parametrize("status", ["completed", "completed_with_errors", "needs_review", "failed", "canceled"])
def test_workflow_discard_rejects_terminal_statuses(status: str) -> None:
    from app.core.db import SessionLocal
    from app.core.migrations import upgrade_database
    from app.models import WorkflowDefinition, WorkflowRunItem

    upgrade_database()
    db = SessionLocal()
    try:
        workflow = WorkflowDefinition(
            name=f"discard_reject_{status}_workflow",
            definition_json={"nodes": [], "edges": []},
        )
        db.add(workflow)
        db.flush()
        run = WorkflowRun(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            status=status,
            total_count=1,
            completed_at=datetime.utcnow(),
        )
        db.add(run)
        db.flush()
        db.add(
            WorkflowRunItem(
                run_id=run.id,
                document_id=f"doc_discard_reject_{status}",
                filename=f"discard_reject_{status}.png",
                upload_index=0,
                status=status,
                completed_at=datetime.utcnow(),
            )
        )
        db.commit()
        run_id = run.id
    finally:
        db.close()

    with get_client() as client:
        response = client.post(f"/api/workflow-runs/{run_id}/discard")
        assert response.status_code == 409, response.text
        refreshed = client.get(f"/api/workflow-runs/{run_id}").json()

    assert refreshed["status"] == status


def test_workflow_resume_and_discard_partial_upload(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_resume_schema")
    classifier = create_document_classifier(client, name="workflow_resume_classifier")
    checklist = create_required_field_checklist(client, name="workflow_resume_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "resume_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text

    initialized = client.post(f"/api/workflows/{workflow.json()['id']}/runs/init", json={"total_count": 2})
    assert initialized.status_code == 200, initialized.text
    run_id = initialized.json()["id"]

    appended = client.post(
        f"/api/workflow-runs/{run_id}/items",
        data={"client_file_ids": ["0:first.png:1:1"]},
        files=[("files", ("first.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert appended.status_code == 200, appended.text
    document_id = appended.json()["items"][0]["document_id"]
    assert appended.json()["uploaded_count"] == 1
    assert appended.json()["total_count"] == 2

    resumed = client.post(f"/api/workflow-runs/{run_id}/resume")
    assert resumed.status_code == 422, resumed.text
    payload = resumed.json()["detail"]
    assert payload["uploaded_count"] == 1
    assert payload["total_count"] == 2
    assert payload["missing_count"] == 1

    paused = client.post(f"/api/workflow-runs/{run_id}/pause")
    assert paused.status_code == 200, paused.text
    assert paused.json()["status"] == "paused"

    appended = client.post(
        f"/api/workflow-runs/{run_id}/items",
        data={"client_file_ids": ["1:second.png:1:1"]},
        files=[("files", ("second.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert appended.status_code == 200, appended.text
    started = client.post(f"/api/workflow-runs/{run_id}/start")
    assert started.status_code == 200, started.text
    payload = started.json()
    assert payload["status"] == "running"
    assert payload["total_count"] == 2
    assert payload["queued_count"] == 2

    discarded = client.post(f"/api/workflow-runs/{run_id}/discard")
    assert discarded.status_code == 200, discarded.text
    payload = discarded.json()
    assert payload["status"] == "canceled"
    assert len(payload["items"]) == 2
    assert payload["uploaded_count"] == 2
    assert client.get(f"/api/documents/{document_id}").status_code == 200


def test_workflow_items_preserve_upload_index_order(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_upload_index_schema")
    classifier = create_document_classifier(client, name="workflow_upload_index_classifier")
    checklist = create_required_field_checklist(client, name="workflow_upload_index_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "upload_index_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text

    initialized = client.post(f"/api/workflows/{workflow.json()['id']}/runs/init", json={"total_count": 2})
    assert initialized.status_code == 200, initialized.text
    run_id = initialized.json()["id"]

    appended = client.post(
        f"/api/workflow-runs/{run_id}/items",
        data={
            "client_file_ids": ["1:z_last.png:1:1", "0:a_first.png:1:1"],
            "upload_indexes": ["1", "0"],
        },
        files=[
            ("files", ("z_last.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("a_first.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert appended.status_code == 200, appended.text
    payload = appended.json()
    assert [item["filename"] for item in payload["items"]] == ["a_first.png", "z_last.png"]
    assert [item["upload_index"] for item in payload["items"]] == [0, 1]


def test_workflow_resume_skips_existing_upload_indexes_when_client_ids_change(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_resume_index_schema")
    classifier = create_document_classifier(client, name="workflow_resume_index_classifier")
    checklist = create_required_field_checklist(client, name="workflow_resume_index_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "resume_index_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text

    initialized = client.post(f"/api/workflows/{workflow.json()['id']}/runs/init", json={"total_count": 3})
    assert initialized.status_code == 200, initialized.text
    run_id = initialized.json()["id"]

    first = client.post(
        f"/api/workflow-runs/{run_id}/items",
        data={"client_file_ids": ["original:0", "original:1"], "upload_indexes": ["0", "1"]},
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert first.status_code == 200, first.text
    assert first.json()["uploaded_count"] == 2

    resumed = client.post(
        f"/api/workflow-runs/{run_id}/items",
        data={
            "client_file_ids": ["changed:0", "changed:1", "changed:2"],
            "upload_indexes": ["0", "1", "2"],
        },
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("third.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert resumed.status_code == 200, resumed.text
    payload = resumed.json()
    assert payload["uploaded_count"] == 3
    assert [item["upload_index"] for item in payload["items"]] == [0, 1, 2]


def test_workflow_restart_seals_missing_upload_slots(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_seal_schema")
    classifier = create_document_classifier(client, name="workflow_seal_classifier")
    checklist = create_required_field_checklist(client, name="workflow_seal_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "seal_missing_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text

    initialized = client.post(f"/api/workflows/{workflow.json()['id']}/runs/init", json={"total_count": 3})
    assert initialized.status_code == 200, initialized.text
    run_id = initialized.json()["id"]

    appended = client.post(
        f"/api/workflow-runs/{run_id}/items",
        data={"client_file_ids": ["original:0"], "upload_indexes": ["0"]},
        files=[("files", ("first.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert appended.status_code == 200, appended.text
    paused = client.post(f"/api/workflow-runs/{run_id}/pause")
    assert paused.status_code == 200, paused.text

    restarted = client.post(f"/api/workflow-runs/{run_id}/restart")
    assert restarted.status_code == 200, restarted.text
    payload = restarted.json()
    assert payload["id"] != run_id
    assert payload["restarted_from_run_id"] == run_id
    assert payload["status"] == "running"
    assert payload["uploaded_count"] == 3
    assert payload["failed_count"] == 2
    assert payload["queued_count"] == 1
    assert sorted(item["upload_index"] for item in payload["items"]) == [0, 1, 2]
    assert sum(1 for item in payload["items"] if item["filename"].startswith("missing_upload_")) == 2


def test_workflow_pause_preserves_uploads_and_restart_requeues(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_pause_schema")
    classifier = create_document_classifier(client, name="workflow_pause_classifier")
    checklist = create_required_field_checklist(client, name="workflow_pause_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "pause_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text
    initialized = client.post(f"/api/workflows/{workflow.json()['id']}/runs/init", json={"total_count": 2})
    assert initialized.status_code == 200, initialized.text
    run_id = initialized.json()["id"]
    appended = client.post(
        f"/api/workflow-runs/{run_id}/items",
        data={"client_file_ids": ["0:first.png:1:1", "1:second.png:1:1"], "upload_indexes": ["0", "1"]},
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert appended.status_code == 200, appended.text
    started = client.post(f"/api/workflow-runs/{run_id}/start")
    assert started.status_code == 200, started.text

    paused = client.post(f"/api/workflow-runs/{run_id}/pause")
    assert paused.status_code == 200, paused.text
    payload = paused.json()
    assert payload["status"] == "paused"
    assert payload["uploaded_count"] == 2
    assert {item["status"] for item in payload["items"]} == {"paused"}

    restarted = client.post(f"/api/workflow-runs/{run_id}/restart")
    assert restarted.status_code == 200, restarted.text
    payload = restarted.json()
    assert payload["id"] != run_id
    assert payload["restarted_from_run_id"] == run_id
    assert payload["status"] == "running"
    assert payload["queued_count"] == 2
    assert {item["status"] for item in payload["items"]} == {"queued"}


def test_workflow_restart_can_create_new_run_with_current_workflow_without_copying_documents(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_restart_target_schema")
    classifier = create_document_classifier(client, name="workflow_restart_target_classifier")
    checklist = create_required_field_checklist(client, name="workflow_restart_target_checklist")
    workflow_one = client.post(
        "/api/workflows",
        json={"name": "workflow_one", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    workflow_two = client.post(
        "/api/workflows",
        json={"name": "workflow_two", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow_one.status_code == 200, workflow_one.text
    assert workflow_two.status_code == 200, workflow_two.text

    run_response = client.post(
        f"/api/workflows/{workflow_one.json()['id']}/runs",
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert run_response.status_code == 200, run_response.text
    source_run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
    source_document_ids = [item["document_id"] for item in source_run["items"]]
    assert source_run["started_at"] is not None
    assert source_run["completed_at"] is None

    restarted = client.post(
        f"/api/workflow-runs/{source_run['id']}/restart",
        json={"workflow_id": workflow_two.json()["id"]},
    )
    assert restarted.status_code == 200, restarted.text
    new_run = restarted.json()
    assert new_run["id"] != source_run["id"]
    assert new_run["workflow_id"] == workflow_two.json()["id"]
    assert new_run["workflow_name"] == "workflow_two"
    assert new_run["restarted_from_run_id"] == source_run["id"]
    assert [item["document_id"] for item in new_run["items"]] == source_document_ids
    assert new_run["started_at"] is not None
    assert new_run["completed_at"] is None

    replaced_source = client.get(f"/api/workflow-runs/{source_run['id']}").json()
    assert replaced_source["status"] == "canceled"
    assert replaced_source["completed_at"] is not None


def test_workflow_enqueue_creates_waiting_run_without_copying_documents(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_enqueue_schema")
    classifier = create_document_classifier(client, name="workflow_enqueue_classifier")
    checklist = create_required_field_checklist(client, name="workflow_enqueue_checklist")
    workflow_one = client.post(
        "/api/workflows",
        json={"name": "queue_workflow_one", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    workflow_two = client.post(
        "/api/workflows",
        json={"name": "queue_workflow_two", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow_one.status_code == 200, workflow_one.text
    assert workflow_two.status_code == 200, workflow_two.text

    run_response = client.post(
        f"/api/workflows/{workflow_one.json()['id']}/runs",
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert run_response.status_code == 200, run_response.text
    source_run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
    source_document_ids = [item["document_id"] for item in source_run["items"]]
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        document_count_before = db.query(Document).count()
    finally:
        db.close()

    queued = client.post(
        f"/api/workflow-runs/{source_run['id']}/enqueue",
        json={"workflow_id": workflow_two.json()["id"]},
    )
    assert queued.status_code == 200, queued.text
    payload = queued.json()
    assert payload["id"] != source_run["id"]
    assert payload["workflow_id"] == workflow_two.json()["id"]
    assert payload["workflow_name"] == "queue_workflow_two"
    assert payload["status"] == "waiting"
    assert payload["workflow_run_group_id"] == source_run["id"]
    assert payload["queued_from_run_id"] == source_run["id"]
    assert payload["queue_order"] == 2
    assert [item["document_id"] for item in payload["items"]] == source_document_ids
    assert {item["status"] for item in payload["items"]} == {"queued"}
    db = SessionLocal()
    try:
        assert db.query(Document).count() == document_count_before
    finally:
        db.close()

    refreshed_source = client.get(f"/api/workflow-runs/{source_run['id']}").json()
    assert refreshed_source["workflow_run_group_id"] == source_run["id"]
    assert refreshed_source["queue_order"] == 1


def test_workflow_waiting_run_cannot_enqueue_or_start_out_of_order(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_queue_order_schema")
    classifier = create_document_classifier(client, name="workflow_queue_order_classifier")
    checklist = create_required_field_checklist(client, name="workflow_queue_order_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "queue_order_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text

    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[("files", ("first.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert run_response.status_code == 200, run_response.text
    source_run_id = run_response.json()["id"]

    first_waiting = client.post(f"/api/workflow-runs/{source_run_id}/enqueue")
    second_waiting = client.post(f"/api/workflow-runs/{source_run_id}/enqueue")
    assert first_waiting.status_code == 200, first_waiting.text
    assert second_waiting.status_code == 200, second_waiting.text
    first_waiting_id = first_waiting.json()["id"]
    second_waiting_id = second_waiting.json()["id"]

    reenqueued = client.post(f"/api/workflow-runs/{first_waiting_id}/enqueue")
    assert reenqueued.status_code == 409, reenqueued.text

    blocked_by_source = client.post(f"/api/workflow-runs/{first_waiting_id}/start")
    assert blocked_by_source.status_code == 409, blocked_by_source.text
    resume_waiting = client.post(f"/api/workflow-runs/{first_waiting_id}/resume")
    assert resume_waiting.status_code == 409, resume_waiting.text
    pause_waiting = client.post(f"/api/workflow-runs/{first_waiting_id}/pause")
    assert pause_waiting.status_code == 409, pause_waiting.text
    assert client.get(f"/api/workflow-runs/{first_waiting_id}").json()["status"] == "waiting"

    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        source_run = db.get(WorkflowRun, source_run_id)
        assert source_run is not None
        source_run.status = "completed"
        source_run.completed_at = datetime.utcnow()
        for item in source_run.items:
            item.status = "completed"
            item.error_message = None
            item.completed_at = datetime.utcnow()
            item.result_json = {"document_id": item.document_id, "filename": item.filename, "node_results": {}}
        db.commit()
    finally:
        db.close()

    out_of_order = client.post(f"/api/workflow-runs/{second_waiting_id}/start")
    assert out_of_order.status_code == 409, out_of_order.text

    started = client.post(f"/api/workflow-runs/{first_waiting_id}/start")
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "running"


def test_workflow_finalize_starts_next_waiting_run(job_runners, client) -> None:
    from app import workflows as workflow_module
    from app.core.db import SessionLocal

    dispatched: list[tuple[str, int]] = []
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_queue_advance_schema")
    classifier = create_document_classifier(client, name="workflow_queue_advance_classifier")
    checklist = create_required_field_checklist(client, name="workflow_queue_advance_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "queue_advance_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text

    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert run_response.status_code == 200, run_response.text
    source_run_id = run_response.json()["id"]
    queued = client.post(f"/api/workflow-runs/{source_run_id}/enqueue")
    assert queued.status_code == 200, queued.text
    queued_run_id = queued.json()["id"]

    db = SessionLocal()
    try:
        source_run = db.get(WorkflowRun, source_run_id)
        assert source_run is not None
        generation = source_run.execution_generation
        source_run.status = "running"
        for item in source_run.items:
            item.status = "completed"
            item.error_message = None
            item.completed_at = datetime.utcnow()
            item.result_json = {"document_id": item.document_id, "filename": item.filename, "node_results": {}}
        db.commit()
    finally:
        db.close()

    job_runners.set(workflow_run=lambda run_id, generation: dispatched.append((run_id, generation)))
    workflow_module._finalize_workflow_run(source_run_id, generation)

    payload = client.get(f"/api/workflow-runs/{queued_run_id}").json()
    assert payload["status"] == "running"
    assert payload["queued_count"] == 2
    assert dispatched == [(queued_run_id, 1)]

    db = SessionLocal()
    try:
        queued_items = db.query(WorkflowRunItem).filter(WorkflowRunItem.run_id == queued_run_id).all()
        assert {item.execution_generation for item in queued_items} == {1}
    finally:
        db.close()


@pytest.mark.parametrize("blocked_status", ["paused", "canceled"])
def test_workflow_finalize_does_not_advance_queue_for_blocking_statuses(blocked_status: str, job_runners, client) -> None:
    from app import workflows as workflow_module
    from app.core.db import SessionLocal

    dispatched: list[tuple[str, int]] = []
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name=f"workflow_queue_blocked_{blocked_status}_schema")
    classifier = create_document_classifier(client, name=f"workflow_queue_blocked_{blocked_status}_classifier")
    checklist = create_required_field_checklist(client, name=f"workflow_queue_blocked_{blocked_status}_checklist")
    workflow = client.post(
        "/api/workflows",
        json={
            "name": f"queue_blocked_{blocked_status}_workflow",
            "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"]),
        },
    )
    assert workflow.status_code == 200, workflow.text

    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[("files", ("first.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert run_response.status_code == 200, run_response.text
    source_run_id = run_response.json()["id"]
    queued = client.post(f"/api/workflow-runs/{source_run_id}/enqueue")
    assert queued.status_code == 200, queued.text
    queued_run_id = queued.json()["id"]

    db = SessionLocal()
    try:
        source_run = db.get(WorkflowRun, source_run_id)
        assert source_run is not None
        generation = source_run.execution_generation
        source_run.status = blocked_status
        for item in source_run.items:
            item.status = blocked_status
            item.error_message = f"{blocked_status} by test"
            item.completed_at = datetime.utcnow()
        db.commit()
    finally:
        db.close()

    job_runners.set(workflow_run=lambda run_id, generation: dispatched.append((run_id, generation)))
    workflow_module._finalize_workflow_run(source_run_id, generation)

    payload = client.get(f"/api/workflow-runs/{queued_run_id}").json()
    assert payload["status"] == "waiting"
    assert dispatched == []


def test_workflow_cancel_waiting_run_preserves_shared_documents(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_cancel_waiting_schema")
    classifier = create_document_classifier(client, name="workflow_cancel_waiting_classifier")
    checklist = create_required_field_checklist(client, name="workflow_cancel_waiting_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "cancel_waiting_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text

    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[("files", ("first.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert run_response.status_code == 200, run_response.text
    source_run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
    source_document_id = source_run["items"][0]["document_id"]
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        source_row = db.get(WorkflowRun, source_run["id"])
        assert source_row is not None
        source_row.status = "completed"
        source_row.completed_at = datetime.utcnow()
        source_row.inference_started_at = None
        for item in source_row.items:
            item.status = "completed"
            item.completed_at = source_row.completed_at
        db.commit()
    finally:
        db.close()

    queued = client.post(f"/api/workflow-runs/{source_run['id']}/enqueue")
    assert queued.status_code == 200, queued.text
    queued_run_id = queued.json()["id"]

    canceled = client.post(f"/api/workflow-runs/{queued_run_id}/cancel-waiting")
    assert canceled.status_code == 200, canceled.text
    payload = canceled.json()
    assert payload["status"] == "canceled"
    assert payload["items"][0]["status"] == "canceled"
    assert client.get(f"/api/documents/{source_document_id}").status_code == 200


def test_workflow_queue_entry_delete_removes_run_without_deleting_documents(job_runners, client) -> None:
    job_runners.set(workflow_run=lambda *args: None)

    schema = create_schema(client, name="workflow_delete_queue_schema")
    classifier = create_document_classifier(client, name="workflow_delete_queue_classifier")
    checklist = create_required_field_checklist(client, name="workflow_delete_queue_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "delete_queue_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text

    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[("files", ("first.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert run_response.status_code == 200, run_response.text
    source_run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
    source_document_id = source_run["items"][0]["document_id"]
    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        source_row = db.get(WorkflowRun, source_run["id"])
        assert source_row is not None
        source_row.status = "completed"
        source_row.completed_at = datetime.utcnow()
        source_row.inference_started_at = None
        for item in source_row.items:
            item.status = "completed"
            item.completed_at = source_row.completed_at
        db.commit()
    finally:
        db.close()

    queued = client.post(f"/api/workflow-runs/{source_run['id']}/enqueue")
    assert queued.status_code == 200, queued.text
    queued_run_id = queued.json()["id"]

    removed = client.delete(f"/api/workflow-runs/{queued_run_id}/queue-entry")
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"status": "deleted", "id": queued_run_id}
    assert client.get(f"/api/workflow-runs/{queued_run_id}").status_code == 404
    assert client.get(f"/api/documents/{source_document_id}").status_code == 200

    queued_again = client.post(f"/api/workflow-runs/{source_run['id']}/enqueue")
    assert queued_again.status_code == 200, queued_again.text
    queued_again_id = queued_again.json()["id"]
    canceled = client.post(f"/api/workflow-runs/{queued_again_id}/cancel-waiting")
    assert canceled.status_code == 200, canceled.text
    removed_canceled = client.delete(f"/api/workflow-runs/{queued_again_id}/queue-entry")
    assert removed_canceled.status_code == 200, removed_canceled.text
    assert client.get(f"/api/workflow-runs/{queued_again_id}").status_code == 404
    assert client.get(f"/api/documents/{source_document_id}").status_code == 200

    queued_active = client.post(f"/api/workflow-runs/{source_run['id']}/enqueue")
    assert queued_active.status_code == 200, queued_active.text
    queued_active_id = queued_active.json()["id"]
    started = client.post(f"/api/workflow-runs/{queued_active_id}/start")
    assert started.status_code == 200, started.text
    removed_active = client.delete(f"/api/workflow-runs/{queued_active_id}/queue-entry")
    assert removed_active.status_code == 200, removed_active.text
    assert client.get(f"/api/workflow-runs/{queued_active_id}").status_code == 404
    assert client.get(f"/api/documents/{source_document_id}").status_code == 200

    queued_paused = client.post(f"/api/workflow-runs/{source_run['id']}/enqueue")
    assert queued_paused.status_code == 200, queued_paused.text
    queued_paused_id = queued_paused.json()["id"]
    started_paused = client.post(f"/api/workflow-runs/{queued_paused_id}/start")
    assert started_paused.status_code == 200, started_paused.text
    paused = client.post(f"/api/workflow-runs/{queued_paused_id}/pause")
    assert paused.status_code == 200, paused.text
    removed_paused = client.delete(f"/api/workflow-runs/{queued_paused_id}/queue-entry")
    assert removed_paused.status_code == 200, removed_paused.text
    assert client.get(f"/api/workflow-runs/{queued_paused_id}").status_code == 404
    assert client.get(f"/api/documents/{source_document_id}").status_code == 200


def test_workflow_restart_retries_failed_items_without_reupload(monkeypatch, mock_vlm, client) -> None:
    async def fake_failed_execute(item_id, document_id, filename, graph, execution_generation, page_number=None):
        return {
            "document_id": document_id,
            "filename": filename,
            "status": "failed",
            "error_message": "VLM_PROVIDER_REQUEST_FAILED: invalid api key",
            "branch_path": None,
            "path_node_ids": ["classifier"],
            "completed_node_ids": [],
            "current_node_id": None,
            "current_node_kind": None,
            "current_node_label": None,
            "node_results": {},
        }

    async def fake_success_execute(item_id, document_id, filename, graph, execution_generation, page_number=None):
        return {
            "document_id": document_id,
            "filename": filename,
            "status": "completed",
            "error_message": None,
            "branch_path": "class:contract",
            "path_node_ids": ["classifier"],
            "completed_node_ids": ["classifier"],
            "current_node_id": None,
            "current_node_kind": None,
            "current_node_label": None,
            "node_results": {},
            "classification": {"status": "classified", "class_name": "contract"},
            "kie_values": {},
            "required_overall_status": None,
            "required_items": {},
        }

    monkeypatch.setattr("app.workflows._execute_graph_for_item_async", fake_failed_execute)
    schema = create_schema(client, name="workflow_restart_schema")
    classifier = create_document_classifier(client, name="workflow_restart_classifier")
    checklist = create_required_field_checklist(client, name="workflow_restart_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "restart_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text
    run_response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs",
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert run_response.status_code == 200, run_response.text
    run_id = run_response.json()["id"]
    failed_run = client.get(f"/api/workflow-runs/{run_id}").json()
    assert failed_run["status"] == "completed_with_errors"
    assert failed_run["failed_count"] == 2
    document_ids = [item["document_id"] for item in failed_run["items"]]

    monkeypatch.setattr("app.workflows._execute_graph_for_item_async", fake_success_execute)
    restarted = client.post(f"/api/workflow-runs/{run_id}/restart")
    assert restarted.status_code == 200, restarted.text
    restarted_id = restarted.json()["id"]
    assert restarted_id != run_id
    payload = client.get(f"/api/workflow-runs/{restarted_id}").json()
    assert payload["status"] == "completed"
    assert payload["restarted_from_run_id"] == run_id
    assert payload["uploaded_count"] == 2
    assert [item["document_id"] for item in payload["items"]] == document_ids
    assert {item["status"] for item in payload["items"]} == {"completed"}

    restarted_completed = client.post(f"/api/workflow-runs/{restarted_id}/restart")
    assert restarted_completed.status_code == 200, restarted_completed.text
    second_restart_id = restarted_completed.json()["id"]
    assert second_restart_id != restarted_id
    payload = client.get(f"/api/workflow-runs/{second_restart_id}").json()
    assert payload["status"] == "completed"
    assert [item["document_id"] for item in payload["items"]] == document_ids
    assert {item["status"] for item in payload["items"]} == {"completed"}


def test_workflow_run_uses_workflow_worker_limit_for_blocking_work(monkeypatch, mock_vlm, settings_env) -> None:
    from app.concurrency import run_workflow_blocking

    active = 0
    max_active = 0
    lock = threading.Lock()

    def blocking_work() -> None:
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.05)
        with lock:
            active -= 1

    async def fake_execute(item_id, document_id, filename, graph, execution_generation, page_number=None):
        await run_workflow_blocking(blocking_work)
        return {
            "document_id": document_id,
            "filename": filename,
            "status": "completed",
            "error_message": None,
            "branch_path": "class:contract",
            "path_node_ids": ["classifier"],
            "completed_node_ids": ["classifier"],
            "current_node_id": None,
            "current_node_kind": None,
            "current_node_label": None,
            "node_results": {},
            "classification": {"status": "classified", "class_name": "contract"},
            "kie_values": {},
            "required_overall_status": None,
            "required_items": {},
        }

    monkeypatch.setattr("app.workflows._execute_graph_for_item_async", fake_execute)
    settings_env(WORKFLOW_MAX_WORKERS="2", VLM_MAX_CONCURRENT_REQUESTS="8")
    with get_client() as client:
        schema = create_schema(client, name="workflow_parallel_schema")
        classifier = create_document_classifier(client, name="workflow_parallel_classifier")
        checklist = create_required_field_checklist(client, name="workflow_parallel_checklist")
        workflow = client.post(
            "/api/workflows",
            json={"name": "parallel_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
        )
        assert workflow.status_code == 200, workflow.text
        run_response = client.post(
            f"/api/workflows/{workflow.json()['id']}/runs",
            files=[("files", (f"doc_{index}.png", ONE_BY_ONE_PNG, "image/png")) for index in range(4)],
        )
        assert run_response.status_code == 200, run_response.text
        run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
        assert run["status"] == "completed"
        assert max_active == 2


def test_workflow_async_scheduler_does_not_backlog_paused_run(monkeypatch, settings_env) -> None:
    from app import workflows as workflows_module
    from app.core.db import SessionLocal
    from app.core.migrations import upgrade_database
    from app.models import WorkflowDefinition

    definition = {
        "nodes": [
            {"id": "input", "data": {"kind": "input", "label": "Input"}},
            {"id": "export", "data": {"kind": "export", "label": "Export"}},
        ],
        "edges": [{"id": "input-export", "source": "input", "target": "export"}],
    }

    upgrade_database()
    db = SessionLocal()
    try:
        workflow = WorkflowDefinition(
            name=f"pause_backlog_workflow_{time.time_ns()}",
            definition_json=definition,
        )
        db.add(workflow)
        db.flush()
        run = WorkflowRun(
            workflow_id=workflow.id,
            workflow_name=workflow.name,
            workflow_definition_json=definition,
            status="queued",
            total_count=6,
            execution_generation=1,
        )
        db.add(run)
        db.flush()
        for index in range(6):
            document = Document(
                filename=f"pause_backlog_{index}.png",
                mime_type="image/png",
                size_bytes=1,
                page_count=1,
                storage_path=f"/tmp/pause_backlog_{index}.png",
                status="ready",
            )
            db.add(document)
            db.flush()
            db.add(
                WorkflowRunItem(
                    run_id=run.id,
                    document_id=document.id,
                    filename=document.filename,
                    upload_index=index,
                    status="queued",
                    execution_generation=1,
                )
            )
        db.commit()
        run_id = run.id
    finally:
        db.close()

    started: list[str] = []
    release: asyncio.Event | None = None

    async def fake_execute_graph(
        _item_id: str,
        _document_id: str,
        filename: str,
        _graph,
        _execution_generation: int,
        _page_number: int | None = None,
    ) -> dict[str, Any]:
        started.append(filename)
        assert release is not None
        await release.wait()
        return {
            "document_id": _document_id,
            "filename": filename,
            "status": "completed",
            "error_message": None,
            "branch_path": None,
            "path_node_ids": ["export"],
            "completed_node_ids": ["export"],
            "current_node_id": None,
            "current_node_kind": None,
            "current_node_label": None,
            "node_results": {},
            "classification": None,
            "kie_values": {},
            "required_overall_status": None,
            "required_items": {},
        }

    monkeypatch.setattr(workflows_module, "_execute_graph_for_item_async", fake_execute_graph)

    async def run_and_pause() -> None:
        nonlocal release
        release = asyncio.Event()
        task = asyncio.create_task(workflows_module.run_workflow_run_async(run_id, 1))
        for _ in range(100):
            if len(started) >= 2:
                break
            await asyncio.sleep(0.01)
        assert len(started) == 2
        await asyncio.sleep(0.03)
        assert len(started) == 2

        pause_db = SessionLocal()
        try:
            paused_run = pause_db.get(WorkflowRun, run_id)
            assert paused_run is not None
            paused_run.status = "paused"
            paused_run.execution_generation = 2
            now = datetime.utcnow()
            for item in paused_run.items:
                if item.status in {"queued", "running"}:
                    item.status = "paused"
                    item.error_message = "Paused by test"
                    item.completed_at = now
            pause_db.commit()
        finally:
            pause_db.close()

        release.set()
        await asyncio.wait_for(task, timeout=3)
        assert len(started) == 2

    settings_env(WORKFLOW_MAX_WORKERS="2")
    asyncio.run(run_and_pause())

    db = SessionLocal()
    try:
        paused_run = db.get(WorkflowRun, run_id)
        assert paused_run is not None
        assert paused_run.status == "paused"
        assert all(item.status == "paused" for item in paused_run.items)
    finally:
        db.close()


def test_workflow_parallel_item_failure_does_not_stop_other_items(monkeypatch, mock_vlm, settings_env) -> None:
    async def fake_execute(item_id, document_id, filename, graph, execution_generation, page_number=None):
        if filename == "doc_1.png":
            raise RuntimeError("synthetic workflow failure")
        return {
            "document_id": document_id,
            "filename": filename,
            "status": "completed",
            "error_message": None,
            "branch_path": "class:contract",
            "path_node_ids": ["classifier"],
            "completed_node_ids": ["classifier"],
            "current_node_id": None,
            "current_node_kind": None,
            "current_node_label": None,
            "node_results": {},
            "classification": {"status": "classified", "class_name": "contract"},
            "kie_values": {},
            "required_overall_status": None,
            "required_items": {},
        }

    monkeypatch.setattr("app.workflows._execute_graph_for_item_async", fake_execute)
    settings_env(VLM_MAX_CONCURRENT_REQUESTS="3")
    with get_client() as client:
        schema = create_schema(client, name="workflow_failure_schema")
        classifier = create_document_classifier(client, name="workflow_failure_classifier")
        checklist = create_required_field_checklist(client, name="workflow_failure_checklist")
        workflow = client.post(
            "/api/workflows",
            json={"name": "parallel_failure", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
        )
        assert workflow.status_code == 200, workflow.text
        run_response = client.post(
            f"/api/workflows/{workflow.json()['id']}/runs",
            files=[("files", (f"doc_{index}.png", ONE_BY_ONE_PNG, "image/png")) for index in range(3)],
        )
        assert run_response.status_code == 200, run_response.text
        run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
        statuses = {item["filename"]: item["status"] for item in run["items"]}
        assert run["status"] == "completed_with_errors"
        assert statuses["doc_1.png"] == "failed"
        assert statuses["doc_0.png"] == "completed"
        assert statuses["doc_2.png"] == "completed"


def test_workflow_retry_failed_items_requeues_only_failures(monkeypatch, mock_vlm, settings_env) -> None:
    attempts: dict[str, int] = {}

    async def fake_execute(item_id, document_id, filename, graph, execution_generation, page_number=None):
        attempts[filename] = attempts.get(filename, 0) + 1
        if filename == "doc_1.png" and attempts[filename] == 1:
            raise RuntimeError("synthetic transient failure")
        return {
            "document_id": document_id,
            "filename": filename,
            "status": "completed",
            "error_message": None,
            "branch_path": "class:contract",
            "path_node_ids": ["classifier"],
            "completed_node_ids": ["classifier"],
            "current_node_id": None,
            "current_node_kind": None,
            "current_node_label": None,
            "node_results": {},
            "classification": {"status": "classified", "class_name": "contract"},
            "kie_values": {},
            "required_overall_status": None,
            "required_items": {},
        }

    monkeypatch.setattr("app.workflows._execute_graph_for_item_async", fake_execute)
    settings_env(VLM_MAX_CONCURRENT_REQUESTS="2")
    with get_client() as client:
        schema = create_schema(client, name="workflow_retry_schema")
        classifier = create_document_classifier(client, name="workflow_retry_classifier")
        checklist = create_required_field_checklist(client, name="workflow_retry_checklist")
        workflow = client.post(
            "/api/workflows",
            json={"name": "retry_failed_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
        )
        assert workflow.status_code == 200, workflow.text
        run_response = client.post(
            f"/api/workflows/{workflow.json()['id']}/runs",
            files=[("files", (f"doc_{index}.png", ONE_BY_ONE_PNG, "image/png")) for index in range(2)],
        )
        assert run_response.status_code == 200, run_response.text
        run = client.get(f"/api/workflow-runs/{run_response.json()['id']}").json()
        assert run["status"] == "completed_with_errors"
        assert run["failed_count"] == 1

        retry = client.post(f"/api/workflow-runs/{run['id']}/retry-failed")
        assert retry.status_code == 200, retry.text
        retried = client.get(f"/api/workflow-runs/{run['id']}").json()
        assert retried["status"] == "completed"
        assert retried["completed_count"] == 2
        assert retried["failed_count"] == 0
        assert attempts == {"doc_0.png": 1, "doc_1.png": 2}
