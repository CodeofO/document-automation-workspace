from tests.support.api import (
    create_schema,
    upload_png,
)


def test_schema_validation_and_creation(client) -> None:
    invalid = client.post(
        "/api/schemas",
        json={
            "name": "bad_schema",
            "fields": [
                {"key_name": "total", "description": "Total amount", "output_format": "float"},
                {"key_name": "total", "description": "Duplicate total", "output_format": "float"},
            ],
        },
    )
    assert invalid.status_code == 422

    unsupported_format = client.post(
        "/api/schemas",
        json={
            "name": "bad_format",
            "fields": [
                {"key_name": "count", "description": "Unsupported integer field", "output_format": "int"},
            ],
        },
    )
    assert unsupported_format.status_code == 422

    valid = create_schema(client)
    assert valid["name"] == "invoice_basic"
    assert valid["fields"][0]["key_name"] == "invoice_number"

    region_schema = client.post(
        "/api/schemas",
        json={
            "name": "region_schema",
            "regions": [{"id": "region_1", "name": "Region 1", "page": 1, "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1}],
            "fields": [
                {
                    "key_name": "handwritten_name",
                    "description": "손글씨 이름 영역",
                    "output_format": "string",
                    "region_id": "region_1",
                },
            ],
        },
    )
    assert region_schema.status_code == 200, region_schema.text
    assert region_schema.json()["regions"][0]["x"] == 0.1
    assert region_schema.json()["fields"][0]["region_id"] == "region_1"

    invalid_region = client.post(
        "/api/schemas",
        json={
            "name": "invalid_region_schema",
            "regions": [{"id": "region_1", "name": "Region 1", "page": 1, "x": 0.8, "y": 0.2, "width": 0.3, "height": 0.1}],
            "fields": [
                {
                    "key_name": "handwritten_name",
                    "description": "손글씨 이름 영역",
                    "output_format": "string",
                    "region_id": "region_1",
                },
            ],
        },
    )
    assert invalid_region.status_code == 422

    korean_with_space = client.post(
        "/api/schemas",
        json={
            "name": "korean_schema",
            "fields": [
                {"key_name": "법정 대리인 성", "description": "우측 하단의 법정 대리인 성명", "output_format": "string"},
            ],
        },
    )
    assert korean_with_space.status_code == 200
    assert korean_with_space.json()["fields"][0]["key_name"] == "법정 대리인 성"

    screenshot_payload = client.post(
        "/api/schemas",
        json={
            "name": "document_schema",
            "fields": [
                {"key_name": "개정일", "description": "좌측 하단의 개정일자", "output_format": "date"},
                {"key_name": "본인 성명", "description": "우측 하단의 본인 성명", "output_format": "string"},
            ],
        },
    )
    assert screenshot_payload.status_code == 200, screenshot_payload.text
    assert screenshot_payload.json()["fields"][1]["key_name"] == "본인 성명"


def test_schema_update_replaces_current_schema(client) -> None:
    schema = create_schema(client)
    updated = client.patch(
        f"/api/schemas/{schema['id']}",
        json={
            "display_name": "Updated Invoice Basic",
            "fields": [
                {
                    "key_name": "invoice_number",
                    "description": "Invoice number near the top.",
                    "output_format": "string",
                },
                {
                    "key_name": "invoice_date",
                    "description": "Invoice issue date.",
                    "output_format": "date",
                },
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    payload = updated.json()
    assert "current_version" not in payload
    assert payload["display_name"] == "Updated Invoice Basic"
    assert payload["fields"][1]["key_name"] == "invoice_date"


def test_schema_update_allows_same_name_for_loaded_schema(client) -> None:
    schema = create_schema(client, name="테스트")
    updated = client.patch(
        f"/api/schemas/{schema['id']}",
        json={
            "name": "테스트",
            "display_name": "테스트",
            "description": "수정된 설명",
            "fields": [
                {
                    "key_name": "수정필드",
                    "description": "사용자가 저장된 스키마를 불러온 뒤 수정한 필드",
                    "output_format": "string",
                }
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    payload = updated.json()
    assert payload["id"] == schema["id"]
    assert payload["name"] == "테스트"
    assert payload["description"] == "수정된 설명"
    assert "current_version" not in payload
    assert payload["fields"][0]["key_name"] == "수정필드"


def test_schema_update_merges_duplicate_loaded_schema_name(client) -> None:
    from app.core.db import SessionLocal
    from app.models import Schema

    schema = create_schema(client, name="중복스키마")
    duplicate_schema_json = {
        "name": "중복스키마",
        "display_name": "중복스키마",
        "description": "old duplicate",
        "is_template": False,
        "template_category": None,
        "pinned": False,
        "regions": [],
        "fields": [
            {
                "key_name": "old_field",
                "description": "Old duplicate field.",
                "output_format": "string",
            }
        ],
    }
    db = SessionLocal()
    try:
        duplicate = Schema(
            name="중복스키마",
            display_name="중복스키마",
            description="old duplicate",
            current_version=1,
            schema_json=duplicate_schema_json,
            is_template=False,
            template_category=None,
            pinned=False,
            ephemeral=False,
        )
        db.add(duplicate)
        db.commit()
        duplicate_id = duplicate.id
    finally:
        db.close()

    updated = client.patch(
        f"/api/schemas/{schema['id']}",
        json={
            "name": "중복스키마",
            "display_name": "중복스키마",
            "description": "merged current schema",
            "fields": [
                {
                    "key_name": "current_field",
                    "description": "Current schema field.",
                    "output_format": "string",
                }
            ],
        },
    )
    assert updated.status_code == 200, updated.text
    schemas = [item for item in client.get("/api/schemas").json() if item["name"] == "중복스키마"]
    assert len(schemas) == 1
    assert schemas[0]["id"] == schema["id"]
    assert client.get(f"/api/schemas/{duplicate_id}").status_code == 404


def test_schema_delete_archives_and_allows_name_reuse(client) -> None:
    schema = create_schema(client, name="삭제테스트")
    deleted = client.delete(f"/api/schemas/{schema['id']}")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["archived"] is True

    listed_names = [item["name"] for item in client.get("/api/schemas").json()]
    assert "삭제테스트" not in listed_names

    archived = client.get(f"/api/schemas/{schema['id']}")
    assert archived.status_code == 200
    assert archived.json()["archived"] is True

    recreated = create_schema(client, name="삭제테스트")
    assert recreated["id"] != schema["id"]


def test_schema_duplicate_copies_definition_with_incremented_name(client) -> None:
    schema = create_schema(client, name="성명")
    duplicated = client.post(f"/api/schemas/{schema['id']}/duplicate")
    assert duplicated.status_code == 200, duplicated.text
    payload = duplicated.json()
    assert payload["id"] != schema["id"]
    assert payload["name"] == "성명 (1)"
    assert payload["display_name"] == "성명 (1)"
    assert payload["fields"] == schema["fields"]

    duplicated_again = client.post(f"/api/schemas/{schema['id']}/duplicate")
    assert duplicated_again.status_code == 200, duplicated_again.text
    assert duplicated_again.json()["name"] == "성명 (2)"


def test_schema_recommendation_mock_mode(mock_vlm, client) -> None:
    document = upload_png(client)
    response = client.post("/api/schemas/recommendations", json={"document_id": document["document_id"]})
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["name"] == "ai_recommended_schema"
    assert len(payload["fields"]) >= 3
    assert {field["output_format"] for field in payload["fields"]} <= {"string", "float", "date", "bool"}


def test_schema_description_recommendation_mock_mode(mock_vlm, client) -> None:
    response = client.post(
        "/api/schemas/description-recommendations",
        json={
            "name": "consent_schema",
            "current_description": "Old description",
            "fields": [
                {
                    "key_name": "본인 성명",
                    "description": "문서 하단 서명 영역의 본인 성명",
                    "output_format": "string",
                },
                {
                    "key_name": "동의 여부",
                    "description": "체크박스 선택 상태를 기준으로 한 동의 여부",
                    "output_format": "bool",
                },
            ],
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert "consent_schema" in payload["description"]
    assert "본인 성명" in payload["description"]
    assert payload["reasoning"]


def test_draft_extraction_does_not_list_schema(mock_vlm, client) -> None:
    document = upload_png(client)
    response = client.post(
        "/api/extraction-jobs/draft",
        json={
            "document_id": document["document_id"],
            "schema": {
                "name": "unsaved_draft_schema",
                "display_name": "Unsaved Draft Schema",
                "fields": [
                    {
                        "key_name": "draft_value",
                        "description": "Value visible in the draft document.",
                        "output_format": "string",
                    }
                ],
            },
        },
    )
    assert response.status_code == 200, response.text
    job = client.get(f"/api/extraction-jobs/{response.json()['job_id']}").json()
    assert job["status"] == "completed"
    assert job["result"]["validated_output"]["values"]["draft_value"]["value"] == "Sample draft_value"

    schemas = client.get("/api/schemas").json()
    assert all(item["name"] != "unsaved_draft_schema" for item in schemas)
    hidden_schema = client.get(f"/api/schemas/{job['schema_id']}")
    assert hidden_schema.status_code == 200
    assert hidden_schema.json()["ephemeral"] is True


def test_schema_name_conflict_and_clear_parsing_history(mock_vlm, client) -> None:
    schema = create_schema(client, name="conflict_schema")
    duplicate = client.post(
        "/api/schemas",
        json={
            "name": "conflict_schema",
            "fields": [
                {
                    "key_name": "other",
                    "description": "Other field.",
                    "output_format": "string",
                }
            ],
        },
    )
    assert duplicate.status_code == 409

    document = upload_png(client)
    job_response = client.post(
        "/api/extraction-jobs",
        json={"document_id": document["document_id"], "schema_id": schema["id"]},
    )
    assert job_response.status_code == 200
    job = client.get(f"/api/extraction-jobs/{job_response.json()['job_id']}").json()
    assert job["status"] == "completed"

    cleared = client.delete("/api/maintenance/parsing-history")
    assert cleared.status_code == 200, cleared.text
    payload = cleared.json()
    assert payload["status"] == "cleared"
    assert payload["counts"]["documents"] >= 1
    assert client.get("/api/documents").json() == []
    assert client.get("/api/extraction-jobs").json() == []
    assert any(item["id"] == schema["id"] for item in client.get("/api/schemas").json())
