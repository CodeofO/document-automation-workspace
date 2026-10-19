#!/usr/bin/env python3
"""Run a workflow UI smoke (create assets/workflow, run, export, screenshots) against an ephemeral database.

Test documents are generated on the fly with Pillow; nothing is read from the repository.
"""

from __future__ import annotations

import argparse
import http.client
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

TERMINAL_RUN_STATUSES = {"completed", "completed_with_errors", "needs_review", "failed", "canceled"}
TERMINAL_EXPORT_STATUSES = {"completed", "failed"}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify workflow create/run/export and UI routes without writing to the project DB."
    )
    parser.add_argument("--skip-browser", action="store_true", help="Run only API checks and skip Chrome screenshots.")
    parser.add_argument("--keep-work-dir", action="store_true", help="Keep the temporary DB/storage directory for debugging.")
    parser.add_argument("--artifact-dir", default="", help="Directory where screenshots should be written.")
    parser.add_argument("--browser-timeout", type=float, default=30.0, help="Timeout in seconds for each Chrome screenshot.")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    python_bin = root / ".venv" / "bin" / "python"
    if not python_bin.exists():
        print(f"Python virtualenv not found: {python_bin}", file=sys.stderr)
        return 2

    work_dir = Path(tempfile.mkdtemp(prefix="daw_poc_ui_smoke_"))
    artifact_dir = Path(args.artifact_dir).resolve() if args.artifact_dir else Path(
        tempfile.mkdtemp(prefix="daw_poc_ui_screens_")
    )
    artifact_dir.mkdir(parents=True, exist_ok=True)
    backend_port = _free_port()
    frontend_port = _free_port()
    backend_base = f"http://127.0.0.1:{backend_port}"
    frontend_base = f"http://127.0.0.1:{frontend_port}"
    processes: list[subprocess.Popen[str]] = []
    db_path = work_dir / "poc_ui.db"

    try:
        backend_env = os.environ.copy()
        backend_env.update(
            {
                "APP_ENV": "local",
                "DATABASE_URL": f"sqlite:///{db_path}",
                "DOCUMENT_STORAGE_DIR": str(work_dir / "documents"),
                "RAW_STORAGE_DIR": str(work_dir / "raw"),
                "PROCESSING_TMP_DIR": str(work_dir / "processing"),
                "EXPORT_STORAGE_DIR": str(work_dir / "exports"),
                "VLM_PROVIDER": "mock",
                "VLM_MODEL_NAME": "mock-vlm",
                "UPLOAD_RETENTION_HOURS": "24",
                "PYTHONUNBUFFERED": "1",
            }
        )
        frontend_env = os.environ.copy()
        frontend_env.update({"VITE_API_BASE_URL": backend_base})

        processes.append(
            subprocess.Popen(
                [
                    str(python_bin),
                    "-m",
                    "uvicorn",
                    "app.main:app",
                    "--app-dir",
                    "backend",
                    "--host",
                    "127.0.0.1",
                    "--port",
                    str(backend_port),
                ],
                cwd=root,
                env=backend_env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.STDOUT,
                text=True,
            )
        )
        _wait_for_url(f"{backend_base}/api/health", "backend health", processes[0])

        processes.append(
            subprocess.Popen(
                ["npm", "run", "dev", "--", "--host", "127.0.0.1", "--port", str(frontend_port)],
                cwd=root / "frontend",
                env=frontend_env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.STDOUT,
                text=True,
            )
        )
        _wait_for_url(frontend_base, "frontend dev server", processes[1])

        workflow = _create_review_workflow(backend_base)
        document_ids = [
            _upload_library_image(backend_base, f"smoke_document_{index + 1}.png", _make_document_png(index))
            for index in range(3)
        ]
        for document_id in document_ids:
            _wait_for_document_ready(backend_base, document_id)

        run = _api_json(
            backend_base,
            "POST",
            f"/api/workflows/{workflow['id']}/runs/from-documents",
            {"document_ids": document_ids},
        )
        run = _wait_for_workflow_terminal(backend_base, run["id"])
        if run["status"] in {"failed", "canceled"}:
            raise AssertionError(f"workflow ended in {run['status']}: {run.get('error_message')}")

        export_job = _api_json(
            backend_base,
            "POST",
            "/api/export-jobs",
            {"owner_type": "workflow_run", "owner_id": run["id"], "format": "xlsx"},
            expected_status=202,
        )
        export_job = _wait_for_export_job(backend_base, export_job["id"])
        if export_job["status"] != "completed":
            raise AssertionError(f"export failed: {export_job.get('error_message')}")
        _assert_xlsx_download(backend_base, export_job["id"])

        screenshot_paths: list[Path] = []
        if not args.skip_browser:
            screenshot_paths = _capture_ui_screenshots(frontend_base, run["id"], artifact_dir, args.browser_timeout)

        if not db_path.exists():
            raise AssertionError(f"ephemeral database was not created: {db_path}")
        print(f"workflow ui smoke passed: db={db_path}")
        if screenshot_paths:
            print("screenshots:")
            for screenshot_path in screenshot_paths:
                print(f"  {screenshot_path}")
        return 0
    finally:
        for process in reversed(processes):
            _terminate(process)
        if not args.keep_work_dir:
            shutil.rmtree(work_dir, ignore_errors=True)
            print(f"ephemeral DB/storage removed: {work_dir}")


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _wait_for_url(url: str, label: str, process: subprocess.Popen[str], timeout: float = 45.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise AssertionError(f"{label} process exited with {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if 200 <= response.status < 400:
                    return
        except (OSError, http.client.HTTPException):
            # Not up yet: connection refused/reset, timeouts and HTTP errors (URLError and
            # HTTPError are OSError subclasses) all mean "retry shortly".
            time.sleep(0.25)
    raise AssertionError(f"{label} did not respond at {url}")


def _api_json(
    base_url: str,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
    *,
    expected_status: int = 200,
) -> dict[str, Any]:
    body = None
    headers: dict[str, str] = {}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(f"{base_url}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            data = response.read()
            if response.status != expected_status:
                raise AssertionError(f"{method} {path} returned {response.status}: {data[:200]!r}")
            return json.loads(data.decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise AssertionError(f"{method} {path} returned {exc.code}: {detail[:500]}") from exc


def _api_multipart(base_url: str, path: str, fields: dict[str, str], files: list[tuple[str, str, bytes, str]]) -> dict[str, Any]:
    boundary = f"----smoke{uuid.uuid4().hex}"
    body = io.BytesIO()
    for name, value in fields.items():
        body.write(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n".encode())
    for field, filename, content, content_type in files:
        body.write(
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{filename}\"\r\n"
            f"Content-Type: {content_type}\r\n\r\n".encode()
        )
        body.write(content)
        body.write(b"\r\n")
    body.write(f"--{boundary}--\r\n".encode())
    request = urllib.request.Request(
        f"{base_url}{path}",
        data=body.getvalue(),
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise AssertionError(f"POST {path} returned {exc.code}: {detail[:500]}") from exc


def _make_document_png(seed: int) -> bytes:
    """Deterministic document-like page: title bar, text lines, signature box."""
    from PIL import Image, ImageDraw

    width, height = 620, 860
    image = Image.new("L", (width, height), 255)
    draw = ImageDraw.Draw(image)
    draw.rectangle((60, 50, width - 60, 86), fill=40)
    for line in range(14):
        length = 180 + ((line * 97 + seed * 53) % (width - 300))
        top = 130 + line * 34
        draw.rectangle((60, top, 60 + length, top + 12), fill=90)
    draw.rectangle((int(width * 0.55), int(height * 0.74), int(width * 0.9), int(height * 0.88)), outline=30, width=3)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def _upload_library_image(base_url: str, filename: str, content: bytes) -> str:
    payload = _api_multipart(base_url, "/api/library/uploads", {"library_paths": filename}, [("files", filename, content, "image/png")])
    documents = payload.get("documents") or []
    if not documents:
        raise AssertionError(f"library upload returned no documents: {payload}")
    return str(documents[0]["document_id"])


def _create_review_workflow(base_url: str) -> dict[str, Any]:
    """Create schema/classifier/checklist and a classify → branch → KIE/required → merge → export workflow."""
    suffix = uuid.uuid4().hex[:8]
    schema = _api_json(
        base_url,
        "POST",
        "/api/schemas",
        {
            "name": f"smoke_document_fields_{suffix}",
            "description": "Smoke-test document fields.",
            "fields": [
                {"key_name": "document_number", "description": "Document or receipt number.", "output_format": "string"},
                {"key_name": "applicant", "description": "Applicant name.", "output_format": "string"},
                {"key_name": "issued_on", "description": "Issue or application date.", "output_format": "date"},
            ],
        },
    )
    classifier = _api_json(
        base_url,
        "POST",
        "/api/document-classifiers",
        {
            "name": f"smoke_classifier_{suffix}",
            "allow_unknown": True,
            "classes": [
                {"class_name": "application", "description": "Application form."},
                {"class_name": "consent", "description": "Consent form."},
            ],
        },
    )
    checklist = _api_json(
        base_url,
        "POST",
        "/api/required-field-checklists",
        {
            "name": f"smoke_required_{suffix}",
            "items": [
                {"item_name": "applicant", "description": "Applicant name is written."},
                {"item_name": "signature", "description": "Signature or stamp is present.", "evidence_type": "signature_or_stamp"},
            ],
        },
    )
    branch_keys = ["class:application", "class:consent", "unknown"]
    nodes = [
        {"id": "input", "position": {"x": 40, "y": 240}, "data": {"kind": "input", "label": "Input"}},
        {
            "id": "classifier",
            "position": {"x": 250, "y": 240},
            "data": {"kind": "classifier", "label": "Classify", "config": {"classifier_id": classifier["id"]}},
        },
        {"id": "branch", "position": {"x": 460, "y": 240}, "data": {"kind": "branch", "label": "Branch", "branchKeys": branch_keys}},
        {"id": "kie", "position": {"x": 670, "y": 120}, "data": {"kind": "kie", "label": "KIE", "config": {"schema_id": schema["id"]}}},
        {
            "id": "required",
            "position": {"x": 670, "y": 300},
            "data": {"kind": "required-checker", "label": "Required", "config": {"checklist_id": checklist["id"]}},
        },
        {"id": "merge", "position": {"x": 900, "y": 240}, "data": {"kind": "merge", "label": "Merge"}},
        {"id": "export", "position": {"x": 1110, "y": 240}, "data": {"kind": "export", "label": "Export"}},
    ]
    edges = [
        {"id": "input-classifier", "source": "input", "target": "classifier"},
        {"id": "classifier-branch", "source": "classifier", "target": "branch"},
        {"id": "branch-application", "source": "branch", "target": "kie", "sourceHandle": "class:application"},
        {"id": "branch-consent", "source": "branch", "target": "required", "sourceHandle": "class:consent"},
        {"id": "branch-unknown", "source": "branch", "target": "merge", "sourceHandle": "unknown"},
        {"id": "kie-merge", "source": "kie", "target": "merge"},
        {"id": "required-merge", "source": "required", "target": "merge"},
        {"id": "merge-export", "source": "merge", "target": "export"},
    ]
    return _api_json(
        base_url,
        "POST",
        "/api/workflows",
        {"name": f"smoke_workflow_{suffix}", "definition": {"nodes": nodes, "edges": edges}},
    )


def _wait_for_document_ready(base_url: str, document_id: str) -> dict[str, Any]:
    for _ in range(120):
        payload = _api_json(base_url, "GET", f"/api/documents/{document_id}")
        if payload["status"] == "ready":
            return payload
        if payload["status"] in {"failed", "deleted"}:
            raise AssertionError(f"document failed: {payload.get('error_message')}")
        time.sleep(0.1)
    raise AssertionError(f"document did not become ready: {document_id}")


def _wait_for_workflow_terminal(base_url: str, run_id: str) -> dict[str, Any]:
    for _ in range(160):
        payload = _api_json(base_url, "GET", f"/api/workflow-runs/{run_id}/summary")
        if payload["status"] in TERMINAL_RUN_STATUSES:
            return _api_json(base_url, "GET", f"/api/workflow-runs/{run_id}")
        time.sleep(0.1)
    raise AssertionError(f"workflow did not finish: {run_id}")


def _wait_for_export_job(base_url: str, job_id: str) -> dict[str, Any]:
    for _ in range(120):
        payload = _api_json(base_url, "GET", f"/api/export-jobs/{job_id}")
        if payload["status"] in TERMINAL_EXPORT_STATUSES:
            return payload
        time.sleep(0.1)
    raise AssertionError(f"export job did not finish: {job_id}")


def _assert_xlsx_download(base_url: str, job_id: str) -> None:
    with urllib.request.urlopen(f"{base_url}/api/export-jobs/{job_id}/download", timeout=20) as response:
        content = response.read(4)
        if response.status != 200 or content != b"PK\x03\x04":
            raise AssertionError(f"xlsx download failed: {response.status} {content!r}")


def _capture_ui_screenshots(frontend_base: str, run_id: str, artifact_dir: Path, timeout: float) -> list[Path]:
    chrome = _chrome_binary()
    if not chrome:
        raise AssertionError("Chrome binary not found. Rerun with --skip-browser to do API-only smoke.")

    profile_dir = Path(tempfile.mkdtemp(prefix="daw_poc_chrome_profile_"))
    captures = [
        ("workflow-desktop", f"{frontend_base}/workflows", "1440,900"),
        ("result-desktop", f"{frontend_base}/workflow-runs/{run_id}", "1440,900"),
        ("result-narrow", f"{frontend_base}/workflow-runs/{run_id}", "820,1180"),
    ]
    screenshot_paths: list[Path] = []
    try:
        for name, url, window_size in captures:
            screenshot_path = artifact_dir / f"{name}.png"
            command = [
                str(chrome),
                "--headless=new",
                "--disable-gpu",
                "--no-first-run",
                "--disable-extensions",
                f"--user-data-dir={profile_dir}",
                f"--window-size={window_size}",
                "--virtual-time-budget=6000",
                f"--screenshot={screenshot_path}",
                url,
            ]
            timed_out = False
            try:
                result = subprocess.run(
                    command,
                    capture_output=True,
                    text=True,
                    check=False,
                    timeout=timeout,
                )
            except subprocess.TimeoutExpired as exc:
                if not _screenshot_is_valid(screenshot_path):
                    raise AssertionError(f"Chrome screenshot timed out for {name} after {timeout:.1f}s") from exc
                timed_out = True
                result = None
            if result is not None and result.returncode != 0:
                raise AssertionError(f"Chrome screenshot failed for {name}: {result.stderr[-500:]}")
            if not _screenshot_is_valid(screenshot_path):
                raise AssertionError(f"Chrome screenshot looks empty: {screenshot_path}")
            if timed_out:
                print(f"Chrome screenshot captured before timeout: {screenshot_path}", flush=True)
            screenshot_paths.append(screenshot_path)
    finally:
        shutil.rmtree(profile_dir, ignore_errors=True)
    return screenshot_paths


def _screenshot_is_valid(path: Path) -> bool:
    return path.exists() and path.stat().st_size >= 10_000


def _chrome_binary() -> Path | None:
    candidates = [
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
        Path("/Applications/Chromium.app/Contents/MacOS/Chromium"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    for name in ["google-chrome", "chromium", "chromium-browser"]:
        resolved = shutil.which(name)
        if resolved:
            return Path(resolved)
    return None


def _terminate(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=8)


if __name__ == "__main__":
    raise SystemExit(main())
