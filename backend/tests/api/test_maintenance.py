import os
from datetime import datetime, timedelta
from pathlib import Path

from app.models import (
    AuditEvent,
    Document,
    ExportJob,
    RawExtraction,
)
from tests.conftest import get_client
from tests.support.api import (
    XLSX_MIME,
    upload_png,
)


def test_retention_cleanup_removes_expired_uploads(settings_env) -> None:
    from app.core.db import SessionLocal

    settings_env(UPLOAD_RETENTION_HOURS="1")
    with get_client() as client:
        document = upload_png(client)
        db = SessionLocal()
        try:
            row = db.get(Document, document["document_id"])
            assert row is not None
            storage_path = row.storage_path
            extra_root = Path(storage_path).parent.parent / "retention-extra"
            raw_root = extra_root / "raw-expired"
            export_root = extra_root / "exports"
            raw_root.mkdir(parents=True, exist_ok=True)
            export_root.mkdir(parents=True, exist_ok=True)
            raw_source = raw_root / "content.bin"
            raw_pdf = raw_root / "preview.pdf"
            raw_html = raw_root / "preview.html"
            export_file = export_root / "workflow.xlsx"
            for path in [raw_source, raw_pdf, raw_html, export_file]:
                path.write_bytes(b"expired")
            row.created_at = datetime.utcnow() - timedelta(hours=2)
            for page in row.pages:
                page.created_at = datetime.utcnow() - timedelta(hours=2)
            raw = RawExtraction(
                filename="expired-source.docx",
                source_format="docx",
                size_bytes=7,
                storage_path=str(raw_source),
                pdf_path=str(raw_pdf),
                html_path=str(raw_html),
                status="completed",
                created_at=datetime.utcnow() - timedelta(hours=2),
            )
            export = ExportJob(
                owner_type="workflow_run",
                owner_id="expired-run",
                format="xlsx",
                status="completed",
                filename="workflow.xlsx",
                storage_path=str(export_file),
                content_type=XLSX_MIME,
                size_bytes=7,
                created_at=datetime.utcnow() - timedelta(hours=2),
            )
            audit = AuditEvent(
                entity_type="workflow_run",
                entity_id="expired-run",
                action="completed",
                message="expired audit",
                created_at=datetime.utcnow() - timedelta(hours=2),
            )
            db.add_all([raw, export, audit])
            db.commit()
            raw_id = raw.id
            export_id = export.id
            audit_id = audit.id
        finally:
            db.close()

        cleaned = client.post("/api/maintenance/retention-cleanup")
        assert cleaned.status_code == 200, cleaned.text
        payload = cleaned.json()
        assert payload["status"] == "cleaned"
        assert payload["counts"]["documents"] >= 1
        assert payload["counts"]["raw_extractions"] >= 1
        assert payload["counts"]["export_jobs"] >= 1
        assert payload["counts"]["audit_events"] >= 1
        assert client.get(f"/api/documents/{document['document_id']}").status_code == 404
        assert not os.path.exists(os.path.dirname(storage_path))
        assert not raw_root.exists()
        assert not export_root.exists()
        db = SessionLocal()
        try:
            assert db.get(RawExtraction, raw_id) is None
            assert db.get(ExportJob, export_id) is None
            assert db.get(AuditEvent, audit_id) is None
        finally:
            db.close()
