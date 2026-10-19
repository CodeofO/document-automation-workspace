"""The durable job queue, its runtimes and crash recovery."""

import asyncio
import threading
import time
from datetime import timedelta

from app.application.dispatch import JobDispatch
from app.background_jobs import enqueue_jobs
from app.core.clock import utcnow
from app.core.db import SessionLocal
from app.infra.jobs import queue
from app.infra.jobs.recovery import INTERRUPTED_MESSAGE, RECOVERED_MESSAGE, prepare_retry, recover_on_startup
from app.infra.jobs.runtime import AsyncioJobRuntime
from app.models import (
    Document,
    DocumentConversionJob,
    ExportJob,
    ExtractionJob,
    JobQueueEntry,
    Schema,
    WorkflowRun,
    WorkflowRunItem,
)
from tests.support.api import (
    ONE_BY_ONE_PNG,
    create_document_classifier,
    create_required_field_checklist,
    create_schema,
    workflow_definition,
)


def _queue_rows() -> list[JobQueueEntry]:
    db = SessionLocal()
    try:
        return db.query(JobQueueEntry).order_by(JobQueueEntry.created_at.asc(), JobQueueEntry.id.asc()).all()
    finally:
        db.close()


def _clear_queue() -> None:
    db = SessionLocal()
    try:
        db.query(JobQueueEntry).delete()
        db.commit()
    finally:
        db.close()


def test_enqueue_dedupes_queued_jobs_and_claim_is_exclusive() -> None:
    assert enqueue_jobs([JobDispatch("export_job", ("export_1",)), JobDispatch("export_job", ("export_1",))]) == 1
    assert enqueue_jobs(JobDispatch("extraction_batch", ("batch_1", ["job_1"]))) == 1
    assert enqueue_jobs(JobDispatch("extraction_batch", ("batch_1", ["job_1"]))) == 1  # batch dispatches are not deduplicated

    first = queue.claim_next("worker-a", ["export_job"], lease_seconds=30)
    assert first is not None and first.payload == ["export_1"] and first.attempts == 1 and first.target_id == "export_1"
    assert queue.claim_next("worker-b", ["export_job"], lease_seconds=30) is None
    # While it runs, the same export may be queued again (it runs after this one).
    assert enqueue_jobs(JobDispatch("export_job", ("export_1",))) == 1

    queue.finish(first.id, "worker-b")  # not the lease owner: ignored
    queue.finish(first.id, "worker-a")
    statuses = {row.id: row.status for row in _queue_rows()}
    assert statuses[first.id] == "done"


def test_expired_leases_are_requeued_and_exhausted_jobs_abandoned() -> None:
    enqueue_jobs([JobDispatch("export_job", ("e1",)), JobDispatch("export_job", ("e2",))])
    one = queue.claim_next("dead-worker", ["export_job"], lease_seconds=30)
    two = queue.claim_next("dead-worker", ["export_job"], lease_seconds=30)
    assert one and two
    db = SessionLocal()
    try:
        for row in db.query(JobQueueEntry).all():
            row.lease_expires_at = utcnow() - timedelta(seconds=1)
            if row.id == two.id:
                row.attempts = row.max_attempts
        db.commit()
    finally:
        db.close()

    abandoned = queue.requeue_expired()
    assert [job.id for job in abandoned] == [two.id]
    rows = {row.id: row for row in _queue_rows()}
    assert rows[one.id].status == "queued" and rows[one.id].lease_owner is None
    assert rows[two.id].status == "failed"

    retried = queue.claim_next("new-worker", ["export_job"], lease_seconds=30)
    assert retried is not None and retried.id == one.id and retried.attempts == 2


def _create_workflow_run(client, job_runners) -> dict:
    job_runners.set(workflow_run=lambda *args: None)
    schema = create_schema(client, name="recovery_schema")
    classifier = create_document_classifier(client, name="recovery_classifier")
    checklist = create_required_field_checklist(client, name="recovery_checklist")
    workflow = client.post(
        "/api/workflows",
        json={"name": "recovery_workflow", "definition": workflow_definition(schema["id"], classifier["id"], checklist["id"])},
    ).json()
    run = client.post(
        f"/api/workflows/{workflow['id']}/runs",
        files=[("files", ("a.png", ONE_BY_ONE_PNG, "image/png")), ("files", ("b.png", ONE_BY_ONE_PNG, "image/png"))],
    ).json()
    assert run["status"] == "running"
    return run


def test_startup_recovery_resumes_runs_conversions_exports_and_fails_orphan_jobs(client, job_runners) -> None:
    run = _create_workflow_run(client, job_runners)
    db = SessionLocal()
    try:
        run_row = db.get(WorkflowRun, run["id"])
        first, second = sorted(run_row.items, key=lambda item: item.filename)
        first.status = "running"  # was executing when the process died
        second.status = "completed"
        document = db.get(Document, first.document_id)
        schema = db.query(Schema).first()
        orphan = ExtractionJob(document_id=document.id, schema_id=schema.id, schema_version=1, status="running")
        export = ExportJob(owner_type="workflow_run", owner_id=run["id"], format="csv", status="running", started_at=utcnow())
        conversion = DocumentConversionJob(document_id=document.id, status="running", started_at=utcnow())
        db.add_all([orphan, export, conversion])
        db.commit()
        ids = {"orphan": orphan.id, "export": export.id, "conversion": conversion.id, "item": first.id}
        generation = run_row.execution_generation
    finally:
        db.close()
    _clear_queue()  # e.g. a database left behind by the old in-memory runtime

    recover_on_startup()

    db = SessionLocal()
    try:
        assert db.get(WorkflowRunItem, ids["item"]).status == "queued"
        orphan = db.get(ExtractionJob, ids["orphan"])
        assert (orphan.status, orphan.error_message) == ("failed", INTERRUPTED_MESSAGE)
        export = db.get(ExportJob, ids["export"])
        assert (export.status, export.error_message) == ("queued", RECOVERED_MESSAGE)
        assert db.get(DocumentConversionJob, ids["conversion"]).status == "queued"
    finally:
        db.close()
    queued = {(row.kind, row.target_id): row.payload for row in _queue_rows() if row.status == "queued"}
    assert queued[("workflow_run", run["id"])] == [run["id"], generation]
    assert ("export_job", ids["export"]) in queued
    assert ("document_conversion", ids["conversion"]) in queued

    # A second boot finds live queue entries and changes nothing.
    recover_on_startup()
    assert len([row for row in _queue_rows() if row.status == "queued"]) == len(queued)


def test_retry_of_interrupted_workflow_attempt_requeues_its_running_items(client, job_runners) -> None:
    run = _create_workflow_run(client, job_runners)
    db = SessionLocal()
    try:
        run_row = db.get(WorkflowRun, run["id"])
        for item in run_row.items:
            item.status = "running"
        db.commit()
        generation = run_row.execution_generation
    finally:
        db.close()

    prepare_retry("workflow_run", [run["id"], generation + 1])  # another generation: untouched
    db = SessionLocal()
    try:
        assert {item.status for item in db.get(WorkflowRun, run["id"]).items} == {"running"}
    finally:
        db.close()

    prepare_retry("workflow_run", [run["id"], generation])
    db = SessionLocal()
    try:
        assert {item.status for item in db.get(WorkflowRun, run["id"]).items} == {"queued"}
    finally:
        db.close()


def test_asyncio_runtime_runs_jobs_with_per_group_limits(job_runners, settings_env) -> None:
    settings_env(JOB_QUEUE_POLL_SECONDS="0.05", PREPROCESS_MAX_WORKERS="2")
    lock = threading.Lock()
    active = {"export": 0, "export_peak": 0, "conversion": 0, "conversion_peak": 0}
    finished: list[str] = []

    def tracked(group: str):
        def run(target_id: str) -> None:
            with lock:
                active[group] += 1
                active[f"{group}_peak"] = max(active[f"{group}_peak"], active[group])
            time.sleep(0.05)
            with lock:
                active[group] -= 1
                finished.append(target_id)

        return run

    async def failing_batch(batch_id: str, job_ids: list[str]) -> None:
        await asyncio.sleep(0)
        raise RuntimeError("boom")

    job_runners.set(export_job=tracked("export"), document_conversion=tracked("conversion"), extraction_batch=failing_batch)
    runtime = AsyncioJobRuntime()
    runtime.start()
    try:
        enqueue_jobs(
            [
                *(JobDispatch("export_job", (f"export_{index}",)) for index in range(3)),
                *(JobDispatch("document_conversion", (f"conversion_{index}",)) for index in range(4)),
                JobDispatch("extraction_batch", ("batch_x", [])),
            ]
        )
        runtime.wake()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            rows = _queue_rows()
            if rows and all(row.status in {"done", "failed"} for row in rows):
                break
            time.sleep(0.05)
    finally:
        runtime.stop()

    rows = _queue_rows()
    assert {row.target_id: row.status for row in rows} == {
        **{f"export_{index}": "done" for index in range(3)},
        **{f"conversion_{index}": "done" for index in range(4)},
        "batch_x": "failed",
    }
    assert next(row for row in rows if row.target_id == "batch_x").last_error == "RuntimeError: boom"
    assert active["export_peak"] == 1  # exports run one at a time
    assert active["conversion_peak"] <= 2  # PREPROCESS_MAX_WORKERS
    assert len(finished) == 7
