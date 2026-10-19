"""JSON columns keep the exact text format the app always wrote, so existing rows read unchanged."""

import json

from sqlalchemy import text

from app.core.db import SessionLocal, engine
from app.models import AuditEvent, ExtractionResult, WorkflowDefinition


def _raw(sql: str, **params) -> object:
    with engine.connect() as connection:
        return connection.execute(text(sql), params).scalar_one()


def test_written_text_matches_the_legacy_hand_written_format() -> None:
    metadata = {"name": "한글 값", "count": 2, "nested": {"list": [1, "둘"]}}
    db = SessionLocal()
    try:
        event = AuditEvent(entity_type="x", entity_id="1", action="created", metadata_json=metadata)
        db.add(event)
        db.commit()
        event_id = event.id
    finally:
        db.close()
    assert _raw("SELECT metadata_json FROM audit_events WHERE id = :id", id=event_id) == json.dumps(metadata, ensure_ascii=False)


def test_legacy_rows_read_back_as_values() -> None:
    definition = {"nodes": [{"id": "input", "data": {"label": "입력"}}], "edges": []}
    with engine.begin() as connection:
        connection.execute(
            text("INSERT INTO workflow_definitions (id, name, definition_json, archived) VALUES ('wf_legacy', 'legacy', :d, 0)"),
            {"d": json.dumps(definition, ensure_ascii=False)},
        )
        connection.execute(
            text("INSERT INTO audit_events (id, entity_type, entity_id, action, metadata_json) VALUES ('a_blank', 'x', '1', 'y', '')")
        )
    db = SessionLocal()
    try:
        assert db.get(WorkflowDefinition, "wf_legacy").definition_json == definition
        assert db.get(AuditEvent, "a_blank").metadata_json is None  # blank legacy text reads as "no value"
    finally:
        db.close()


def test_nullable_json_column_stores_sql_null() -> None:
    from app.models import Document, ExtractionJob, Schema

    db = SessionLocal()
    try:
        document = Document(filename="a.png", mime_type="image/png", size_bytes=1, storage_path="/tmp/a.png")
        schema = Schema(name="s", schema_json={"fields": []})
        db.add_all([document, schema])
        db.flush()
        job = ExtractionJob(document_id=document.id, schema_id=schema.id, schema_version=1)
        db.add(job)
        db.flush()
        result = ExtractionResult(job_id=job.id, raw_model_output={}, validated_output={"values": {}})
        db.add(result)
        db.commit()
        result_id = result.id
    finally:
        db.close()
    assert _raw("SELECT corrected_output IS NULL FROM extraction_results WHERE id = :id", id=result_id) == 1
    assert _raw("SELECT validation_warnings FROM extraction_results WHERE id = :id", id=result_id) == "[]"
    assert _raw("SELECT reviewed_fields FROM extraction_results WHERE id = :id", id=result_id) == "[]"
