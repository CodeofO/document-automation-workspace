from datetime import datetime

from app.models import (
    ExportJob,
)
from tests.support.api import (
    ONE_BY_ONE_PNG,
    create_schema,
    wait_for_export_job,
)


def test_export_job_batch_csv_download_mock_mode(mock_vlm, client) -> None:
    schema = create_schema(client, name="async_export_batch_schema")
    response = client.post(
        "/api/batches",
        data={"schema_id": schema["id"]},
        files=[("files", ("invoice.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert response.status_code == 200, response.text
    batch = response.json()

    create_job = client.post(
        "/api/export-jobs",
        json={"owner_type": "batch", "owner_id": batch["id"], "format": "csv"},
    )
    assert create_job.status_code == 202, create_job.text
    queued = create_job.json()
    assert queued["owner_type"] == "batch"
    assert queued["status"] in {"queued", "running", "completed"}

    completed = wait_for_export_job(client, queued["id"])
    assert completed["status"] == "completed", completed
    assert completed["filename"].endswith(".csv")
    assert completed["size_bytes"] > 0

    download = client.get(f"/api/export-jobs/{queued['id']}/download")
    assert download.status_code == 200, download.text
    assert download.content.startswith(b"\xef\xbb\xbf")
    assert "invoice_number" in download.text.splitlines()[0]
    assert "invoice.png" in download.text

    listed = client.get(f"/api/export-jobs?owner_type=batch&owner_id={batch['id']}&limit=5")
    assert listed.status_code == 200, listed.text
    assert queued["id"] in {item["id"] for item in listed.json()}

    missing_owner = client.post(
        "/api/export-jobs",
        json={"owner_type": "batch", "owner_id": "batch_missing", "format": "csv"},
    )
    assert missing_owner.status_code == 404


def test_export_job_retry_failed_job_mock_mode(mock_vlm, client) -> None:
    schema = create_schema(client, name="retry_export_batch_schema")
    response = client.post(
        "/api/batches",
        data={"schema_id": schema["id"]},
        files=[("files", ("retry.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert response.status_code == 200, response.text
    batch = response.json()

    from app.core.db import SessionLocal

    db = SessionLocal()
    source = ExportJob(
        owner_type="batch",
        owner_id=batch["id"],
        format="csv",
        status="failed",
        error_message="network timeout",
        started_at=datetime.utcnow(),
        completed_at=datetime.utcnow(),
    )
    db.add(source)
    db.commit()
    source_job_id = source.id
    db.close()

    retry = client.post(f"/api/export-jobs/{source_job_id}/retry")
    assert retry.status_code == 202, retry.text
    retried = retry.json()
    assert retried["id"] != source_job_id
    assert retried["owner_id"] == batch["id"]

    completed = wait_for_export_job(client, retried["id"])
    assert completed["status"] == "completed", completed

    failed_jobs = client.get(f"/api/export-jobs?owner_type=batch&owner_id={batch['id']}&status=failed")
    assert failed_jobs.status_code == 200, failed_jobs.text
    assert [item["id"] for item in failed_jobs.json()] == [source_job_id]

    retry_completed = client.post(f"/api/export-jobs/{completed['id']}/retry")
    assert retry_completed.status_code == 409


def test_export_job_worker_only_claims_queued_jobs() -> None:
    from app.core.db import SessionLocal
    from app.core.migrations import upgrade_database
    from app.infra.jobs.exports import run_export_job as _run_export_job

    upgrade_database()
    db = SessionLocal()
    job = ExportJob(
        owner_type="batch",
        owner_id="batch_missing",
        format="csv",
        status="running",
        started_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    _run_export_job(job_id)

    db = SessionLocal()
    try:
        loaded = db.get(ExportJob, job_id)
        assert loaded is not None
        assert loaded.status == "running"
        assert loaded.error_message is None
    finally:
        db.close()


def test_export_worker_recovers_interrupted_running_job_mock_mode(mock_vlm, client) -> None:
    schema = create_schema(client, name="recover_export_batch_schema")
    response = client.post(
        "/api/batches",
        data={"schema_id": schema["id"]},
        files=[("files", ("recover.png", ONE_BY_ONE_PNG, "image/png"))],
    )
    assert response.status_code == 200, response.text
    batch = response.json()

    from app.core.db import SessionLocal
    from app.infra.jobs.exports import run_export_job as _run_export_job
    from app.infra.jobs.recovery import recover_on_startup

    db = SessionLocal()
    job = ExportJob(
        owner_type="batch",
        owner_id=batch["id"],
        format="csv",
        status="running",
        started_at=datetime.utcnow(),
    )
    db.add(job)
    db.commit()
    job_id = job.id
    db.close()

    recover_on_startup()

    db = SessionLocal()
    try:
        recovered = db.get(ExportJob, job_id)
        assert recovered is not None
        assert recovered.status == "queued"
        assert recovered.error_message == "Recovered after server restart"
    finally:
        db.close()

    _run_export_job(job_id)

    db = SessionLocal()
    try:
        completed = db.get(ExportJob, job_id)
        assert completed is not None
        assert completed.status == "completed"
        assert completed.storage_path
        assert completed.size_bytes > 0
    finally:
        db.close()
