import asyncio
import threading
import time

import pytest

from tests.conftest import get_client
from tests.support.api import (
    assert_xlsx_response,
    create_schema,
    make_pdf_bytes,
    upload_png,
)


def test_kie_field_groups_run_with_bounded_parallelism(settings_env, fake_vlm) -> None:
    from app import extraction as extraction_module
    from app.extraction import DocumentPageSnapshot, DocumentSnapshot
    from app.schemas import FieldDefinition

    settings_env(KIE_FIELD_GROUP_SIZE="1", WORKFLOW_MAX_WORKERS="1", VLM_MAX_CONCURRENT_REQUESTS="2")

    active = 0
    max_active = 0
    calls = 0
    lock = threading.Lock()

    def fake_extract_with_vlm(fields, image_inputs=None):
        nonlocal active, max_active, calls
        with lock:
            active += 1
            calls += 1
            max_active = max(max_active, active)
        time.sleep(0.03)
        with lock:
            active -= 1
        return {field.key_name: {"value": f"value-{field.key_name}", "page": 1, "confidence": 1, "evidence": "mock"} for field in fields}

    fake_vlm.set(extract=fake_extract_with_vlm)
    fields = [FieldDefinition(key_name=f"field_{index}", description="test field", output_format="string") for index in range(4)]
    document = DocumentSnapshot(
        id="doc_1",
        storage_path="/tmp/doc_1/source.png",
        pages=[DocumentPageSnapshot(page_number=1, image_path="/tmp/doc_1/page_1.png")],
    )

    values = asyncio.run(extraction_module._extract_grouped_values_async(document, fields, [], "job_1"))

    assert calls == 4
    assert max_active == 2
    assert set(values) == {field.key_name for field in fields}


def test_extraction_fails_without_vlm_credentials(settings_env) -> None:
    settings_env(VLM_API_KEY="", VLM_MODEL_NAME="", OPENAI_API_KEY="", OPENAI_MODEL_NAME="")
    with get_client() as client:
        document = upload_png(client)
        schema = create_schema(client)
        job_response = client.post(
            "/api/extraction-jobs",
            json={"document_id": document["document_id"], "schema_id": schema["id"]},
        )
        assert job_response.status_code == 200
        job_id = job_response.json()["job_id"]

        job = client.get(f"/api/extraction-jobs/{job_id}").json()
        assert job["status"] == "failed"
        assert job["result_id"] is None
        assert "VLM model name is required" in job["error_message"]


def test_extraction_mock_mode_returns_evidence_and_normalized_values(mock_vlm, client) -> None:
    document = upload_png(client)
    schema = create_schema(client)
    job_response = client.post(
        "/api/extraction-jobs",
        json={"document_id": document["document_id"], "schema_id": schema["id"]},
    )
    assert job_response.status_code == 200, job_response.text
    job_id = job_response.json()["job_id"]

    job = client.get(f"/api/extraction-jobs/{job_id}").json()
    assert job["status"] == "completed"
    values = job["result"]["validated_output"]["values"]
    assert values["invoice_number"]["page"] == 1
    assert values["invoice_number"]["evidence"]
    assert values["total_amount"]["normalized_value"] == 1234.5

    jobs = client.get(f"/api/extraction-jobs?document_id={document['document_id']}").json()
    assert any(item["job_id"] == job_id for item in jobs)

    csv_export = client.get(f"/api/extraction-results/{job['result_id']}/export?format=csv")
    assert csv_export.status_code == 200
    assert csv_export.content.startswith(b"\xef\xbb\xbf")
    assert "charset=utf-8" in csv_export.headers["content-type"]
    assert "evidence" in csv_export.text.splitlines()[0]

    xlsx_export = client.get(f"/api/extraction-results/{job['result_id']}/export?format=xlsx")
    assert_xlsx_response(xlsx_export)

    corrected_output = job["result"]["validated_output"]
    corrected_output["values"]["invoice_number"]["value"] = "INV-EDITED"
    patch = client.patch(
        f"/api/extraction-results/{job['result_id']}",
        json={"corrected_output": corrected_output},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["corrected_output"]["values"]["invoice_number"]["value"] == "INV-EDITED"


def test_extraction_low_confidence_requires_review(fake_vlm, client) -> None:
    def fake_extract(fields, image_paths=None, image_inputs=None):
        return {
            "invoice_number": {
                "value": "INV-LOW",
                "page": 1,
                "evidence": "low confidence evidence",
                "confidence": 0.0,
            },
            "total_amount": {
                "value": "10.00",
                "page": 1,
                "evidence": "high confidence evidence",
                "confidence": 0.95,
            },
        }

    fake_vlm.set(extract=fake_extract)

    document = upload_png(client)
    schema = create_schema(client)
    job_response = client.post(
        "/api/extraction-jobs",
        json={"document_id": document["document_id"], "schema_id": schema["id"]},
    )
    assert job_response.status_code == 200, job_response.text
    job = client.get(f"/api/extraction-jobs/{job_response.json()['job_id']}").json()

    assert job["status"] == "needs_review"
    result = job["result"]
    assert result["validated_output"]["status"] == "needs_review"
    values = result["validated_output"]["values"]
    assert "low_confidence" in values["invoice_number"]["warnings"]
    assert values["total_amount"]["warnings"] == []
    assert "invoice_number:low_confidence" in result["validation_warnings"]


def test_extraction_null_without_evidence_is_not_detected(fake_vlm, client) -> None:
    def fake_extract(fields, image_paths=None, image_inputs=None):
        return {
            "invoice_number": {
                "value": None,
                "page": 1,
                "evidence": None,
                "confidence": 0.0,
            },
            "total_amount": {
                "value": "10.00",
                "page": 1,
                "evidence": "high confidence evidence",
                "confidence": 0.95,
            },
        }

    fake_vlm.set(extract=fake_extract)

    document = upload_png(client)
    schema = create_schema(client)
    job_response = client.post(
        "/api/extraction-jobs",
        json={"document_id": document["document_id"], "schema_id": schema["id"]},
    )
    assert job_response.status_code == 200, job_response.text
    job = client.get(f"/api/extraction-jobs/{job_response.json()['job_id']}").json()

    assert job["status"] == "needs_review"
    values = job["result"]["validated_output"]["values"]
    assert values["invoice_number"]["value"] is None
    assert values["invoice_number"]["confidence"] is None
    assert "not_detected" in values["invoice_number"]["warnings"]
    assert "low_confidence" not in values["invoice_number"]["warnings"]
    assert "invoice_number:not_detected" in job["result"]["validation_warnings"]


def test_extraction_releases_db_connection_during_vlm_call(fake_vlm, client) -> None:
    from app.core.db import engine

    checked_out_counts: list[int] = []

    def fake_extract(fields, image_paths=None, image_inputs=None):
        checkedout = getattr(engine.pool, "checkedout", None)
        checked_out_counts.append(checkedout() if checkedout else 0)
        return {
            "invoice_number": {"value": "INV-POOL-001", "page": 1, "evidence": "test", "confidence": 0.9},
            "total_amount": {"value": "10.00", "page": 1, "evidence": "test", "confidence": 0.9},
        }

    fake_vlm.set(extract=fake_extract)

    document = upload_png(client)
    schema = create_schema(client)
    response = client.post(
        "/api/extraction-jobs",
        json={"document_id": document["document_id"], "schema_id": schema["id"]},
    )
    assert response.status_code == 200, response.text
    job_id = response.json()["job_id"]
    job = client.get(f"/api/extraction-jobs/{job_id}").json()
    assert job["status"] == "completed"

    assert checked_out_counts
    assert max(checked_out_counts) == 0


def test_extraction_uses_schema_regions_for_cropped_inputs(fake_vlm, client) -> None:
    captured_calls: list[dict[str, object]] = []

    def fake_extract(fields, image_paths=None, image_inputs=None):
        captured_calls.append({"fields": fields, "image_paths": image_paths, "image_inputs": image_inputs})
        field_names = {field.key_name for field in fields}
        values = {}
        if "handwritten_name" in field_names:
            values["handwritten_name"] = {"value": "홍길동", "page": 1, "evidence": "region crop", "confidence": 0.91}
        if "handwritten_phone" in field_names:
            values["handwritten_phone"] = {"value": "010-0000-0000", "page": 1, "evidence": "region crop", "confidence": 0.9}
        if "document_date" in field_names:
            values["document_date"] = {"value": "2026.05.20", "page": 1, "evidence": "full page", "confidence": 0.9}
        return {
            **values,
        }

    fake_vlm.set(extract=fake_extract)

    document = client.post(
        "/api/documents",
        files={"file": ("sample.pdf", make_pdf_bytes(), "application/pdf")},
    ).json()
    schema = client.post(
        "/api/schemas",
        json={
            "name": "mixed_region_schema",
            "regions": [{"id": "region_1", "name": "Handwriting block", "page": 1, "x": 0.1, "y": 0.1, "width": 0.5, "height": 0.4}],
            "fields": [
                {
                    "key_name": "handwritten_name",
                    "description": "손글씨 이름 영역",
                    "output_format": "string",
                    "region_id": "region_1",
                },
                {
                    "key_name": "handwritten_phone",
                    "description": "손글씨 연락처 영역",
                    "output_format": "string",
                    "region_id": "region_1",
                },
                {
                    "key_name": "document_date",
                    "description": "문서 전체에서 날짜",
                    "output_format": "date",
                },
            ],
        },
    ).json()
    job_response = client.post(
        "/api/extraction-jobs",
        json={"document_id": document["document_id"], "schema_id": schema["id"]},
    )
    assert job_response.status_code == 200, job_response.text
    job = client.get(f"/api/extraction-jobs/{job_response.json()['job_id']}").json()

    assert job["status"] == "completed"
    assert len(captured_calls) == 2

    full_page_call = next(call for call in captured_calls if [field.key_name for field in call["fields"]] == ["document_date"])
    full_page_inputs = full_page_call["image_inputs"]
    assert isinstance(full_page_inputs, list)
    assert any("Full document page 1" in item["label"] for item in full_page_inputs)

    region_call = next(
        call for call in captured_calls if {field.key_name for field in call["fields"]} == {"handwritten_name", "handwritten_phone"}
    )
    region_inputs = region_call["image_inputs"]
    assert isinstance(region_inputs, list)
    assert any("Full page context" in item["label"] and "Handwriting block" in item["label"] for item in region_inputs)
    assert any("Masked full page context" in item["label"] and "Handwriting block" in item["label"] for item in region_inputs)
    assert any("Cropped extraction region" in item["label"] and "Handwriting block" in item["label"] for item in region_inputs)
    assert any("handwritten_name, handwritten_phone" in item["label"] for item in region_inputs)
    assert len(region_inputs) == 3
    region_fields = region_call["fields"]
    assert region_fields[0].region_id == "region_1"
    assert region_fields[1].region_id == "region_1"


def test_kie_prompts_are_split_by_region_presence() -> None:
    from app.prompts.kie import build_extraction_prompt, build_region_judgement_prompt
    from app.schemas import FieldDefinition

    full_prompt = build_extraction_prompt(
        [FieldDefinition(key_name="document_date", description="Date visible on the document.", output_format="date")]
    )
    region_field = FieldDefinition(
        key_name="signature", description="Signature in the lower right area.", output_format="string", region_id="region_1"
    )
    region_prompt = build_extraction_prompt([region_field])
    judgement_prompt = build_region_judgement_prompt(region_field, "서명", "first-stage evidence")

    assert "full document page images" in full_prompt
    assert "user-designated extraction region" not in full_prompt
    assert "labeled extraction region images" in region_prompt
    assert "crop image is already the user-designated extraction region" in region_prompt
    assert "masked image to confirm the region's original position" in region_prompt
    assert "verification step, not a re-extraction step" in judgement_prompt
    assert "default decision is judgement_status=correct" in judgement_prompt
    assert "If text such as 성명, 서명, 법정" in judgement_prompt


def test_kie_ai_judgement_corrects_enabled_field(fake_vlm, client) -> None:
    def fake_extract(fields, image_paths=None, image_inputs=None):
        return {
            field.key_name: {
                "value": "WRONG" if field.key_name == "invoice_number" else "1,234.50",
                "page": 1,
                "evidence": f"first evidence {field.key_name}",
                "confidence": 0.82,
            }
            for field in fields
        }

    judgement_calls = []
    correction_calls = []

    def fake_judge(field, initial_value, initial_evidence, image_inputs):
        judgement_calls.append((field.key_name, initial_value, initial_evidence, image_inputs))
        return {
            "judgement_status": "needs_correction",
            "reason": "The visible invoice number is different from the first-stage value.",
            "confidence": 0.93,
            "evidence": "Invoice number area",
        }

    def fake_correct(field, initial_value, initial_evidence, judgement_reason, image_inputs):
        correction_calls.append((field.key_name, judgement_reason, image_inputs))
        return {
            "value": "INV-2026-001",
            "page": 1,
            "evidence": "Corrected invoice number",
            "confidence": 0.95,
            "correction_reason": "Correct value is visible near the top.",
        }

    fake_vlm.set(extract=fake_extract)
    fake_vlm.set(judge_extraction=fake_judge)
    fake_vlm.set(correct_extraction=fake_correct)

    document = upload_png(client)
    schema = client.post(
        "/api/schemas",
        json={
            "name": "judgement_schema",
            "fields": [
                {
                    "key_name": "invoice_number",
                    "description": "Invoice number near the top.",
                    "output_format": "string",
                    "judgement_enabled": True,
                },
                {
                    "key_name": "total_amount",
                    "description": "Final total amount.",
                    "output_format": "float",
                },
            ],
        },
    )
    assert schema.status_code == 200, schema.text
    duplicated = client.post(f"/api/schemas/{schema.json()['id']}/duplicate")
    assert duplicated.status_code == 200, duplicated.text
    assert duplicated.json()["fields"][0]["judgement_enabled"] is True

    job_response = client.post(
        "/api/extraction-jobs",
        json={"document_id": document["document_id"], "schema_id": schema.json()["id"]},
    )
    assert job_response.status_code == 200, job_response.text
    job = client.get(f"/api/extraction-jobs/{job_response.json()['job_id']}").json()

    assert job["status"] == "completed"
    values = job["result"]["validated_output"]["values"]
    assert values["invoice_number"]["value"] == "INV-2026-001"
    assert values["invoice_number"]["ai_review"]["corrected"] is True
    assert values["invoice_number"]["ai_review"]["initial_value"] == "WRONG"
    assert "ai_review" not in values["total_amount"]
    assert job["result"]["raw_model_output"]["invoice_number"]["value"] == "WRONG"
    assert [call[0] for call in judgement_calls] == ["invoice_number"]
    assert [call[0] for call in correction_calls] == ["invoice_number"]


def test_kie_ai_judgement_failure_needs_review_without_failing_job(fake_vlm, client) -> None:
    def fake_extract(fields, image_paths=None, image_inputs=None):
        return {
            field.key_name: {
                "value": "INV-1",
                "page": 1,
                "evidence": "first evidence",
                "confidence": 0.82,
            }
            for field in fields
        }

    def fake_judge(field, initial_value, initial_evidence, image_inputs):
        raise RuntimeError("synthetic judgement failure")

    fake_vlm.set(extract=fake_extract)
    fake_vlm.set(judge_extraction=fake_judge)

    document = upload_png(client)
    schema = client.post(
        "/api/schemas",
        json={
            "name": "judgement_failure_schema",
            "fields": [
                {
                    "key_name": "invoice_number",
                    "description": "Invoice number near the top.",
                    "output_format": "string",
                    "judgement_enabled": True,
                }
            ],
        },
    )
    assert schema.status_code == 200, schema.text
    job_response = client.post(
        "/api/extraction-jobs",
        json={"document_id": document["document_id"], "schema_id": schema.json()["id"]},
    )
    assert job_response.status_code == 200, job_response.text
    job = client.get(f"/api/extraction-jobs/{job_response.json()['job_id']}").json()

    assert job["status"] == "needs_review"
    value = job["result"]["validated_output"]["values"]["invoice_number"]
    assert value["value"] == "INV-1"
    assert "ai_review_failed" in value["warnings"]
    assert value["ai_review"]["judgement_status"] == "failed"


@pytest.mark.parametrize(
    ("initial_value", "corrected_value", "expected_warning"),
    [
        ("성명", None, "ai_correction_discarded_null"),
        ("문어", "문이", "ai_correction_large_change"),
    ],
)
def test_kie_ai_correction_preserves_risky_korean_values(
    initial_value: str, corrected_value: str | None, expected_warning: str, fake_vlm, client
) -> None:
    def fake_extract(fields, image_paths=None, image_inputs=None):
        return {
            field.key_name: {
                "value": initial_value,
                "page": 1,
                "evidence": f"first evidence {initial_value}",
                "confidence": 0.91,
            }
            for field in fields
        }

    def fake_judge(field, initial_value, initial_evidence, image_inputs):
        return {
            "judgement_status": "needs_correction",
            "reason": "Synthetic judgement requested a risky correction.",
            "confidence": 0.98,
            "evidence": "Synthetic evidence",
        }

    def fake_correct(field, initial_value, initial_evidence, judgement_reason, image_inputs):
        return {
            "value": corrected_value,
            "page": 1,
            "evidence": "Synthetic correction evidence",
            "confidence": 0.99,
            "correction_reason": "Synthetic risky correction.",
        }

    fake_vlm.set(extract=fake_extract)
    fake_vlm.set(judge_extraction=fake_judge)
    fake_vlm.set(correct_extraction=fake_correct)

    document = upload_png(client)
    schema = client.post(
        "/api/schemas",
        json={
            "name": f"judgement_risky_{expected_warning}",
            "fields": [
                {
                    "key_name": "법정대리인성명",
                    "description": "Legal representative name in the handwritten field.",
                    "output_format": "string",
                    "judgement_enabled": True,
                }
            ],
        },
    )
    assert schema.status_code == 200, schema.text
    job_response = client.post(
        "/api/extraction-jobs",
        json={"document_id": document["document_id"], "schema_id": schema.json()["id"]},
    )
    assert job_response.status_code == 200, job_response.text
    job = client.get(f"/api/extraction-jobs/{job_response.json()['job_id']}").json()

    assert job["status"] == "needs_review"
    value = job["result"]["validated_output"]["values"]["법정대리인성명"]
    assert value["value"] == initial_value
    assert expected_warning in value["warnings"]
    assert value["ai_review"]["judgement_status"] == "needs_correction"
    assert value["ai_review"]["corrected"] is False
