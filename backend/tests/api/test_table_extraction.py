"""Table extraction module (표 추출): templates, jobs, reviewer edits, batches, recovery."""

import io
import threading
from typing import Any

from PIL import Image

from app.core.db import SessionLocal
from app.infra.jobs.recovery import INTERRUPTED_MESSAGE, recover_on_startup
from app.models import JobQueueEntry, TableExtractionJob
from app.storage import read_storage_bytes
from tests.api.test_page_level_processing import upload_pdf


def _table(key: str = "injection_rows", **overrides: Any) -> dict[str, Any]:
    table = {
        "key": key,
        "name": "주입 내역",
        "description": "수주처별 주입 기록, 한 행 = 한 제품",
        "columns": [
            {"key": "품명", "header_path": ["품명"]},
            {"key": "단중", "type": "number"},
            {"key": "실적", "type": "number"},
            {"key": "작업일", "type": "date"},
        ],
    }
    table.update(overrides)
    return table


def _create_template(client, name: str = "샘플 주입일지", tables: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    response = client.post("/api/table-templates", json={"name": name, "tables": tables if tables is not None else [_table()]})
    assert response.status_code == 200, response.text
    return response.json()


def _png_bytes(width: int = 200, height: int = 300) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (255, 255, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


def _upload_image(client, width: int = 200, height: int = 300) -> dict[str, Any]:
    response = client.post("/api/documents", files={"file": ("ledger.png", _png_bytes(width, height), "image/png")})
    assert response.status_code == 200, response.text
    return response.json()


def _cells(*values: str | None, conf: float = 0.95) -> list[dict[str, Any]]:
    return [{"raw": value, "conf": conf} for value in values]


# --- templates ------------------------------------------------------------------------------


def test_table_template_crud_versioning_duplicate_and_archive(client) -> None:
    template = _create_template(client)
    assert template["current_version"] == 1
    assert template["tables"][0]["region_padding"] == 0.05
    assert template["tables"][0]["columns"][1]["type"] == "number"

    assert client.post("/api/table-templates", json={"name": "샘플 주입일지", "tables": []}).status_code == 409
    invalid = client.post("/api/table-templates", json={"name": "bad", "tables": [_table(columns=[{"key": "a"}, {"key": "a"}])]})
    assert invalid.status_code == 422

    renamed = client.patch(f"/api/table-templates/{template['id']}", json={"name": "샘플 주입일지 v2", "pinned": True}).json()
    assert (renamed["name"], renamed["pinned"], renamed["current_version"]) == ("샘플 주입일지 v2", True, 1)

    same_tables = client.patch(f"/api/table-templates/{template['id']}", json={"tables": template["tables"]}).json()
    assert same_tables["current_version"] == 1

    changed = client.patch(
        f"/api/table-templates/{template['id']}",
        json={"tables": [_table(end_hint="'일일누계' 줄 위까지", row_count={"mode": "max", "value": 16})]},
    ).json()
    assert changed["current_version"] == 2
    assert changed["tables"][0]["row_count"] == {"mode": "max", "value": 16}

    duplicate = client.post(f"/api/table-templates/{template['id']}/duplicate").json()
    assert (duplicate["name"], duplicate["current_version"]) == ("샘플 주입일지 v2 (1)", 1)
    assert duplicate["tables"] == changed["tables"]

    archived = client.delete(f"/api/table-templates/{template['id']}").json()
    assert archived["archived"] is True
    listed = client.get("/api/table-templates").json()
    assert [item["id"] for item in listed] == [duplicate["id"]]
    assert len(client.get("/api/table-templates?include_archived=true").json()) == 2
    assert client.patch(f"/api/table-templates/{template['id']}", json={"name": "x"}).status_code == 409
    assert client.get(f"/api/table-templates/{template['id']}").json()["archived"] is True
    assert client.get("/api/table-templates/missing").status_code == 404


# --- single jobs ----------------------------------------------------------------------------


def test_single_job_with_mock_vlm_crops_regions_and_stores_results(mock_vlm, fake_vlm, client) -> None:
    seen: list[dict[str, Any]] = []
    lock = threading.Lock()

    def extract_table(table, image_inputs, *, has_region_crop):
        sizes = []
        for image_input in image_inputs:
            with Image.open(io.BytesIO(read_storage_bytes(image_input["path"]))) as image:
                sizes.append(image.size)
        with lock:
            seen.append({"key": table.key, "sizes": sizes, "has_region_crop": has_region_crop})
        return _mock_rows(table)

    fake_vlm.set(extract_table=extract_table)
    template = _create_template(
        client,
        tables=[
            _table(region={"x": 0.1, "y": 0.2, "width": 0.5, "height": 0.3}),
            _table(key="lots", name="Lot 투입", columns=[{"key": "Lot No"}, {"key": "잔량", "type": "choice", "choices": ["완"], "choice_allow_number": True}]),
        ],
    )
    document = _upload_image(client, 2000, 3000)

    created = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"]})
    assert created.status_code == 200, created.text
    assert created.json()["page_number"] == 1 and created.json()["page_jobs"] == []

    job = client.get(f"/api/table-extraction-jobs/{created.json()['job_id']}").json()
    assert job["status"] == "completed", job
    assert job["template_version"] == 1
    assert [table["key"] for table in job["definition_snapshot"]["tables"]] == ["injection_rows", "lots"]
    result = job["result"]
    injection, lots = result["tables"]
    assert injection["status"] == "ok" and injection["row_count"] == 2
    assert injection["region_used"] == {"x": 0.05, "y": 0.15, "width": 0.6, "height": 0.4, "padding": 0.05}
    assert injection["header_match"] == {"matched": 4, "missing": [], "extra": []}
    first = injection["rows"][0]
    assert (first["row_id"], first["row_index"], first["source_line"], first["status"]) == ("r1", 1, 1, "ok")
    assert first["cells"]["단중"] == {"value": 12, "raw": "12", "confidence": 0.9, "flags": []}
    assert first["cells"]["작업일"]["value"] == "2026-10-01"
    assert lots["region_used"] is None
    assert lots["rows"][0]["cells"]["잔량"]["flags"] == ["choice_matched"]
    assert set(result["raw_model_output"]) == {"injection_rows", "lots"}
    assert result["corrected_tables"] is None and result["validation_warnings"] == []

    by_key = {call["key"]: call for call in seen}
    assert by_key["injection_rows"]["has_region_crop"] is True
    assert by_key["injection_rows"]["sizes"] == [(1200, 1200), (683, 1024)]  # original-resolution crop + overview
    assert by_key["lots"] == {"key": "lots", "sizes": [(2000, 3000)], "has_region_crop": False}

    listed = client.get(f"/api/table-extraction-jobs?document_id={document['document_id']}").json()
    assert [item["job_id"] for item in listed] == [job["job_id"]]


def test_crop_uses_the_rotation_corrected_page_image(mock_vlm, fake_vlm, client) -> None:
    sizes: list[tuple[int, int]] = []

    def extract_table(table, image_inputs, *, has_region_crop):
        with Image.open(io.BytesIO(read_storage_bytes(image_inputs[0]["path"]))) as image:
            sizes.append(image.size)
        return {"headers_seen": [], "rows": [{"source_line": 1, "y_center": 0.5, "cells": _cells("A", "1", "2", "2026-10-19")}], "notes": None}

    fake_vlm.set(extract_table=extract_table)
    template = _create_template(client, tables=[_table(region={"x": 0.0, "y": 0.0, "width": 0.5, "height": 1.0}, region_padding=0)])
    document = _upload_image(client, 400, 200)
    rotated = client.post(f"/api/documents/{document['document_id']}/pages/1/rotate", json={"degrees": 90})
    assert rotated.status_code == 200, rotated.text

    job = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"]}).json()
    assert client.get(f"/api/table-extraction-jobs/{job['job_id']}").json()["status"] == "completed"
    assert sizes == [(100, 400)]  # half the width of the 200×400 rotated page


def test_multipage_single_job_creates_one_job_per_page(mock_vlm, client) -> None:
    template = _create_template(client)
    document = upload_pdf(client)
    created = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"]}).json()
    assert [ref["page_number"] for ref in created["page_jobs"]] == [1, 2, 3]
    for ref in created["page_jobs"]:
        job = client.get(f"/api/table-extraction-jobs/{ref['job_id']}").json()
        assert (job["page_number"], job["status"]) == (ref["page_number"], "completed")
    page_two = client.post(
        "/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"], "page_number": 2}
    ).json()
    assert (page_two["page_number"], page_two["page_jobs"]) == (2, [])
    missing_page = client.post(
        "/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"], "page_number": 9}
    )
    assert missing_page.status_code == 422


def test_job_rejects_unknown_table_keys_and_empty_templates(mock_vlm, client) -> None:
    document = _upload_image(client)
    template = _create_template(client)
    unknown = client.post(
        "/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"], "table_keys": ["nope"]}
    )
    assert unknown.status_code == 422
    empty = _create_template(client, name="empty", tables=[])
    assert client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": empty["id"]}).status_code == 422
    client.delete(f"/api/table-templates/{template['id']}")
    archived = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"]})
    assert archived.status_code == 404


def test_draft_job_runs_an_unsaved_definition_subset(mock_vlm, fake_vlm, client) -> None:
    keys: list[str] = []
    fake_vlm.set(extract_table=lambda table, image_inputs, *, has_region_crop: keys.append(table.key) or _mock_rows(table))
    document = _upload_image(client)
    response = client.post(
        "/api/table-extraction-jobs/draft",
        json={
            "document_id": document["document_id"],
            "page_number": 1,
            "definition": {"name": "preview", "tables": [_table(), _table(key="lots", name="Lot")]},
            "table_keys": ["lots"],
        },
    )
    assert response.status_code == 200, response.text
    job = client.get(f"/api/table-extraction-jobs/{response.json()['job_id']}").json()
    assert job["status"] == "completed"
    assert job["table_keys"] == ["lots"]
    assert [table["table_key"] for table in job["result"]["tables"]] == ["lots"]
    assert keys == ["lots"]
    assert client.get("/api/table-templates").json() == []
    draft = client.get(f"/api/table-templates/{job['template_id']}").json()
    assert draft["ephemeral"] is True


def _mock_rows(table) -> dict[str, Any]:
    from app.vlm import _mock_table_extraction

    return _mock_table_extraction(table)


def test_cells_length_mismatch_marks_the_row_for_review(mock_vlm, fake_vlm, client) -> None:
    fake_vlm.set(
        extract_table=lambda table, image_inputs, *, has_region_crop: {
            "headers_seen": ["품명", "단중", "실적", "작업일"],
            "rows": [
                {"source_line": 1, "y_center": 0.1, "cells": _cells("MBS", "2", "3", "2026-10-19")},
                {"source_line": 2, "y_center": 0.2, "cells": _cells("〃", "2", "3")},
            ],
            "notes": "second row is cut off",
        }
    )
    template = _create_template(client)
    document = _upload_image(client)
    created = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"]}).json()
    job = client.get(f"/api/table-extraction-jobs/{created['job_id']}").json()
    assert job["status"] == "needs_review"
    table = job["result"]["tables"][0]
    assert table["status"] == "needs_review" and table["model_notes"] == "second row is cut off"
    good, short = table["rows"]
    assert good["status"] == "ok"
    assert short["status"] == "needs_review"
    assert short["flags"] == ["cells_length_mismatch"]
    assert short["violations"][0]["rule"] == "cells_length_mismatch"
    assert short["cells"]["품명"]["value"] == "MBS"  # the ditto mark still resolves, position-mapped and flagged
    assert "unaligned" in short["cells"]["품명"]["flags"]
    assert short["cells"]["작업일"]["raw"] is None
    assert any("3 cell(s) for 4 column(s)" in warning for warning in job["result"]["validation_warnings"])


def test_failed_table_calls(mock_vlm, fake_vlm, client) -> None:
    def extract_table(table, image_inputs, *, has_region_crop):
        if table.key == "broken":
            raise RuntimeError("model exploded")
        return _mock_rows(table)

    fake_vlm.set(extract_table=extract_table)
    document = _upload_image(client)
    template = _create_template(client, tables=[_table(), _table(key="broken", name="Broken")])
    created = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"]}).json()
    job = client.get(f"/api/table-extraction-jobs/{created['job_id']}").json()
    assert job["status"] == "needs_review"
    broken = job["result"]["tables"][1]
    assert (broken["status"], broken["error"]) == ("failed", "model exploded")
    assert job["result"]["raw_model_output"]["broken"] == {"error": "model exploded"}

    only_broken = _create_template(client, name="only broken", tables=[_table(key="broken", name="Broken")])
    created = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": only_broken["id"]}).json()
    job = client.get(f"/api/table-extraction-jobs/{created['job_id']}").json()
    assert (job["status"], job["result"]) == ("failed", None)
    assert "model exploded" in job["error_message"]


# --- reviewer edits -------------------------------------------------------------------------


def test_patch_result_edits_adds_deletes_and_revalidates(mock_vlm, fake_vlm, client) -> None:
    fake_vlm.set(
        extract_table=lambda table, image_inputs, *, has_region_crop: {
            "headers_seen": [],
            "rows": [
                {"source_line": 1, "y_center": 0.1, "cells": _cells("A", "2", "3", "2026-10-19")},
                {"source_line": 2, "y_center": 0.2, "cells": _cells("B", "2", "x", "2026-10-19")},
                {"source_line": 3, "y_center": 0.3, "cells": _cells("C", "1", "1", "2026-10-19")},
            ],
            "notes": None,
        }
    )
    template = _create_template(client, tables=[_table(rules=[{"kind": "unique", "columns": ["품명"]}])])
    document = _upload_image(client)
    created = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"]}).json()
    job = client.get(f"/api/table-extraction-jobs/{created['job_id']}").json()
    assert job["status"] == "needs_review"
    result_id = job["result_id"]
    assert job["result"]["tables"][0]["rows"][1]["cells"]["실적"]["flags"] == ["type_mismatch"]

    patched = client.patch(
        f"/api/table-extraction-results/{result_id}",
        json={
            "edits": [
                {"table_key": "injection_rows", "row_index": 2, "column": "실적", "value": "1,234"},
                {"table_key": "injection_rows", "row_id": "r1", "column": "품명", "value": "C"},
            ],
            "delete_rows": [{"table_key": "injection_rows", "row_index": 3}],
            "add_rows": [{"table_key": "injection_rows", "after_row_index": 1, "cells": {"품명": "D", "단중": "5"}}],
            "reviewed": True,
        },
    )
    assert patched.status_code == 200, patched.text
    body = patched.json()
    assert body["reviewed"] is True
    original_rows = body["tables"][0]["rows"]
    assert [row["cells"]["품명"]["value"] for row in original_rows] == ["A", "B", "C"]  # model result is untouched
    corrected = body["corrected_tables"][0]
    rows = corrected["rows"]
    assert [(row["row_id"], row["row_index"]) for row in rows] == [("r1", 1), ("a1", 2), ("r2", 3)]
    assert rows[0]["cells"]["품명"] == {"value": "C", "raw": "C", "confidence": 1.0, "flags": ["corrected"]}
    assert rows[0]["flags"] == ["edited"]
    assert rows[1]["flags"] == ["added"] and rows[1]["cells"]["단중"]["value"] == 5
    assert rows[1]["cells"]["실적"]["flags"] == ["empty"]
    assert rows[2]["cells"]["실적"]["value"] == 1234
    assert "corrected" in rows[2]["cells"]["실적"]["flags"]
    assert corrected["status"] == "ok"  # row C was deleted, so the edited "C" is unique again
    assert corrected["row_count"] == 3
    assert [entry["action"] for entry in body["edit_log"]] == ["edit", "edit", "delete_row", "add_row", "reviewed"]
    assert body["edit_log"][0]["before"] is None and body["edit_log"][0]["after"] == "1,234"

    # A second PATCH starts from corrected_tables and references its rows.
    again = client.patch(
        f"/api/table-extraction-results/{result_id}",
        json={"edits": [{"table_key": "injection_rows", "row_id": "a1", "column": "품명", "value": "C"}]},
    ).json()
    duplicate_rows = [row for row in again["corrected_tables"][0]["rows"] if row["status"] == "needs_review"]
    assert {row["row_id"] for row in duplicate_rows} == {"r1", "a1"}
    assert again["corrected_tables"][0]["status"] == "needs_review"

    unknown_column = client.patch(
        f"/api/table-extraction-results/{result_id}",
        json={"edits": [{"table_key": "injection_rows", "row_id": "r1", "column": "없음", "value": "1"}]},
    )
    assert unknown_column.status_code == 422
    unknown_row = client.patch(f"/api/table-extraction-results/{result_id}", json={"delete_rows": [{"table_key": "injection_rows", "row_id": "r9"}]})
    assert unknown_row.status_code == 422
    assert client.patch("/api/table-extraction-results/missing", json={}).status_code == 404


# --- batches --------------------------------------------------------------------------------


def test_batch_from_three_page_pdf_creates_three_page_jobs(mock_vlm, client) -> None:
    template = _create_template(client)
    document = upload_pdf(client)
    response = client.post("/api/table-extraction-batches/from-documents", json={"template_id": template["id"], "document_ids": [document["document_id"]]})
    assert response.status_code == 200, response.text
    created = response.json()
    assert created["total_count"] == 3
    assert [item["page_number"] for item in created["items"]] == [1, 2, 3]
    assert created["template_version"] == 1

    batch = client.get(f"/api/table-extraction-batches/{created['id']}").json()
    assert batch["status"] == "completed", batch
    assert batch["completed_count"] == 3
    for item in batch["items"]:
        job = client.get(f"/api/table-extraction-jobs/{item['job_id']}").json()
        assert job["page_number"] == item["page_number"]
        assert job["result_id"] == item["result_id"]
        assert job["result"]["tables"][0]["row_count"] == 2
    summary = client.get(f"/api/table-extraction-batches/{created['id']}/summary").json()
    assert (summary["total_count"], summary["completed_count"], summary["items"]) == (3, 3, [])
    assert [item["id"] for item in client.get("/api/table-extraction-batches").json()] == [created["id"]]

    # Editing the template later does not change what the batch ran.
    client.patch(f"/api/table-templates/{template['id']}", json={"tables": [_table(name="changed")]})
    job = client.get(f"/api/table-extraction-jobs/{batch['items'][0]['job_id']}").json()
    assert job["definition_snapshot"]["tables"][0]["name"] == "주입 내역"


def test_batch_cancel_and_resume(mock_vlm, job_runners, client) -> None:
    job_runners.set(table_extraction_batch=lambda batch_id, job_ids: None)
    template = _create_template(client)
    document = upload_pdf(client)
    paused = client.post("/api/table-extraction-batches/from-documents", json={"template_id": template["id"], "document_ids": [document["document_id"]]}).json()
    assert {item["status"] for item in paused["items"]} == {"queued"}

    job_runners.reset()
    resumed = client.post(f"/api/table-extraction-batches/{paused['id']}/resume")
    assert resumed.status_code == 200, resumed.text
    batch = client.get(f"/api/table-extraction-batches/{paused['id']}").json()
    assert (batch["status"], batch["completed_count"]) == ("completed", 3)
    assert client.post(f"/api/table-extraction-batches/{paused['id']}/resume").status_code == 409

    job_runners.set(table_extraction_batch=lambda batch_id, job_ids: None)
    second = client.post("/api/table-extraction-batches/from-documents", json={"template_id": template["id"], "document_ids": [document["document_id"]]}).json()
    canceled = client.post(f"/api/table-extraction-batches/{second['id']}/cancel").json()
    assert canceled["status"] == "canceled"
    assert canceled["canceled_count"] == 3
    assert {item["status"] for item in canceled["items"]} == {"canceled"}

    discarded = client.post(f"/api/table-extraction-batches/{second['id']}/discard").json()
    assert discarded["status"] == "canceled" and discarded["items"] == []


def test_batch_waits_for_converting_documents_and_expands_pages(mock_vlm, client) -> None:
    from app.infra.jobs.conversion import activate_ready_document_waiters
    from tests.api.test_page_level_processing import _set_document_status

    template = _create_template(client)
    document = upload_pdf(client)
    document_id = document["document_id"]
    _set_document_status(document_id, "preprocessing")

    batch = client.post("/api/table-extraction-batches/from-documents", json={"template_id": template["id"], "document_ids": [document_id]}).json()
    assert [(item["page_number"], item["status"]) for item in batch["items"]] == [(None, "waiting_for_document")]
    single = client.post("/api/table-extraction-jobs", json={"document_id": document_id, "template_id": template["id"]}).json()
    assert (single["page_number"], single["status"]) == (None, "waiting_for_document")

    _set_document_status(document_id, "ready")
    activate_ready_document_waiters(document_id)

    expanded = client.get(f"/api/table-extraction-batches/{batch['id']}").json()
    assert [item["page_number"] for item in expanded["items"]] == [1, 2, 3]
    assert expanded["status"] == "completed", expanded
    jobs = client.get(f"/api/table-extraction-jobs?document_id={document_id}&limit=100").json()
    standalone = [job for job in jobs if job["job_id"] not in {item["job_id"] for item in expanded["items"]}]
    assert sorted(job["page_number"] for job in standalone) == [1, 2, 3]
    assert {job["status"] for job in standalone} == {"completed"}
    assert all(job["definition_snapshot"]["tables"][0]["key"] == "injection_rows" for job in standalone)


def test_startup_recovery_covers_table_jobs_and_batches(mock_vlm, job_runners, job_queue, client) -> None:
    job_runners.set(table_extraction_batch=lambda batch_id, job_ids: None, table_extraction_job=lambda job_id: None)
    template = _create_template(client)
    document = upload_pdf(client)
    batch = client.post("/api/table-extraction-batches/from-documents", json={"template_id": template["id"], "document_ids": [document["document_id"]]}).json()
    single = client.post("/api/table-extraction-jobs", json={"document_id": document["document_id"], "template_id": template["id"], "page_number": 1}).json()

    db = SessionLocal()
    try:
        interrupted = db.get(TableExtractionJob, batch["items"][0]["job_id"])
        interrupted.status = "running"
        db.get(TableExtractionJob, single["job_id"]).status = "running"
        db.query(JobQueueEntry).delete()
        db.commit()
    finally:
        db.close()

    job_runners.reset()
    recover_on_startup()
    job_queue.run_until_idle()

    recovered = client.get(f"/api/table-extraction-batches/{batch['id']}").json()
    assert (recovered["status"], recovered["completed_count"]) == ("completed", 3)
    orphan = client.get(f"/api/table-extraction-jobs/{single['job_id']}").json()
    assert (orphan["status"], orphan["error_message"]) == ("failed", INTERRUPTED_MESSAGE)
