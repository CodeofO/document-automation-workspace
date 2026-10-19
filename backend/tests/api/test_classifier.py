from tests.conftest import get_client
from tests.support.api import (
    ONE_BY_ONE_PNG,
    assert_xlsx_response,
    create_document_classifier,
    upload_png,
)


def test_document_classifier_config_single_job_and_patch(mock_vlm, client) -> None:
    classifier = create_document_classifier(client)
    updated = client.patch(
        f"/api/document-classifiers/{classifier['id']}",
        json={
            "description": "Updated classifier description",
            "allow_unknown": True,
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["description"] == "Updated classifier description"

    document = upload_png(client)
    response = client.post(
        "/api/classification-jobs",
        json={"document_id": document["document_id"], "classifier_id": classifier["id"]},
    )
    assert response.status_code == 200, response.text
    job = client.get(f"/api/classification-jobs/{response.json()['job_id']}").json()
    assert job["status"] == "completed"
    output = job["result"]["validated_output"]
    assert output["status"] == "classified"
    assert output["class_name"] == "contract"
    assert output["confidence"] == 0.88

    corrected = {**output, "status": "unknown", "class_name": None}
    patch = client.patch(
        f"/api/classification-results/{job['result_id']}",
        json={"corrected_output": corrected, "reviewed": True},
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["corrected_output"]["status"] == "unknown"

    deleted = client.delete(f"/api/document-classifiers/{classifier['id']}")
    assert deleted.status_code == 200
    assert deleted.json()["archived"] is True
    assert all(item["id"] != classifier["id"] for item in client.get("/api/document-classifiers").json())


def test_document_classifier_duplicate_copies_classes(client) -> None:
    classifier = create_document_classifier(client, name="신청서 분류")
    duplicated = client.post(f"/api/document-classifiers/{classifier['id']}/duplicate")
    assert duplicated.status_code == 200, duplicated.text
    payload = duplicated.json()
    assert payload["id"] != classifier["id"]
    assert payload["name"] == "신청서 분류 (1)"
    assert payload["classes"] == classifier["classes"]
    assert payload["allow_unknown"] == classifier["allow_unknown"]


def test_document_classifier_batch_cancel_and_export(settings_env, job_runners) -> None:
    job_runners.set(classification_batch=lambda batch_id, job_ids: None)
    with get_client() as client:
        classifier = create_document_classifier(client)
        response = client.post(
            "/api/classification-batches",
            data={"classifier_id": classifier["id"]},
            files=[
                ("files", ("z_last.png", ONE_BY_ONE_PNG, "image/png")),
                ("files", ("a_first.png", ONE_BY_ONE_PNG, "image/png")),
            ],
        )
        assert response.status_code == 200, response.text
        batch = response.json()
        assert [item["filename"] for item in batch["items"]] == ["a_first.png", "z_last.png"]

        canceled = client.post(f"/api/classification-batches/{batch['id']}/cancel")
        assert canceled.status_code == 200, canceled.text
        assert canceled.json()["status"] == "canceled"
        assert canceled.json()["canceled_count"] == 2
        assert canceled.json()["completed_at"] is not None

    job_runners.reset()
    settings_env(VLM_PROVIDER="mock")
    with get_client() as client:
        classifier = create_document_classifier(client, name="batch_classifier")
        response = client.post(
            "/api/classification-batches",
            data={"classifier_id": classifier["id"]},
            files=[
                ("files", ("z_last.png", ONE_BY_ONE_PNG, "image/png")),
                ("files", ("a_first.png", ONE_BY_ONE_PNG, "image/png")),
            ],
        )
        assert response.status_code == 200, response.text
        batch = response.json()
        loaded = client.get(f"/api/classification-batches/{batch['id']}").json()
        assert loaded["status"] == "completed"
        assert loaded["completed_count"] == 2

        csv_response = client.get(f"/api/classification-batches/{batch['id']}/export?format=csv")
        assert csv_response.status_code == 200, csv_response.text
        assert csv_response.content.startswith(b"\xef\xbb\xbf")
        assert "charset=utf-8" in csv_response.headers["content-type"]
        assert "classification_status,class_name,confidence,reason,evidence" in csv_response.text.splitlines()[0]
        assert csv_response.text.index("a_first.png") < csv_response.text.index("z_last.png")

        json_response = client.get(f"/api/classification-batches/{batch['id']}/export?format=json")
        assert json_response.status_code == 200
        rows = json_response.json()["rows"]
        assert [row["filename"] for row in rows] == ["a_first.png", "z_last.png"]
        assert rows[0]["class_name"] == "contract"

        xlsx_response = client.get(f"/api/classification-batches/{batch['id']}/export?format=xlsx")
        assert_xlsx_response(xlsx_response)
