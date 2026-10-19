"""Schema management: Alembic is the only mechanism.

The app upgrades its database to ``head`` on startup (``promote.sh`` and the e2e harness
also run ``alembic upgrade head`` beforehand; upgrading an up-to-date database is a no-op).
"""

import threading
from pathlib import Path

from alembic.config import Config

from alembic import command
from app.core.config import BACKEND_DIR, get_settings

_LOCK = threading.Lock()
_UPGRADED_URLS: set[str] = set()


def alembic_config(database_url: str | None = None) -> Config:
    config = Config(str(Path(BACKEND_DIR) / "alembic.ini"))
    config.set_main_option("script_location", str(Path(BACKEND_DIR) / "alembic"))
    # Keep the host application's logging untouched (alembic.ini's fileConfig would replace it).
    config.attributes["configure_logging"] = False
    if database_url:
        config.attributes["database_url"] = database_url
    return config


def upgrade_database() -> None:
    """``alembic upgrade head`` for the configured database (once per process and URL)."""
    database_url = get_settings().resolved_database_url
    with _LOCK:
        if database_url in _UPGRADED_URLS:
            return
        command.upgrade(alembic_config(database_url), "head")
        _UPGRADED_URLS.add(database_url)
    # Settings cached before the upgrade could not see app_settings yet.
    get_settings.cache_clear()
