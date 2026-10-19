try:
    import pymupdf as fitz
except ImportError:  # pragma: no cover - compatibility for older PyMuPDF installs
    import fitz

from tests.support.api import (
    make_docx_bytes,
    make_pdf_bytes,
    make_pdf_with_image_bytes,
    make_pptx_bytes,
    make_pptx_with_image_bytes,
    make_xlsx_bytes,
    make_xlsx_formula_bytes,
)


def test_raw_dependency_imports() -> None:
    import bleach  # noqa: F401
    import mammoth  # noqa: F401
    import openpyxl  # noqa: F401
    import pptx  # noqa: F401


def test_raw_extraction_pdf_upload(client) -> None:
    response = client.post(
        "/api/raw-extractions",
        files={"file": ("sample.pdf", make_pdf_bytes(), "application/pdf")},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["source_format"] == "pdf"
    assert payload["pdf_url"]
    assert payload["html_url"]

    pdf = client.get(payload["pdf_url"])
    assert pdf.status_code == 200
    assert pdf.headers["content-type"] == "application/pdf"

    html_response = client.get(payload["html_url"])
    assert html_response.status_code == 200
    assert "Invoice No. INV-2026-001" in html_response.text

    recent = client.get("/api/raw-extractions").json()
    assert any(item["id"] == payload["id"] for item in recent)


def test_raw_extraction_pdf_upload_with_images_option(client) -> None:
    response = client.post(
        "/api/raw-extractions",
        data={"include_images": "true"},
        files={"file": ("sample.pdf", make_pdf_with_image_bytes(), "application/pdf")},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"

    html_response = client.get(payload["html_url"])
    assert html_response.status_code == 200
    assert "data:image/png;base64" in html_response.text


def test_raw_extraction_pdf_upload_includes_images_by_default(client) -> None:
    response = client.post(
        "/api/raw-extractions",
        files={"file": ("sample.pdf", make_pdf_with_image_bytes(), "application/pdf")},
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed"

    html_response = client.get(payload["html_url"])
    assert html_response.status_code == 200
    assert "data:image/png;base64" in html_response.text


def test_raw_extraction_pptx_upload_with_images_option(monkeypatch, client) -> None:
    def fake_convert(source_path, suffix, pdf_path):
        document = fitz.open()
        page = document.new_page(width=240, height=120)
        page.insert_text((24, 60), f"Preview for {source_path.name}")
        document.save(pdf_path)
        document.close()

    monkeypatch.setattr("app.raw_extractor.convert_office_to_pdf", fake_convert)

    response = client.post(
        "/api/raw-extractions",
        data={"include_images": "true"},
        files={
            "file": (
                "deck_with_image.pptx",
                make_pptx_with_image_bytes(),
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            )
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed", payload
    html_response = client.get(payload["html_url"])
    assert html_response.status_code == 200
    assert "data:image/png;base64" in html_response.text


def test_raw_extraction_office_uploads(monkeypatch, client) -> None:
    def fake_convert(source_path, suffix, pdf_path):
        document = fitz.open()
        page = document.new_page(width=240, height=120)
        page.insert_text((24, 60), f"Preview for {source_path.name}")
        document.save(pdf_path)
        document.close()

    monkeypatch.setattr("app.raw_extractor.convert_office_to_pdf", fake_convert)

    samples = [
        ("report.docx", make_docx_bytes(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "Quarterly Report"),
        ("book.xlsx", make_xlsx_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Revenue"),
        ("deck.pptx", make_pptx_bytes(), "application/vnd.openxmlformats-officedocument.presentationml.presentation", "Roadmap"),
    ]
    for filename, data, mime_type, expected_text in samples:
        response = client.post(
            "/api/raw-extractions",
            files={"file": (filename, data, mime_type)},
        )
        assert response.status_code == 200, response.text
        payload = response.json()
        assert payload["status"] == "completed", payload
        assert payload["pdf_url"]
        assert payload["html_url"]
        assert client.get(payload["pdf_url"]).status_code == 200
        html_response = client.get(payload["html_url"])
        assert html_response.status_code == 200
        assert expected_text in html_response.text


def test_raw_extraction_xlsx_formula_option(monkeypatch, client) -> None:
    def fake_convert(source_path, suffix, pdf_path):
        document = fitz.open()
        page = document.new_page(width=240, height=120)
        page.insert_text((24, 60), f"Preview for {source_path.name}")
        document.save(pdf_path)
        document.close()

    monkeypatch.setattr("app.raw_extractor.convert_office_to_pdf", fake_convert)

    response = client.post(
        "/api/raw-extractions",
        data={"include_formulas": "true"},
        files={
            "file": (
                "book.xlsx",
                make_xlsx_formula_bytes(),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        },
    )
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["status"] == "completed", payload
    html_response = client.get(payload["html_url"])
    assert html_response.status_code == 200
    assert "=SUM(B2:B2)" in html_response.text
