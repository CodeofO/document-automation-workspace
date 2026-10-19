import os
import sqlite3
import subprocess
import sys
from pathlib import Path

HEAD_REVISION = "0008_table_extraction"


def test_workspace_scope_migration_upgrades_legacy_sqlite_database(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy.db"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE documents (
            id VARCHAR PRIMARY KEY,
            filename VARCHAR NOT NULL
        );
        CREATE TABLE schemas (
            id VARCHAR PRIMARY KEY,
            name VARCHAR NOT NULL
        );
        CREATE TABLE batches (
            id VARCHAR PRIMARY KEY,
            status VARCHAR NOT NULL
        );
        CREATE TABLE alembic_version (
            version_num VARCHAR(32) NOT NULL
        );
        INSERT INTO alembic_version (version_num) VALUES ('0002_export_jobs_and_summary_indexes');
        """
    )
    connection.commit()
    connection.close()

    backend_dir = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{db_path}",
        "DOCUMENT_STORAGE_DIR": str(tmp_path / "storage"),
        "RAW_STORAGE_DIR": str(tmp_path / "raw"),
    }
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )

    assert result.returncode == 0, result.stderr or result.stdout

    connection = sqlite3.connect(db_path)
    try:
        for table_name in ["documents", "schemas", "batches"]:
            columns = {row[1] for row in connection.execute(f'PRAGMA table_info("{table_name}")')}
            assert "workspace_id" in columns
        version = connection.execute("SELECT version_num FROM alembic_version").fetchone()
        assert version == (HEAD_REVISION,)
    finally:
        connection.close()


PAGE_SCOPED_TABLES = [
    "extraction_jobs",
    "classification_jobs",
    "required_field_check_jobs",
    "rotation_jobs",
    "batch_items",
    "classification_batch_items",
    "required_field_check_batch_items",
    "workflow_run_items",
]


def _alembic_upgrade_head(tmp_path: Path, db_path: Path) -> subprocess.CompletedProcess:
    backend_dir = Path(__file__).resolve().parents[1]
    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{db_path}",
        "DOCUMENT_STORAGE_DIR": str(tmp_path / "storage"),
        "RAW_STORAGE_DIR": str(tmp_path / "raw"),
    }
    return subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=backend_dir,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )


def _legacy_page_tables_db(db_path: Path, *, with_page_number: bool) -> None:
    extra = ", page_number INTEGER" if with_page_number else ""
    connection = sqlite3.connect(db_path)
    statements = [f"CREATE TABLE {table} (id VARCHAR PRIMARY KEY, document_id VARCHAR NOT NULL{extra});" for table in PAGE_SCOPED_TABLES]
    statements.append("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL);")
    statements.append("INSERT INTO alembic_version (version_num) VALUES ('0004_rotation_correction');")
    statements.extend(f"INSERT INTO {table} (id, document_id) VALUES ('{table}_1', 'doc_1');" for table in PAGE_SCOPED_TABLES)
    connection.executescript("\n".join(statements))
    connection.commit()
    connection.close()


def test_page_level_migration_adds_nullable_page_number_and_keeps_history(tmp_path: Path) -> None:
    db_path = tmp_path / "legacy_pages.db"
    _legacy_page_tables_db(db_path, with_page_number=False)

    result = _alembic_upgrade_head(tmp_path, db_path)
    assert result.returncode == 0, result.stderr or result.stdout

    connection = sqlite3.connect(db_path)
    try:
        for table_name in PAGE_SCOPED_TABLES:
            columns = {row[1]: row for row in connection.execute(f'PRAGMA table_info("{table_name}")')}
            assert "page_number" in columns
            assert columns["page_number"][3] == 0  # nullable
            assert connection.execute(f"SELECT page_number FROM {table_name}").fetchall() == [(None,)]
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (HEAD_REVISION,)
    finally:
        connection.close()


def test_page_level_migration_is_idempotent_after_startup_column_patch(tmp_path: Path) -> None:
    """The app's startup migrator may add ``page_number`` before alembic runs; 0005 must not fail on it."""
    db_path = tmp_path / "patched_pages.db"
    _legacy_page_tables_db(db_path, with_page_number=True)

    result = _alembic_upgrade_head(tmp_path, db_path)
    assert result.returncode == 0, result.stderr or result.stdout

    connection = sqlite3.connect(db_path)
    try:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (HEAD_REVISION,)
    finally:
        connection.close()


def _schema_diffs(db_path: Path) -> list:
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from sqlalchemy import create_engine

    import app.models  # noqa: F401
    from app.core.db import Base

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        with engine.connect() as connection:
            context = MigrationContext.configure(connection, opts={"compare_type": True})
            return compare_metadata(context, Base.metadata)
    finally:
        engine.dispose()


def test_alembic_built_schema_matches_models(tmp_path: Path) -> None:
    """Alembic is the only schema mechanism: an empty database upgraded to head equals the models."""
    db_path = tmp_path / "fresh.db"
    result = _alembic_upgrade_head(tmp_path, db_path)
    assert result.returncode == 0, result.stderr or result.stdout
    assert _schema_diffs(db_path) == []
    connection = sqlite3.connect(db_path)
    try:
        assert connection.execute("SELECT version_num FROM alembic_version").fetchone() == (HEAD_REVISION,)
    finally:
        connection.close()


def _create_all_without(db_path: Path, skipped_tables: set[str]) -> None:
    from sqlalchemy import create_engine

    import app.models  # noqa: F401
    from app.core.db import Base

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        Base.metadata.create_all(engine, tables=[table for table in Base.metadata.sorted_tables if table.name not in skipped_tables])
    finally:
        engine.dispose()


def test_database_kept_current_by_old_startup_create_all_upgrades_to_models(tmp_path: Path) -> None:
    """A service database stamped at 0005 whose tables came from the old startup ``create_all``."""
    db_path = tmp_path / "service.db"
    _create_all_without(db_path, {"job_queue", "app_settings"})
    connection = sqlite3.connect(db_path)
    connection.executescript(
        "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL);"
        "INSERT INTO alembic_version (version_num) VALUES ('0005_page_level_units');"
    )
    connection.commit()
    connection.close()

    result = _alembic_upgrade_head(tmp_path, db_path)
    assert result.returncode == 0, result.stderr or result.stdout
    assert _schema_diffs(db_path) == []


def test_unversioned_legacy_database_upgrades_from_scratch(tmp_path: Path) -> None:
    """A database that never ran alembic (startup ``create_all`` only): 0001 skips existing tables."""
    db_path = tmp_path / "unversioned.db"
    _create_all_without(db_path, {"job_queue", "app_settings", "document_library_folders"})

    result = _alembic_upgrade_head(tmp_path, db_path)
    assert result.returncode == 0, result.stderr or result.stdout
    assert _schema_diffs(db_path) == []


def test_lightweight_migrator_columns_are_added_to_an_old_schema(tmp_path: Path) -> None:
    """Columns that only the removed startup migrator used to add are now covered by 0006."""
    db_path = tmp_path / "old.db"
    connection = sqlite3.connect(db_path)
    connection.executescript(
        """
        CREATE TABLE documents (id VARCHAR PRIMARY KEY, filename VARCHAR NOT NULL);
        CREATE TABLE workflow_runs (id VARCHAR PRIMARY KEY, workflow_id VARCHAR NOT NULL, status VARCHAR NOT NULL, created_at DATETIME);
        CREATE TABLE workflow_run_items (id VARCHAR PRIMARY KEY, run_id VARCHAR NOT NULL, status VARCHAR NOT NULL);
        CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL);
        INSERT INTO alembic_version (version_num) VALUES ('0005_page_level_units');
        INSERT INTO workflow_runs (id, workflow_id, status) VALUES ('run_1', 'wf_1', 'completed');
        """
    )
    connection.commit()
    connection.close()

    result = _alembic_upgrade_head(tmp_path, db_path)
    assert result.returncode == 0, result.stderr or result.stdout

    connection = sqlite3.connect(db_path)
    try:
        run_columns = {row[1] for row in connection.execute('PRAGMA table_info("workflow_runs")')}
        assert {"workflow_definition_json", "workflow_run_group_id", "queue_order", "execution_generation", "workspace_id"} <= run_columns
        item_columns = {row[1] for row in connection.execute('PRAGMA table_info("workflow_run_items")')}
        assert {"upload_index", "client_file_id", "execution_generation", "page_number"} <= item_columns
        document_columns = {row[1] for row in connection.execute('PRAGMA table_info("documents")')}
        assert {"library_path", "error_message", "deleted_at", "workspace_id"} <= document_columns
        assert connection.execute("SELECT execution_generation FROM workflow_runs").fetchall() == [(0,)]
        tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        assert {"job_queue", "app_settings", "document_conversion_jobs", "document_library_folders"} <= tables
    finally:
        connection.close()
