"""Page-level units of work (refactor plan §8.1): every job / batch item / run item covers one page."""

import io
import threading
from typing import Any

from app.core.db import SessionLocal
from app.models import ClassificationJob, Document, WorkflowRunItem
from tests.support.api import (
    create_document_classifier,
    create_required_field_checklist,
    create_schema,
    workflow_definition,
)

try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover - compatibility for older PyMuPDF installs
    import fitz


def make_multipage_pdf(page_count: int = 3) -> bytes:
    document = fitz.open()
    for index in range(page_count):
        page = document.new_page(width=240, height=160)
        page.insert_text((24, 60), f"Page {index + 1} of a mixed bundle")
    buffer = io.BytesIO()
    document.save(buffer)
    document.close()
    return buffer.getvalue()


def upload_pdf(client, filename: str = "bundle.pdf", page_count: int = 3) -> dict[str, Any]:
    response = client.post("/api/documents", files={"file": (filename, make_multipage_pdf(page_count), "application/pdf")})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["page_count"] == page_count
    return payload


class Recorder:
    """Thread-safe record of the images each VLM call received."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.calls: list[list[str]] = []

    def add(self, images: list[str]) -> None:
        with self.lock:
            self.calls.append(images)


def _classify_recorder(recorder: Recorder):
    def classify(classes, allow_unknown, image_paths):
        recorder.add([str(path) for path in image_paths])
        return {"status": "classified", "class_name": "contract", "confidence": 0.9, "reason": "seen", "evidence": []}

    return classify


def _set_document_status(document_id: str, status: str) -> None:
    db = SessionLocal()
    try:
        document = db.get(Document, document_id)
        document.status = status
        db.commit()
    finally:
        db.close()


def test_classification_batch_from_multipage_document_runs_one_vlm_call_per_page(fake_vlm, client) -> None:
    recorder = Recorder()
    fake_vlm.set(classify_document=_classify_recorder(recorder))
    classifier = create_document_classifier(client)
    document = upload_pdf(client)

    response = client.post(
        "/api/classification-batches/from-documents",
        json={"classifier_id": classifier["id"], "document_ids": [document["document_id"]]},
    )
    assert response.status_code == 200, response.text
    created = response.json()
    assert created["total_count"] == 3
    assert [item["page_number"] for item in created["items"]] == [1, 2, 3]
    assert len({item["job_id"] for item in created["items"]}) == 3

    batch = client.get(f"/api/classification-batches/{created['id']}").json()
    assert batch["status"] == "completed"
    assert batch["completed_count"] == 3
    assert all(item["status"] == "completed" for item in batch["items"])

    assert len(recorder.calls) == 3
    assert all(len(images) == 1 for images in recorder.calls)
    page_images = {page["page"]: page for page in document["pages"]}
    assert len({images[0] for images in recorder.calls}) == 3
    assert len(page_images) == 3

    summary = client.get(f"/api/classification-batches/{created['id']}/summary").json()
    assert (summary["total_count"], summary["completed_count"], summary["items"]) == (3, 3, [])

    for item in batch["items"]:
        job = client.get(f"/api/classification-jobs/{item['job_id']}").json()
        assert job["page_number"] == item["page_number"]

    header = client.get(f"/api/classification-batches/{created['id']}/export?format=csv").text.splitlines()[0]
    assert header.lstrip("﻿").startswith("filename,page_number,document_id,job_id")
    rows = client.get(f"/api/classification-batches/{created['id']}/export?format=json").json()["rows"]
    assert [row["page_number"] for row in rows] == [1, 2, 3]


def test_required_check_batch_sends_only_the_items_page(fake_vlm, client) -> None:
    calls: list[dict[str, Any]] = []
    lock = threading.Lock()

    def check(items, regions, image_paths=None, image_inputs=None):
        with lock:
            calls.append({"items": [item.item_name for item in items], "regions": [region.id for region in regions], "inputs": image_inputs})
        return {"items": [{"item_name": item.item_name, "status": "present", "confidence": 0.9, "evidence": "ok"} for item in items]}

    fake_vlm.set(check_required_fields=check)
    checklist = create_required_field_checklist(client)  # "서명" sits in a region on page 1
    document = upload_pdf(client)

    response = client.post(
        "/api/required-field-check-batches/from-documents",
        json={"checklist_id": checklist["id"], "document_ids": [document["document_id"]]},
    )
    assert response.status_code == 200, response.text
    batch = client.get(f"/api/required-field-check-batches/{response.json()['id']}").json()
    assert batch["total_count"] == 3
    assert [item["page_number"] for item in batch["items"]] == [1, 2, 3]
    assert batch["status"] == "completed", batch

    full_page_calls = [call for call in calls if not call["regions"]]
    region_calls = [call for call in calls if call["regions"]]
    assert len(full_page_calls) == 3
    assert all(len(call["inputs"]) == 1 for call in full_page_calls)
    assert sorted(call["inputs"][0]["label"] for call in full_page_calls) == sorted(
        {call["inputs"][0]["label"] for call in full_page_calls}
    )
    # The region lives on page 1, so only page 1 checks it.
    assert len(region_calls) == 1
    assert region_calls[0]["items"] == ["서명"]

    results = {
        item["page_number"]: client.get(f"/api/required-field-check-jobs/{item['job_id']}").json()["result"]["validated_output"]
        for item in batch["items"]
    }
    assert {entry["item_name"] for entry in results[1]["items"]} == {"성명", "서명", "체크박스"}
    assert {entry["item_name"] for entry in results[2]["items"]} == {"성명", "체크박스"}

    rows = client.get(f"/api/required-field-check-batches/{batch['id']}/export?format=json").json()["rows"]
    assert [row["page_number"] for row in rows] == [1, 2, 3]


def test_kie_batch_extracts_each_page_separately(fake_vlm, client) -> None:
    calls: list[list[dict[str, str]]] = []
    lock = threading.Lock()

    def extract(fields, image_paths=None, image_inputs=None):
        with lock:
            calls.append(list(image_inputs or []))
        return {field.key_name: {"value": "x", "confidence": 0.9, "evidence": "e", "page": 1} for field in fields}

    fake_vlm.set(extract=extract)
    schema = create_schema(client)
    document = upload_pdf(client)

    response = client.post("/api/batches/from-documents", json={"schema_id": schema["id"], "document_ids": [document["document_id"]]})
    assert response.status_code == 200, response.text
    batch = client.get(f"/api/batches/{response.json()['id']}").json()
    assert batch["total_count"] == 3
    assert [item["page_number"] for item in batch["items"]] == [1, 2, 3]
    assert {item["status"] for item in batch["items"]} <= {"completed", "needs_review"}
    assert len(calls) == 3
    assert all(len(inputs) == 1 for inputs in calls)
    assert sorted(inputs[0]["label"].split(".")[0] for inputs in calls) == [
        "Full document page 1",
        "Full document page 2",
        "Full document page 3",
    ]
    for item in batch["items"]:
        job = client.get(f"/api/extraction-jobs/{item['job_id']}").json()
        assert job["page_number"] == item["page_number"]
    header = client.get(f"/api/batches/{batch['id']}/export?format=csv").text.splitlines()[0]
    assert header.lstrip("﻿").startswith("filename,page_number,document_id")


def test_single_job_endpoints_are_page_aware(fake_vlm, client) -> None:
    recorder = Recorder()
    fake_vlm.set(classify_document=_classify_recorder(recorder))
    classifier = create_document_classifier(client)
    document = upload_pdf(client)

    # page_number omitted on a multi-page document: one job per page, response = page 1 + page_jobs.
    response = client.post("/api/classification-jobs", json={"document_id": document["document_id"], "classifier_id": classifier["id"]})
    assert response.status_code == 200, response.text
    created = response.json()
    assert created["page_number"] == 1
    assert [entry["page_number"] for entry in created["page_jobs"]] == [1, 2, 3]
    for entry in created["page_jobs"]:
        job = client.get(f"/api/classification-jobs/{entry['job_id']}").json()
        assert job["status"] == "completed"
        assert job["page_number"] == entry["page_number"]
    assert len(recorder.calls) == 3 and all(len(images) == 1 for images in recorder.calls)

    # explicit page
    response = client.post(
        "/api/classification-jobs",
        json={"document_id": document["document_id"], "classifier_id": classifier["id"], "page_number": 2},
    )
    assert response.status_code == 200, response.text
    assert response.json()["page_number"] == 2
    assert response.json()["page_jobs"] == []

    missing = client.post(
        "/api/classification-jobs",
        json={"document_id": document["document_id"], "classifier_id": classifier["id"], "page_number": 9},
    )
    assert missing.status_code == 422, missing.text

    # KIE single run (KeyInfoWorkspace): page_number selects the page the regions were drawn on.
    schema = create_schema(client)
    kie = client.post("/api/extraction-jobs", json={"document_id": document["document_id"], "schema_id": schema["id"], "page_number": 3})
    assert kie.status_code == 200, kie.text
    assert kie.json()["page_number"] == 3


def test_workflow_run_from_multipage_document_has_one_item_per_page(mock_vlm, fake_vlm, client) -> None:
    recorder = Recorder()
    fake_vlm.set(classify_document=_classify_recorder(recorder))
    schema = create_schema(client, name="page_workflow_schema")
    classifier = create_document_classifier(client, name="page_workflow_classifier")
    checklist = create_required_field_checklist(client, name="page_workflow_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "page_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    assert workflow.status_code == 200, workflow.text
    document = upload_pdf(client)

    response = client.post(
        f"/api/workflows/{workflow.json()['id']}/runs/from-documents",
        json={"document_ids": [document["document_id"]]},
    )
    assert response.status_code == 200, response.text
    run = client.get(f"/api/workflow-runs/{response.json()['id']}").json()
    assert run["total_count"] == 3
    assert [item["page_number"] for item in run["items"]] == [1, 2, 3]
    assert run["status"] in {"completed", "needs_review"}, run
    assert all(item["result"]["page_number"] == item["page_number"] for item in run["items"])
    assert len(recorder.calls) == 3 and all(len(images) == 1 for images in recorder.calls)

    summary = client.get(f"/api/workflow-runs/{run['id']}/summary").json()
    assert summary["total_count"] == 3
    assert summary["completed_count"] + summary["needs_review_count"] == 3

    rows = client.get(f"/api/workflow-runs/{run['id']}/export?format=json").json()["rows"]
    assert [row["page_number"] for row in rows] == [1, 2, 3]
    header = client.get(f"/api/workflow-runs/{run['id']}/export?format=csv").text.splitlines()[0]
    assert header.lstrip("﻿").startswith("filename,page_number,document_id")

    restarted = client.post(f"/api/workflow-runs/{run['id']}/restart")
    assert restarted.status_code == 200, restarted.text
    restarted_run = client.get(f"/api/workflow-runs/{restarted.json()['id']}").json()
    assert restarted_run["total_count"] == 3
    assert [item["page_number"] for item in restarted_run["items"]] == [1, 2, 3]


def test_workflow_rotation_node_only_checks_the_items_page(mock_vlm, fake_vlm, client) -> None:
    detections: list[int] = []
    lock = threading.Lock()

    async def detect(_inputs):
        with lock:
            detections.append(1)
        return {"upright_candidate": "A", "confidence": 0.99, "reason": "upright"}

    fake_vlm.set(detect_page_orientation=detect)
    schema = create_schema(client, name="rotation_page_schema")
    definition = {
        "nodes": [
            {"id": "input", "data": {"kind": "input", "label": "Input"}},
            {"id": "rotation", "data": {"kind": "rotation", "label": "회전 보정", "config": {}}},
            {"id": "kie", "data": {"kind": "kie", "label": "KIE", "config": {"schema_id": schema["id"]}}},
            {"id": "export", "data": {"kind": "export", "label": "Export"}},
        ],
        "edges": [
            {"id": "e1", "source": "input", "target": "rotation"},
            {"id": "e2", "source": "rotation", "target": "kie"},
            {"id": "e3", "source": "kie", "target": "export"},
        ],
    }
    workflow = client.post("/api/workflows", json={"name": "rotation_pages", "definition": definition})
    assert workflow.status_code == 200, workflow.text
    document = upload_pdf(client)
    response = client.post(f"/api/workflows/{workflow.json()['id']}/runs/from-documents", json={"document_ids": [document["document_id"]]})
    assert response.status_code == 200, response.text
    run = client.get(f"/api/workflow-runs/{response.json()['id']}").json()
    assert len(run["items"]) == 3
    for item in run["items"]:
        pages = item["result"]["node_results"]["rotation"]["pages"]
        assert [page["page_number"] for page in pages] == [item["page_number"]]
    assert len(detections) == 3


def test_waiting_documents_expand_into_pages_when_ready(mock_vlm, fake_vlm, client) -> None:
    from app.infra.jobs.conversion import activate_ready_document_waiters

    recorder = Recorder()
    fake_vlm.set(classify_document=_classify_recorder(recorder))
    classifier = create_document_classifier(client)
    schema = create_schema(client, name="waiting_schema")
    checklist = create_required_field_checklist(client, name="waiting_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "waiting_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    )
    document = upload_pdf(client)
    document_id = document["document_id"]
    _set_document_status(document_id, "preprocessing")  # still converting: pages are not known yet

    batch = client.post(
        "/api/classification-batches/from-documents",
        json={"classifier_id": classifier["id"], "document_ids": [document_id]},
    ).json()
    assert batch["total_count"] == 1
    assert [(item["page_number"], item["status"]) for item in batch["items"]] == [(None, "waiting_for_document")]
    assert client.get(f"/api/classification-batches/{batch['id']}/summary").json()["preprocessing_count"] == 1

    single = client.post("/api/classification-jobs", json={"document_id": document_id, "classifier_id": classifier["id"]}).json()
    assert (single["page_number"], single["status"]) == (None, "waiting_for_document")

    run = client.post(f"/api/workflows/{workflow.json()['id']}/runs/from-documents", json={"document_ids": [document_id]}).json()
    assert run["total_count"] == 1
    assert run["items"][0]["status"] == "waiting_for_document"

    _set_document_status(document_id, "ready")
    activate_ready_document_waiters(document_id)  # queues the work; the inline test runtime runs it

    expanded = client.get(f"/api/classification-batches/{batch['id']}").json()
    assert expanded["total_count"] == 3
    assert [item["page_number"] for item in expanded["items"]] == [1, 2, 3]
    assert expanded["status"] == "completed", expanded
    assert expanded["completed_count"] == 3

    db = SessionLocal()
    try:
        standalone = (
            db.query(ClassificationJob)
            .filter(ClassificationJob.document_id == document_id, ClassificationJob.classifier_id == classifier["id"])
            .all()
        )
        batch_job_ids = {item["job_id"] for item in expanded["items"]}
        # The single job expanded into pages 1..3 and the workflow run's classifier node ran pages 1..3.
        other_pages = sorted(job.page_number for job in standalone if job.id not in batch_job_ids and job.status == "completed")
        assert other_pages == [1, 1, 2, 2, 3, 3]
        assert db.get(ClassificationJob, single["job_id"]).page_number == 1
        run_items = db.query(WorkflowRunItem).filter(WorkflowRunItem.run_id == run["id"]).all()
        assert sorted(item.page_number for item in run_items) == [1, 2, 3]
    finally:
        db.close()

    finished_run = client.get(f"/api/workflow-runs/{run['id']}").json()
    assert finished_run["total_count"] == 3
    assert finished_run["status"] in {"completed", "needs_review"}, [(i["page_number"], i["status"], i["error_message"]) for i in finished_run["items"]]
    assert all(len(images) == 1 for images in recorder.calls)


def test_upload_batch_expands_multipage_files(fake_vlm, client) -> None:
    recorder = Recorder()
    fake_vlm.set(classify_document=_classify_recorder(recorder))
    classifier = create_document_classifier(client)
    init = client.post("/api/classification-batches/init", json={"classifier_id": classifier["id"], "total_count": 2})
    assert init.status_code == 200, init.text
    batch_id = init.json()["id"]
    first = client.post(
        f"/api/classification-batches/{batch_id}/items",
        data={"client_file_ids": "f0", "upload_indexes": "0"},
        files=[("files", ("bundle.pdf", make_multipage_pdf(3), "application/pdf"))],
    )
    assert first.status_code == 200, first.text
    partial = first.json()
    # 1 of 2 files uploaded; the 3-page file already counts as 3 units, so 1 unit is still missing.
    assert (partial["total_count"], partial["uploaded_count"], partial["status"]) == (4, 3, "uploading")
    second = client.post(
        f"/api/classification-batches/{batch_id}/items",
        data={"client_file_ids": "f1", "upload_indexes": "1"},
        files=[("files", ("single.pdf", make_multipage_pdf(1), "application/pdf"))],
    )
    assert second.status_code == 200, second.text
    started = client.post(f"/api/classification-batches/{batch_id}/start")
    assert started.status_code == 200, started.text
    batch = client.get(f"/api/classification-batches/{batch_id}").json()
    assert [(item["filename"], item["page_number"]) for item in batch["items"]] == [
        ("bundle.pdf", 1),
        ("bundle.pdf", 2),
        ("bundle.pdf", 3),
        ("single.pdf", 1),
    ]
    assert batch["status"] == "completed"
    assert len(recorder.calls) == 4


def test_raw_extraction_accepts_library_document_id(client) -> None:
    document = upload_pdf(client, page_count=2)
    by_form = client.post("/api/raw-extractions", data={"document_id": document["document_id"]})
    assert by_form.status_code == 200, by_form.text
    assert by_form.json()["status"] == "completed"
    assert by_form.json()["filename"] == "bundle.pdf"

    by_json = client.post("/api/raw-extractions", json={"document_id": document["document_id"], "include_images": False})
    assert by_json.status_code == 200, by_json.text
    assert by_json.json()["status"] == "completed"

    assert client.post("/api/raw-extractions", data={}).status_code == 422
    assert client.post("/api/raw-extractions", json={"document_id": "doc_missing"}).status_code == 404
