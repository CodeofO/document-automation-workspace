import os
import tempfile
from collections.abc import Callable, Iterator
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest

# The engine and settings are created at import time, so the test environment must be in
# place before anything under ``app`` is imported.
TEST_DIR = Path(tempfile.mkdtemp(prefix="digitize_documents_backend_tests_"))
os.environ["DATABASE_URL"] = f"sqlite:///{TEST_DIR / 'digitize_documents_test.db'}"
os.environ["DOCUMENT_STORAGE_DIR"] = str(TEST_DIR / "storage")
os.environ["RAW_STORAGE_DIR"] = str(TEST_DIR / "raw_storage")
os.environ["VLM_PROVIDER"] = "openai"
os.environ["VLM_API_KEY"] = ""
os.environ["VLM_MODEL_NAME"] = ""
os.environ["OPENAI_API_KEY"] = ""
os.environ["OPENAI_MODEL_NAME"] = ""

from fastapi.testclient import TestClient  # noqa: E402

from app.background_jobs import JobRunners, get_job_runners, set_job_runners  # noqa: E402
from app.core.config import get_settings  # noqa: E402
from app.core.db import Base, engine  # noqa: E402
from app.core.migrations import upgrade_database  # noqa: E402
from app.infra.jobs.runtime import InlineJobRuntime, set_job_runtime  # noqa: E402
from app.main import app  # noqa: E402
from app.vlm import set_vlm_gateway  # noqa: E402
from tests.support import api as api_support
from tests.support.fake_vlm import FakeVlmGateway  # noqa: E402


def get_client() -> TestClient:
    return TestClient(app)


def _truncate_all_tables() -> None:
    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(table.delete())


# Background jobs run synchronously in the thread that queues them (after the response for
# request-scheduled jobs), so a test sees their effects as soon as the call returns.
INLINE_JOB_RUNTIME = InlineJobRuntime()
set_job_runtime(INLINE_JOB_RUNTIME)


@pytest.fixture(scope="session", autouse=True)
def _database_schema() -> None:
    upgrade_database()


@pytest.fixture(autouse=True)
def _isolated_state() -> Iterator[None]:
    """Give every test fresh settings, default seams and an empty database.

    ``monkeypatch`` is torn down before this fixture, so the settings cache is cleared
    again only after environment changes have been undone.
    """
    get_settings.cache_clear()
    set_vlm_gateway(None)
    set_job_runners(None)
    api_support.SCHEMA_COUNTER = 0
    yield
    set_vlm_gateway(None)
    set_job_runners(None)
    get_settings.cache_clear()
    _truncate_all_tables()


@pytest.fixture
def settings_env(monkeypatch: pytest.MonkeyPatch) -> Callable[..., None]:
    """Set (or with ``None`` unset) environment-backed settings for one test."""

    def apply(**values: Any) -> None:
        for key, value in values.items():
            if value is None:
                monkeypatch.delenv(key, raising=False)
            else:
                monkeypatch.setenv(key, str(value))
        get_settings.cache_clear()

    return apply


@pytest.fixture
def mock_vlm(settings_env: Callable[..., None]) -> None:
    """Run the app against the deterministic mock VLM provider."""
    settings_env(VLM_PROVIDER="mock")


@pytest.fixture
def fake_vlm() -> FakeVlmGateway:
    """Install a gateway whose operations can be replaced per test via ``fake_vlm.set(...)``."""
    gateway = FakeVlmGateway()
    set_vlm_gateway(gateway)
    return gateway


class JobRunnerOverrides:
    def set(self, **runners: Any) -> JobRunners:
        updated = replace(get_job_runners(), **runners)
        set_job_runners(updated)
        return updated

    def reset(self) -> None:
        set_job_runners(None)


@pytest.fixture
def job_queue() -> InlineJobRuntime:
    """The inline job runtime: ``job_queue.run_until_idle()`` runs whatever is queued."""
    return INLINE_JOB_RUNTIME


@pytest.fixture
def job_runners() -> JobRunnerOverrides:
    """Replace background job entry points (e.g. ``job_runners.set(workflow_run=noop)``)."""
    return JobRunnerOverrides()


@pytest.fixture
def client() -> Iterator[TestClient]:
    with TestClient(app) as test_client:
        yield test_client
