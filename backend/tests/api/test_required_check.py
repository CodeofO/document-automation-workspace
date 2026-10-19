from tests.support.api import (
    ONE_BY_ONE_PNG,
    assert_xlsx_response,
    create_required_field_checklist,
    upload_png,
)


def test_required_field_checklist_recommendation_mock_mode(mock_vlm, client) -> None:
    document = upload_png(client)
    response = client.post(
        "/api/required-field-checklists/recommendations",
        json={"document_id": document["document_id"]},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["name"] == "ai_recommended_checklist"
    assert len(payload["items"]) >= 3
    assert {item["evidence_type"] for item in payload["items"]} <= {
        "text_or_handwriting",
        "checkbox",
        "signature_or_stamp",
        "visual_mark",
        "other",
    }
    assert {item["region_id"] for item in payload["items"] if item["region_id"]} <= {region["id"] for region in payload["regions"]}


def test_required_field_checklist_single_job_and_region_validation(mock_vlm, client) -> None:
    invalid = client.post(
        "/api/required-field-checklists",
        json={
            "name": "invalid_checklist",
            "regions": [],
            "items": [
                {
                    "item_name": "서명",
                    "description": "서명 존재 여부",
                    "evidence_type": "signature_or_stamp",
                    "required": True,
                    "region_id": "missing_region",
                }
            ],
        },
    )
    assert invalid.status_code == 422

    custom = client.post(
        "/api/required-field-checklists",
        json={
            "name": "custom_evidence_checklist",
            "regions": [],
            "items": [
                {
                    "item_name": "수기 메모",
                    "description": "사용자가 직접 정의한 증거 유형을 확인합니다.",
                    "evidence_type": "수기 메모/특이사항",
                    "required": True,
                }
            ],
        },
    )
    assert custom.status_code == 200, custom.text
    assert custom.json()["items"][0]["evidence_type"] == "수기 메모/특이사항"

    checklist = create_required_field_checklist(client)
    document = upload_png(client)
    response = client.post(
        "/api/required-field-check-jobs",
        json={"document_id": document["document_id"], "checklist_id": checklist["id"]},
    )
    assert response.status_code == 200, response.text
    job = client.get(f"/api/required-field-check-jobs/{response.json()['job_id']}").json()
    assert job["status"] == "needs_review"
    output = job["result"]["validated_output"]
    assert output["overall_status"] == "needs_review"
    assert [item["item_name"] for item in output["items"]] == ["성명", "서명", "체크박스"]
    assert output["items"][0]["status"] == "present"
    assert output["items"][2]["status"] == "uncertain"

    corrected = {
        **output,
        "overall_status": "complete",
        "items": [{**item, "status": "present"} for item in output["items"]],
    }
    patch = client.patch(
        f"/api/required-field-check-results/{job['result_id']}",
        json={"corrected_output": corrected, "reviewed": True},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["corrected_output"]["overall_status"] == "complete"

    deleted = client.delete(f"/api/required-field-checklists/{checklist['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["archived"] is True


def test_required_checker_accepts_pydantic_item_object_output() -> None:
    from app.document_modules import RequiredFieldContext, _validate_required_field_output
    from app.extraction import DocumentSnapshot
    from app.schemas import RequiredFieldItem

    context = RequiredFieldContext(
        document=DocumentSnapshot(id="doc_1", storage_path="", pages=[]),
        checklist_id="checklist_1",
        items=[
            RequiredFieldItem(item_name="서명", description="서명 확인", required=True),
            RequiredFieldItem(item_name="작성일", description="작성일 확인", required=True),
        ],
        regions=[],
    )
    raw_values = {
        "overall_status": "needs_review",
        "items": {
            "서명": {"status": "present", "confidence": 0.9, "evidence": "서명이 보입니다.", "page": 1},
            "작성일": {"status": "missing", "confidence": 0.8, "evidence": None, "page": None},
        },
    }

    validated = _validate_required_field_output(raw_values, context)

    assert validated["overall_status"] == "incomplete"
    assert [item["item_name"] for item in validated["items"]] == ["서명", "작성일"]
    assert validated["items"][0]["status"] == "present"
    assert validated["items"][1]["status"] == "missing"


def test_required_checker_splits_full_page_and_region_requests(fake_vlm, client) -> None:
    captured_calls: list[dict[str, object]] = []

    def fake_check(items, regions, image_paths=None, image_inputs=None):
        captured_calls.append(
            {
                "item_names": [item.item_name for item in items],
                "region_ids": [region.id for region in regions],
                "labels": [item["label"] for item in image_inputs or []],
            }
        )
        return {
            "overall_status": "complete",
            "items": [
                {
                    "item_name": item.item_name,
                    "status": "present",
                    "confidence": 0.9,
                    "evidence": "captured",
                    "page": 1,
                }
                for item in items
            ],
        }

    fake_vlm.set(check_required_fields=fake_check)

    checklist = create_required_field_checklist(client, name="split_required_checklist")
    document = upload_png(client)
    response = client.post(
        "/api/required-field-check-jobs",
        json={"document_id": document["document_id"], "checklist_id": checklist["id"]},
    )
    assert response.status_code == 200, response.text
    job = client.get(f"/api/required-field-check-jobs/{response.json()['job_id']}").json()

    assert job["status"] == "completed"
    assert len(captured_calls) == 2
    full_page_call = next(call for call in captured_calls if call["region_ids"] == [])
    assert full_page_call["item_names"] == ["성명", "체크박스"]
    assert any("Full document page" in label for label in full_page_call["labels"])

    region_call = next(call for call in captured_calls if call["region_ids"] == ["signature_region"])
    assert region_call["item_names"] == ["서명"]
    assert any("Masked context" in label and "서명 영역" in label for label in region_call["labels"])
    assert any("Cropped required field region" in label and "서명 영역" in label for label in region_call["labels"])
    assert not any("Full document page" in label for label in region_call["labels"])


def test_required_field_checklist_duplicate_copies_items_and_regions(client) -> None:
    checklist = create_required_field_checklist(client, name="필수 정보")
    duplicated = client.post(f"/api/required-field-checklists/{checklist['id']}/duplicate")
    assert duplicated.status_code == 200, duplicated.text
    payload = duplicated.json()
    assert payload["id"] != checklist["id"]
    assert payload["name"] == "필수 정보 (1)"
    assert payload["items"] == checklist["items"]
    assert payload["regions"] == checklist["regions"]


def test_required_field_check_batch_export_mock_mode(mock_vlm, client) -> None:
    checklist = create_required_field_checklist(client, name="batch_checklist")
    response = client.post(
        "/api/required-field-check-batches",
        data={"checklist_id": checklist["id"]},
        files=[
            ("files", ("z_last.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("a_first.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert response.status_code == 200, response.text
    batch = response.json()
    assert [item["filename"] for item in batch["items"]] == ["a_first.png", "z_last.png"]

    loaded = client.get(f"/api/required-field-check-batches/{batch['id']}").json()
    assert loaded["status"] == "completed"
    assert loaded["completed_count"] == 2

    csv_response = client.get(f"/api/required-field-check-batches/{batch['id']}/export?format=csv")
    assert csv_response.status_code == 200, csv_response.text
    assert csv_response.content.startswith(b"\xef\xbb\xbf")
    assert "charset=utf-8" in csv_response.headers["content-type"]
    header = csv_response.text.splitlines()[0]
    assert "overall_status" in header
    assert "성명_status" in header
    assert csv_response.text.index("a_first.png") < csv_response.text.index("z_last.png")

    json_response = client.get(f"/api/required-field-check-batches/{batch['id']}/export?format=json")
    assert json_response.status_code == 200
    rows = json_response.json()["rows"]
    assert rows[0]["성명_status"] == "present"

    xlsx_response = client.get(f"/api/required-field-check-batches/{batch['id']}/export?format=xlsx")
    assert_xlsx_response(xlsx_response)


def test_required_field_check_batch_cancel_marks_queued_jobs_canceled(job_runners, client) -> None:
    job_runners.set(required_check_batch=lambda batch_id, job_ids: None)

    checklist = create_required_field_checklist(client, name="cancel_checklist")
    response = client.post(
        "/api/required-field-check-batches",
        data={"checklist_id": checklist["id"]},
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
    )
    assert response.status_code == 200, response.text
    batch = response.json()
    assert batch["status"] == "running"

    canceled = client.post(f"/api/required-field-check-batches/{batch['id']}/cancel")
    assert canceled.status_code == 200, canceled.text
    payload = canceled.json()
    assert payload["status"] == "canceled"
    assert payload["canceled_count"] == 2
    assert payload["progress"] == 1
    assert payload["completed_at"] is not None
    assert {item["status"] for item in payload["items"]} == {"canceled"}
