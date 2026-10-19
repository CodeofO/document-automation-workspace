"""FastAPI dependencies shared by the routers."""

from app.core.db import get_db

__all__ = ["get_db"]
