import asyncio
import threading
import time
from typing import Any

import pytest

from app.models import (
    Batch,
    ClassificationBatch,
    RequiredFieldCheckBatch,
)
from tests.conftest import get_client
from tests.support.api import (
    ONE_BY_ONE_PNG,
    assert_xlsx_response,
    create_schema,
)


def test_batch_upload_rejects_too_many_files(settings_env) -> None:
    settings_env(UPLOAD_MAX_BATCH_FILES="1")
    with get_client() as client:
        schema = create_schema(client, "batch_limit_schema")
        response = client.post(
            "/api/batches",
            data={"schema_id": schema["id"]},
            files=[
                ("files", ("a.png", ONE_BY_ONE_PNG, "image/png")),
                ("files", ("b.png", ONE_BY_ONE_PNG, "image/png")),
            ],
        )
        assert response.status_code == 413


def test_large_batch_multipart_allows_configured_counts_above_parser_default(settings_env) -> None:
    settings_env(UPLOAD_MAX_BATCH_FILES="10000")
    with get_client() as client:
        files = [("files", (f"document_{index:04d}.png", ONE_BY_ONE_PNG, "image/png")) for index in range(1001)]
        response = client.post(
            "/api/classification-batches",
            data={"classifier_id": "missing"},
            files=files,
        )
        assert response.status_code == 404, response.text
        assert response.json()["detail"] == "Document classifier not found"


def test_large_batch_multipart_returns_413_over_configured_limit(settings_env) -> None:
    settings_env(UPLOAD_MAX_BATCH_FILES="1001")
    with get_client() as client:
        files = [("files", (f"document_{index:04d}.png", ONE_BY_ONE_PNG, "image/png")) for index in range(1002)]
        response = client.post(
            "/api/classification-batches",
            data={"classifier_id": "missing"},
            files=files,
        )
        assert response.status_code == 413, response.text
        assert "1001" in response.json()["detail"]


def test_extraction_batch_workers_use_workflow_worker_limit(monkeypatch, settings_env) -> None:
    from app import extraction as extraction_module
    from app.concurrency import run_workflow_blocking

    active = 0
    max_active = 0
    finalized: list[str] = []
    lock = threading.Lock()

    def blocking_work(_job_id: str) -> None:
        nonlocal active, max_active
        with lock:
            active += 1
            max_active = max(max_active, active)
        time.sleep(0.03)
        with lock:
            active -= 1

    async def fake_run_job(job_id: str) -> None:
        await run_workflow_blocking(blocking_work, job_id)

    settings_env(WORKFLOW_MAX_WORKERS="2")
    monkeypatch.setattr(extraction_module, "run_extraction_job_async", fake_run_job)
    monkeypatch.setattr(extraction_module, "_finalize_batch", lambda batch_id: finalized.append(batch_id))
    asyncio.run(extraction_module.run_batch_jobs_async("batch_1", ["job_1", "job_2", "job_3", "job_4"]))
    assert max_active == 2
    assert finalized == ["batch_1"]


def test_extraction_batch_async_workers_use_workflow_worker_limit(monkeypatch, settings_env) -> None:
    from app import extraction as extraction_module

    active = 0
    max_active = 0
    finalized: list[str] = []

    async def fake_run_job(_job_id: str) -> None:
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.01)
        active -= 1

    settings_env(WORKFLOW_MAX_WORKERS="2")
    monkeypatch.setattr(extraction_module, "run_extraction_job_async", fake_run_job)
    monkeypatch.setattr(extraction_module, "_finalize_batch", lambda batch_id: finalized.append(batch_id))
    asyncio.run(extraction_module.run_batch_jobs_async("batch_1", ["job_1", "job_2", "job_3", "job_4"]))
    assert max_active == 2
    assert finalized == ["batch_1"]


def test_batch_cancel_marks_queued_jobs_canceled(job_runners, client) -> None:
    job_runners.set(extraction_batch=lambda batch_id, job_ids: None)

    schema = create_schema(client)
    response = client.post(
        "/api/batches",
        data={"schema_id": schema["id"]},
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert response.status_code == 200, response.text
    batch = response.json()
    assert batch["status"] == "running"
    assert batch["progress"] == 0

    canceled = client.post(f"/api/batches/{batch['id']}/cancel")
    assert canceled.status_code == 200, canceled.text
    payload = canceled.json()
    assert payload["status"] == "canceled"
    assert payload["canceled_count"] == 2
    assert payload["progress"] == 1
    assert payload["completed_at"] is not None
    assert {item["status"] for item in payload["items"]} == {"canceled"}


def test_batch_init_items_start_flow(job_runners, client) -> None:
    job_runners.set(extraction_batch=lambda batch_id, job_ids: None)

    schema = create_schema(client)
    initialized = client.post("/api/batches/init", json={"schema_id": schema["id"], "total_count": 2})
    assert initialized.status_code == 200, initialized.text
    batch = initialized.json()
    assert batch["status"] == "uploading"
    assert batch["uploaded_count"] == 0

    early_start = client.post(f"/api/batches/{batch['id']}/start")
    assert early_start.status_code == 422
    assert early_start.json()["detail"]["uploaded_count"] == 0

    partial = client.post(
        f"/api/batches/{batch['id']}/items",
        data={"client_file_ids": ["0:first.png:1:1"]},
        files=[("files", ("first.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert partial.status_code == 200, partial.text
    partial_resume = client.post(f"/api/batches/{batch['id']}/resume")
    assert partial_resume.status_code == 422, partial_resume.text
    assert partial_resume.json()["detail"]["uploaded_count"] == 1
    assert partial_resume.json()["detail"]["total_count"] == 2

    appended = client.post(
        f"/api/batches/{batch['id']}/items",
        data={"client_file_ids": ["1:second.png:1:1"]},
        files=[("files", ("second.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert appended.status_code == 200, appended.text
    payload = appended.json()
    assert payload["uploaded_count"] == 2
    assert payload["queued_count"] == 2
    assert payload["preprocessing_count"] == 0

    summary = client.get(f"/api/batches/{batch['id']}/summary")
    assert summary.status_code == 200
    assert summary.json()["items"] == []
    assert summary.json()["queued_count"] == 2

    started = client.post(f"/api/batches/{batch['id']}/start")
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "running"


def test_batch_export_csv_and_json_mock_mode(mock_vlm, client) -> None:
    schema = create_schema(client)
    response = client.post(
        "/api/batches",
        data={"schema_id": schema["id"]},
        files=[
            ("files", ("z_last.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("a_first.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert response.status_code == 200, response.text
    batch = response.json()
    assert [item["filename"] for item in batch["items"]] == ["a_first.png", "z_last.png"]

    csv_response = client.get(f"/api/batches/{batch['id']}/export?format=csv")
    assert csv_response.status_code == 200, csv_response.text
    assert csv_response.content.startswith(b"\xef\xbb\xbf")
    assert "charset=utf-8" in csv_response.headers["content-type"]
    csv_text = csv_response.text
    header = csv_text.splitlines()[0]
    assert "filename,page_number,document_id,job_id,status,error_message,invoice_number" in header
    assert "invoice_number_original" in header
    assert "invoice_number_ai_review_status" in header
    assert "total_amount_ai_corrected" in header
    assert "a_first.png" in csv_text
    assert "Sample invoice_number" in csv_text
    assert csv_text.index("a_first.png") < csv_text.index("z_last.png")

    json_response = client.get(f"/api/batches/{batch['id']}/export?format=json")
    assert json_response.status_code == 200, json_response.text
    payload = json_response.json()
    assert payload["batch_id"] == batch["id"]
    assert len(payload["rows"]) == 2
    assert [row["filename"] for row in payload["rows"]] == ["a_first.png", "z_last.png"]
    assert payload["rows"][0]["invoice_number"] == "Sample invoice_number"

    xlsx_response = client.get(f"/api/batches/{batch['id']}/export?format=xlsx")
    assert_xlsx_response(xlsx_response)


def test_batch_finalizes_after_mock_jobs(mock_vlm, client) -> None:
    schema = create_schema(client)
    response = client.post(
        "/api/batches",
        data={"schema_id": schema["id"]},
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert response.status_code == 200, response.text
    batch = response.json()

    loaded = client.get(f"/api/batches/{batch['id']}")
    assert loaded.status_code == 200, loaded.text
    payload = loaded.json()
    assert payload["status"] == "completed"
    assert payload["progress"] == 1
    assert payload["completed_count"] == 2
    assert payload["completed_at"] is not None


def test_batch_high_concurrent_request_count_does_not_exhaust_db_pool(mock_vlm, settings_env) -> None:
    settings_env(VLM_MAX_CONCURRENT_REQUESTS="16")
    with get_client() as client:
        schema = create_schema(client)
        response = client.post(
            "/api/batches",
            data={"schema_id": schema["id"]},
            files=[("files", (f"batch_{index}.png", ONE_BY_ONE_PNG, "image/png")) for index in range(20)],
        )
        assert response.status_code == 200, response.text
        batch = response.json()

        loaded = client.get(f"/api/batches/{batch['id']}")
        assert loaded.status_code == 200, loaded.text
        payload = loaded.json()
        assert payload["status"] == "completed"
        assert payload["completed_count"] == 20
        assert payload["failed_count"] == 0

        recent = client.get("/api/batches?limit=12")
        assert recent.status_code == 200, recent.text


@pytest.mark.parametrize(
    "case",
    [
        {
            "owner_model": Batch,
            "item_model_name": "BatchItem",
            "job_model_name": "ExtractionJob",
            "owner_kwargs": {"schema_id": "schema_summary_polling", "schema_version": 1},
            "item_owner_field": "batch_id",
            "job_kwargs": {"schema_id": "schema_summary_polling", "schema_version": 1},
            "summary_path": "/api/batches/{id}/summary",
            "list_path": "/api/batches?limit=100&include_items=false",
            "item_table": "batch_items",
        },
        {
            "owner_model": ClassificationBatch,
            "item_model_name": "ClassificationBatchItem",
            "job_model_name": "ClassificationJob",
            "owner_kwargs": {"classifier_id": "classifier_summary_polling"},
            "item_owner_field": "batch_id",
            "job_kwargs": {"classifier_id": "classifier_summary_polling"},
            "summary_path": "/api/classification-batches/{id}/summary",
            "list_path": "/api/classification-batches?limit=100&include_items=false",
            "item_table": "classification_batch_items",
        },
        {
            "owner_model": RequiredFieldCheckBatch,
            "item_model_name": "RequiredFieldCheckBatchItem",
            "job_model_name": "RequiredFieldCheckJob",
            "owner_kwargs": {"checklist_id": "checklist_summary_polling"},
            "item_owner_field": "batch_id",
            "job_kwargs": {"checklist_id": "checklist_summary_polling"},
            "summary_path": "/api/required-field-check-batches/{id}/summary",
            "list_path": "/api/required-field-check-batches?limit=100&include_items=false",
            "item_table": "required_field_check_batch_items",
        },
    ],
)
def test_module_batch_summary_and_light_list_use_aggregate_counts(case: dict[str, Any]) -> None:
    from sqlalchemy import event

    from app import models as model_module
    from app.core.db import SessionLocal, engine
    from app.core.migrations import upgrade_database

    upgrade_database()
    item_model = getattr(model_module, case["item_model_name"])
    job_model = getattr(model_module, case["job_model_name"])
    statuses = ["completed", "needs_review", "failed", "canceled", "running", "waiting_for_document"]

    db = SessionLocal()
    try:
        owner = case["owner_model"](status="running", total_count=len(statuses), **case["owner_kwargs"])
        db.add(owner)
        db.flush()
        for index, status in enumerate(statuses):
            job = job_model(
                document_id=f"doc_module_summary_{case['item_table']}_{index}",
                status=status,
                error_message="failed by test" if status == "failed" else None,
                **case["job_kwargs"],
            )
            db.add(job)
            db.flush()
            db.add(
                item_model(
                    **{case["item_owner_field"]: owner.id},
                    document_id=job.document_id,
                    job_id=job.id,
                    filename=f"module_summary_{index}.png",
                    upload_index=index,
                    client_file_id=f"test:{index}",
                )
            )
        db.commit()
        owner_id = owner.id
    finally:
        db.close()

    item_queries: list[str] = []

    def capture_item_queries(_conn, _cursor, statement, _parameters, _context, _executemany) -> None:
        normalized = " ".join(statement.lower().split())
        if normalized.startswith("select") and case["item_table"] in normalized:
            item_queries.append(normalized)

    event.listen(engine, "before_cursor_execute", capture_item_queries)
    try:
        with get_client() as client:
            summary_response = client.get(case["summary_path"].format(id=owner_id))
            list_response = client.get(case["list_path"])
    finally:
        event.remove(engine, "before_cursor_execute", capture_item_queries)

    assert summary_response.status_code == 200, summary_response.text
    summary = summary_response.json()
    assert summary["items"] == []
    assert summary["uploaded_count"] == 6
    assert summary["completed_count"] == 2
    assert summary["needs_review_count"] == 1
    assert summary["failed_count"] == 1
    assert summary["canceled_count"] == 1
    assert summary["running_count"] == 1
    assert summary["preprocessing_count"] == 1
    assert summary["progress"] == 4 / 6

    assert list_response.status_code == 200, list_response.text
    listed = next(item for item in list_response.json() if item["id"] == owner_id)
    assert listed["items"] == []
    assert listed["failed_count"] == 1

    assert item_queries
    assert all("count" in query and "group by" in query for query in item_queries)
    assert all("filename" not in query and "client_file_id" not in query for query in item_queries)


def test_batch_worker_exception_does_not_leave_batch_running(monkeypatch, mock_vlm, job_runners, client) -> None:
    from app import extraction as extraction_module

    job_runners.set(extraction_batch=lambda batch_id, job_ids: None)

    schema = create_schema(client)
    response = client.post(
        "/api/batches",
        data={"schema_id": schema["id"]},
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert response.status_code == 200, response.text
    batch = response.json()
    job_ids = [item["job_id"] for item in batch["items"]]
    original_run_job = extraction_module.run_extraction_job_async

    async def flaky_run_job(job_id: str) -> None:
        if job_id == job_ids[0]:
            raise RuntimeError("worker boom")
        await original_run_job(job_id)

    monkeypatch.setattr(extraction_module, "run_extraction_job_async", flaky_run_job)
    asyncio.run(extraction_module.run_batch_jobs_async(batch["id"], job_ids))

    loaded = client.get(f"/api/batches/{batch['id']}")
    assert loaded.status_code == 200, loaded.text
    payload = loaded.json()
    assert payload["status"] == "completed_with_errors"
    assert payload["progress"] == 1
    assert payload["failed_count"] == 1
    assert payload["completed_count"] == 1
    assert {item["status"] for item in payload["items"]} == {"completed", "failed"}


def test_batch_cancel_also_cancels_jobs_waiting_for_document_conversion(job_runners, client) -> None:
    """KIE batch cancel uses the same rule as the other module batches: waiting jobs are canceled too."""
    from app.core.db import SessionLocal
    from app.models import Document

    job_runners.set(extraction_batch=lambda batch_id, job_ids: None)
    schema = create_schema(client)
    ready_document = client.post("/api/documents", files={"file": ("ready.png", ONE_BY_ONE_PNG, "image/png")}).json()
    db = SessionLocal()
    try:
        converting = Document(
            filename="converting.pdf",
            mime_type="application/pdf",
            size_bytes=1,
            page_count=0,
            storage_path="unused",
            status="preprocessing",
        )
        db.add(converting)
        db.commit()
        converting_id = converting.id
    finally:
        db.close()

    created = client.post(
        "/api/batches/from-documents",
        json={"schema_id": schema["id"], "document_ids": [ready_document["document_id"], converting_id]},
    )
    assert created.status_code == 200, created.text
    assert sorted(item["status"] for item in created.json()["items"]) == ["queued", "waiting_for_document"]

    canceled = client.post(f"/api/batches/{created.json()['id']}/cancel")
    assert canceled.status_code == 200, canceled.text
    payload = canceled.json()
    assert {item["status"] for item in payload["items"]} == {"canceled"}
    assert payload["canceled_count"] == 2
    assert payload["status"] == "canceled"
    assert payload["completed_at"] is not None
