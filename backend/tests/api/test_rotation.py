import io

from PIL import Image


def _wide_png(width: int = 40, height: int = 20) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (255, 255, 255)).save(buffer, format="PNG")
    return buffer.getvalue()


def _orientation(candidate: str, confidence: float):
    async def fake_detect(_candidate_inputs):
        return {"upright_candidate": candidate, "confidence": confidence, "reason": "test"}

    return fake_detect


def _upload_wide_png(client) -> dict:
    response = client.post("/api/documents", files={"file": ("scan.png", _wide_png(), "image/png")})
    assert response.status_code == 200, response.text
    document = response.json()
    assert document["status"] == "ready"
    return document


def _run_rotation_batch(client, document_id: str) -> dict:
    response = client.post("/api/rotation-batches/from-documents", json={"document_ids": [document_id]})
    assert response.status_code == 200, response.text
    batch = client.get(f"/api/rotation-batches/{response.json()['id']}")
    assert batch.status_code == 200, batch.text
    return batch.json()


def _page_image_size(client, document_id: str) -> tuple[int, int]:
    response = client.get(f"/api/documents/{document_id}/pages/1/image")
    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-cache"
    with Image.open(io.BytesIO(response.content)) as image:
        return image.size


def test_rotation_batch_keeps_upright_page_in_mock_mode(mock_vlm, client) -> None:
    document = _upload_wide_png(client)

    batch = _run_rotation_batch(client, document["document_id"])

    assert batch["status"] == "completed"
    assert batch["corrected_page_count"] == 0
    [item] = batch["items"]
    assert item["status"] == "completed"
    assert [page["status"] for page in item["pages"]] == ["upright"]
    assert _page_image_size(client, document["document_id"]) == (40, 20)


def test_rotation_batch_applies_confident_correction_in_place(mock_vlm, fake_vlm, client) -> None:

    fake_vlm.set(detect_page_orientation=_orientation("B", 0.95))
    document = _upload_wide_png(client)

    batch = _run_rotation_batch(client, document["document_id"])

    assert batch["status"] == "completed"
    assert batch["corrected_page_count"] == 1
    [page] = batch["items"][0]["pages"]
    assert page["status"] == "corrected"
    assert page["applied"] is True
    assert page["correction"] == 90
    assert page["detected_rotation"] == 270
    assert page["rotation_after"] == 90

    # Reading the document again must not "repair" the page back to the source orientation.
    refreshed = client.get(f"/api/documents/{document['document_id']}").json()
    assert refreshed["pages"][0]["rotation_applied"] == 90
    assert (refreshed["pages"][0]["width"], refreshed["pages"][0]["height"]) == (20, 40)
    assert _page_image_size(client, document["document_id"]) == (20, 40)

    summary = client.get(f"/api/rotation-batches/{batch['id']}/summary").json()
    assert summary["corrected_page_count"] == 1
    assert summary["items"] == []


def test_rotation_batch_low_confidence_needs_review_without_rotating(mock_vlm, fake_vlm, client) -> None:

    fake_vlm.set(detect_page_orientation=_orientation("C", 0.3))
    document = _upload_wide_png(client)

    batch = _run_rotation_batch(client, document["document_id"])

    assert batch["needs_review_count"] == 1
    [page] = batch["items"][0]["pages"]
    assert page["status"] == "low_confidence"
    assert page["applied"] is False
    assert _page_image_size(client, document["document_id"]) == (40, 20)


def test_rotation_batch_records_vlm_failure(mock_vlm, fake_vlm, client) -> None:

    async def broken_detect(_candidate_inputs):
        return {"upright_candidate": "E", "confidence": 0.9, "reason": "bad"}

    fake_vlm.set(detect_page_orientation=broken_detect)
    document = _upload_wide_png(client)

    batch = _run_rotation_batch(client, document["document_id"])

    assert batch["status"] == "completed_with_errors"
    [item] = batch["items"]
    assert item["status"] == "failed"
    assert "unknown orientation candidate" in item["error_message"]


def test_manual_page_rotation_accumulates_and_validates_degrees(mock_vlm, client) -> None:
    document = _upload_wide_png(client)
    url = f"/api/documents/{document['document_id']}/pages/1/rotate"

    rotated = client.post(url, json={"degrees": 90})
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["pages"][0]["rotation_applied"] == 90
    assert _page_image_size(client, document["document_id"]) == (20, 40)

    restored = client.post(url, json={"degrees": 270})
    assert restored.json()["pages"][0]["rotation_applied"] == 0
    assert _page_image_size(client, document["document_id"]) == (40, 20)

    invalid = client.post(url, json={"degrees": 45})
    assert invalid.status_code == 422
    missing = client.post(f"/api/documents/{document['document_id']}/pages/9/rotate", json={"degrees": 90})
    assert missing.status_code == 404


def test_rotation_batch_list_and_cancel(mock_vlm, client) -> None:
    document = _upload_wide_png(client)
    batch = _run_rotation_batch(client, document["document_id"])

    listed = client.get("/api/rotation-batches?limit=100&include_items=false")
    assert listed.status_code == 200, listed.text
    assert batch["id"] in {item["id"] for item in listed.json()}

    canceled = client.post(f"/api/rotation-batches/{batch['id']}/cancel")
    assert canceled.status_code == 200, canceled.text
    assert canceled.json()["status"] == "completed"
