#!/usr/bin/env python3
"""Run a large mock workflow through the real API and verify summary polling plus export.

Everything goes through the app's HTTP routes (schema/classifier/checklist/workflow
creation, chunked upload, start, summary, CSV export) with ``VLM_PROVIDER=mock`` and the
inline job runtime the backend tests use, against a throwaway DB and storage directory.
"""

from __future__ import annotations

import argparse
import base64
import csv
import io
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

ONE_BY_ONE_PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify large workflow summary/export paths without calling a VLM provider.")
    parser.add_argument("--count", type=int, default=1000, help="Number of documents to run through the workflow.")
    parser.add_argument("--work-dir", default="", help="Optional directory for the temporary DB and storage.")
    args = parser.parse_args()
    if args.count < 1:
        raise SystemExit("--count must be positive")

    root = Path(__file__).resolve().parents[1]
    owns_work_dir = not args.work_dir
    work_dir = Path(args.work_dir).resolve() if args.work_dir else Path(tempfile.mkdtemp(prefix="daw_large_smoke_"))
    work_dir.mkdir(parents=True, exist_ok=True)

    # The engine and settings are created at import time, so the environment must be set
    # before anything under ``app`` is imported.
    os.environ.update(
        {
            "APP_ENV": "local",
            "DATABASE_URL": f"sqlite:///{work_dir / 'large.db'}",
            "DOCUMENT_STORAGE_DIR": str(work_dir / "documents"),
            "RAW_STORAGE_DIR": str(work_dir / "raw"),
            "PROCESSING_TMP_DIR": str(work_dir / "processing"),
            "VLM_PROVIDER": "mock",
            "VLM_MODEL_NAME": "mock-vlm",
        }
    )
    sys.path.insert(0, str(root / "backend"))

    from app.core.config import get_settings
    from app.core.db import engine
    from app.core.migrations import upgrade_database
    from app.infra.jobs.runtime import InlineJobRuntime, set_job_runtime
    from app.main import app
    from fastapi.testclient import TestClient

    try:
        get_settings.cache_clear()
        upgrade_database()
        # Jobs run synchronously in the thread that queues them, so the run is finished as
        # soon as the start request returns.
        set_job_runtime(InlineJobRuntime())
        # Upload in the same chunk size the frontend uses; the multipart field limit is
        # derived from it.
        chunk_size = max(1, get_settings().upload_chunk_files)
        started_at = time.perf_counter()
        with TestClient(app) as client:
            workflow_id = create_workflow(client)
            init = assert_ok(client.post(f"/api/workflows/{workflow_id}/runs/init", json={"total_count": args.count}), "run init")
            run_id = init["id"]

            for chunk_start in range(0, args.count, chunk_size):
                indexes = range(chunk_start, min(chunk_start + chunk_size, args.count))
                names = [filename(index) for index in indexes]
                assert_ok(
                    client.post(
                        f"/api/workflow-runs/{run_id}/items",
                        data={"client_file_ids": [f"{index}:{name}:{len(ONE_BY_ONE_PNG)}:1" for index, name in zip(indexes, names, strict=True)]},
                        files=[("files", (name, ONE_BY_ONE_PNG, "image/png")) for name in names],
                    ),
                    f"upload chunk {chunk_start}",
                )
            uploaded_at = time.perf_counter()

            assert_ok(client.post(f"/api/workflow-runs/{run_id}/start"), "run start")
            processed_at = time.perf_counter()

            summary = assert_ok(client.get(f"/api/workflow-runs/{run_id}/summary"), "workflow summary")
            if summary["items"] != []:
                raise AssertionError("summary endpoint returned item payloads")
            finished = summary["completed_count"] + summary["needs_review_count"]
            if summary["total_count"] != args.count or finished != args.count or summary["failed_count"]:
                raise AssertionError(f"unexpected summary counters: {summary}")
            if summary["status"] not in {"completed", "needs_review"}:
                raise AssertionError(f"unexpected run status: {summary['status']}")

            csv_response = client.get(f"/api/workflow-runs/{run_id}/export?format=csv")
            if csv_response.status_code != 200:
                raise AssertionError(f"csv export failed: {csv_response.status_code} {csv_response.text[:200]}")
            rows = list(csv.DictReader(io.StringIO(csv_response.content.decode("utf-8-sig"))))
            header = list(rows[0]) if rows else []
            missing = [column for column in ("filename", "class_name", "kie_invoice_number", "required_서명_status") if column not in header]
            if missing:
                raise AssertionError(f"csv export is missing columns {missing}: {header}")
            if len(rows) != args.count:
                raise AssertionError(f"csv export has {len(rows)} rows, expected {args.count}")
            if [row["filename"] for row in rows] != [filename(index) for index in range(args.count)]:
                raise AssertionError("csv export rows are not in upload order")
        exported_at = time.perf_counter()

        print(
            f"large mock smoke passed: count={args.count} status={summary['status']} "
            f"completed={summary['completed_count']} needs_review={summary['needs_review_count']} "
            f"upload={uploaded_at - started_at:.1f}s run={processed_at - uploaded_at:.1f}s "
            f"summary+export={exported_at - processed_at:.1f}s work_dir={work_dir}"
        )
        return 0
    finally:
        set_job_runtime(None)
        engine.dispose()
        if owns_work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
            print(f"ephemeral large-smoke DB/storage removed: {work_dir}")


def filename(index: int) -> str:
    return f"document_{index:05d}.png"


def create_workflow(client) -> str:
    schema = assert_ok(
        client.post(
            "/api/schemas",
            json={
                "name": "large_smoke_invoice",
                "display_name": "Large Smoke Invoice",
                "fields": [
                    {"key_name": "invoice_number", "description": "Invoice number near the top of the document.", "output_format": "string"},
                    {"key_name": "total_amount", "description": "Final total amount including tax.", "output_format": "float"},
                ],
            },
        ),
        "schema create",
    )
    classifier = assert_ok(
        client.post(
            "/api/document-classifiers",
            json={
                "name": "large_smoke_classifier",
                "description": "Classify the document into one of the user-defined classes.",
                "allow_unknown": True,
                "classes": [
                    {"class_name": "contract", "description": "Contract with terms and a signature or stamp", "signals": ["contract", "signature"]},
                    {"class_name": "consent_form", "description": "Consent form for personal information", "signals": ["consent"]},
                ],
            },
        ),
        "classifier create",
    )
    checklist = assert_ok(
        client.post(
            "/api/required-field-checklists",
            json={
                "name": "large_smoke_checklist",
                "description": "Check that required items are present.",
                "items": [
                    {"item_name": "성명", "description": "Name is present.", "evidence_type": "text_or_handwriting", "required": True},
                    {"item_name": "서명", "description": "Signature or stamp is present.", "evidence_type": "signature_or_stamp", "required": True},
                ],
            },
        ),
        "checklist create",
    )
    nodes = [
        ("input", "input", {}),
        ("classifier", "classifier", {"classifier_id": classifier["id"]}),
        ("branch", "branch", {}),
        ("kie_contract", "kie", {"schema_id": schema["id"]}),
        ("required_contract", "required-checker", {"checklist_id": checklist["id"]}),
        ("merge", "merge", {}),
        ("export", "export", {}),
    ]
    edges = [
        ("input", "classifier", None),
        ("classifier", "branch", None),
        ("branch", "kie_contract", "class:contract"),
        ("branch", "merge", "class:consent_form"),
        ("branch", "merge", "unknown"),
        ("kie_contract", "required_contract", None),
        ("required_contract", "merge", None),
        ("merge", "export", None),
    ]
    definition = {
        "nodes": [
            {"id": node_id, "position": {"x": 220 * index, "y": 120}, "data": {"kind": kind, "label": node_id, "config": config}}
            for index, (node_id, kind, config) in enumerate(nodes)
        ],
        "edges": [
            {"id": f"{source}-{target}-{handle or 'default'}", "source": source, "target": target, **({"sourceHandle": handle} if handle else {})}
            for source, target, handle in edges
        ],
    }
    workflow = assert_ok(client.post("/api/workflows", json={"name": "large_mock_smoke_workflow", "definition": definition}), "workflow create")
    return workflow["id"]


def assert_ok(response, label: str):
    if response.status_code != 200:
        raise AssertionError(f"{label} failed: {response.status_code} {response.text[:500]}")
    return response.json()


if __name__ == "__main__":
    raise SystemExit(main())
