import io
import time

try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover - compatibility for older PyMuPDF installs
    import fitz
from PIL import Image

from app.models import (
    Document,
)
from tests.conftest import get_client
from tests.support.api import (
    ONE_BY_ONE_PNG,
    make_docx_bytes,
    make_pdf_bytes,
    make_pptx_bytes,
    upload_png,
)


def test_upload_rejects_content_type_spoof(client) -> None:
    response = client.post(
        "/api/documents",
        files={"file": ("fake.png", b"not an image", "image/png")},
    )
    assert response.status_code == 415


def test_upload_rejects_file_size_over_limit(settings_env) -> None:
    settings_env(UPLOAD_MAX_FILE_BYTES="4")
    with get_client() as client:
        response = client.post(
            "/api/documents",
            files={"file": ("invoice.png", ONE_BY_ONE_PNG, "image/png")},
        )
        assert response.status_code == 413


def test_upload_downscales_preview_over_pixel_limit(settings_env) -> None:
    image = Image.new("RGB", (20, 10), (255, 255, 255))
    stream = io.BytesIO()
    image.save(stream, format="PNG")

    settings_env(UPLOAD_MAX_IMAGE_PIXELS="100", DOCUMENT_PAGE_MAX_LONG_EDGE="0")
    with get_client() as client:
        response = client.post(
            "/api/documents",
            files={"file": ("oversized.png", stream.getvalue(), "image/png")},
        )
        assert response.status_code == 200, response.text
        page = response.json()["pages"][0]
        assert page["width"] * page["height"] <= 100
        assert page["width"] * page["height"] <= 98


def test_image_upload(client) -> None:
    document = upload_png(client)
    assert document["page_count"] == 1
    assert document["created_at"]
    image = client.get(document["pages"][0]["image_url"])
    assert image.status_code == 200
    assert image.headers["content-type"] == "image/jpeg"
    thumbnail = client.get(f"/api/documents/{document['document_id']}/pages/1/thumbnail?width=96")
    assert thumbnail.status_code == 200
    assert thumbnail.headers["content-type"] == "image/jpeg"

    documents = client.get("/api/documents").json()
    assert any(item["document_id"] == document["document_id"] for item in documents)


def test_document_library_select_copy_move_and_folder_operations(client) -> None:
    from app.core.db import SessionLocal

    document = upload_png(client)
    document_id = document["document_id"]

    created_folder = client.post("/api/library/folders", json={"folder_path": "검수"})
    assert created_folder.status_code == 200, created_folder.text
    assert any(folder["path"] == "검수" for folder in created_folder.json()["folders"])

    moved = client.post(
        "/api/library/move",
        json={"document_ids": [document_id], "target_folder": "검수"},
    )
    assert moved.status_code == 200, moved.text
    moved_document = moved.json()["documents"][0]
    assert moved_document["document_id"] == document_id
    assert moved_document["library_path"] == "검수/invoice.png"

    ids = client.get("/api/documents/ids?library_path=검수").json()
    assert document_id in ids

    db = SessionLocal()
    try:
        original_row = db.get(Document, document_id)
        assert original_row is not None
        original_storage_path = original_row.storage_path
    finally:
        db.close()

    copied = client.post(
        "/api/library/copy",
        json={"document_ids": [document_id], "target_folder": "검수"},
    )
    assert copied.status_code == 200, copied.text
    copied_document = copied.json()["documents"][0]
    copied_document_id = copied_document["document_id"]
    assert copied_document_id != document_id
    assert copied_document["library_path"].startswith("검수/invoice copy")

    db = SessionLocal()
    try:
        copied_row = db.get(Document, copied_document_id)
        assert copied_row is not None
        assert copied_row.storage_path != original_storage_path
        assert copied_row.page_count == 1
        assert len(copied_row.pages) == 1
    finally:
        db.close()

    folder_copy = client.post(
        "/api/library/copy",
        json={"folder_paths": ["검수"], "target_folder": ""},
    )
    assert folder_copy.status_code == 200, folder_copy.text
    assert any(item["library_path"].startswith("검수 copy/") for item in folder_copy.json()["documents"])

    moved_folder = client.post(
        "/api/library/move",
        json={"folder_paths": ["검수 copy"], "target_folder": "완료"},
    )
    assert moved_folder.status_code == 200, moved_folder.text
    assert any(item["library_path"].startswith("완료/검수 copy/") for item in moved_folder.json()["documents"])

    deleted_original = client.delete(f"/api/documents/{document_id}")
    assert deleted_original.status_code == 200, deleted_original.text
    copied_payload = client.get(f"/api/documents/{copied_document_id}")
    assert copied_payload.status_code == 200, copied_payload.text
    page_response = client.get(copied_payload.json()["pages"][0]["image_url"])
    assert page_response.status_code == 200

    bulk_deleted = client.post("/api/documents/delete", json={"document_ids": [copied_document_id]})
    assert bulk_deleted.status_code == 200, bulk_deleted.text
    assert bulk_deleted.json()["documents"][0]["status"] == "deleted"
    assert client.get(copied_payload.json()["pages"][0]["image_url"]).status_code == 410


def test_jpeg_upload_preserves_source_pixels_with_dpi_metadata() -> None:
    image = Image.new("RGB", (300, 420), (255, 255, 255))
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", dpi=(300, 300))

    with get_client() as client:
        response = client.post(
            "/api/documents",
            files={"file": ("scan.jpg", buffer.getvalue(), "image/jpeg")},
        )
        assert response.status_code == 200, response.text
        document = response.json()
        assert document["pages"][0]["width"] == 300
        assert document["pages"][0]["height"] == 420
        image_response = client.get(document["pages"][0]["image_url"])
        assert image_response.status_code == 200
        loaded = Image.open(io.BytesIO(image_response.content))
        assert loaded.size == (300, 420)


def test_pdf_upload(client) -> None:
    pdf_bytes = make_pdf_bytes()
    response = client.post(
        "/api/documents",
        files={"file": ("invoice.pdf", pdf_bytes, "application/pdf")},
    )
    assert response.status_code == 200
    document = response.json()
    assert document["page_count"] == 1
    assert document["pages"][0]["width"] > 0
    assert document["pages"][0]["height"] > 0


def test_office_upload_for_key_information_extractor(monkeypatch, client) -> None:
    def fake_convert(source_path, suffix, pdf_path):
        document = fitz.open()
        page = document.new_page(width=240, height=120)
        page.insert_text((24, 60), f"Converted {source_path.name}")
        document.save(pdf_path)
        document.close()

    monkeypatch.setattr("app.document_processor.convert_office_to_pdf", fake_convert)

    samples = [
        ("report.docx", make_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
        ("deck.pptx", make_pptx_bytes(), "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
    ]
    for filename, data, mime_type in samples:
        response = client.post(
            "/api/documents",
            files={"file": (filename, data, mime_type)},
        )
        assert response.status_code == 200, response.text
        document = response.json()
        assert document["filename"] == filename
        assert document["page_count"] == 1
        image = client.get(document["pages"][0]["image_url"])
        assert image.status_code == 200
        assert image.headers["content-type"] == "image/jpeg"


def test_library_upload_queues_conversion_and_documents_become_ready(client) -> None:
    response = client.post(
        "/api/library/uploads",
        files=[
            ("files", ("first.png", ONE_BY_ONE_PNG, "image/png")),
            ("files", ("second.png", ONE_BY_ONE_PNG, "image/png")),
        ],
        data={"library_paths": ["inbox/first.png", "inbox/second.png"]},
    )
    assert response.status_code == 200, response.text
    documents = response.json()["documents"]
    assert [document["library_path"] for document in documents] == ["inbox/first.png", "inbox/second.png"]
    assert all(document["status"] in {"queued", "preprocessing", "ready"} for document in documents)

    for document in documents:
        for _ in range(200):
            current = client.get(f"/api/documents/{document['document_id']}").json()
            if current["status"] == "ready":
                break
            time.sleep(0.02)
        assert current["status"] == "ready", current
        assert current["page_count"] == 1

    tree = client.get("/api/library/tree").json()
    assert "inbox" in [folder["path"] for folder in tree["folders"]]


def test_library_upload_requires_files(client) -> None:
    response = client.post("/api/library/uploads", data={"library_paths": ["a.png"]})
    assert response.status_code == 400
    assert response.json() == {"detail": "At least one file is required"}
