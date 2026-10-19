"""JSON values stored in ``TEXT`` columns.

The columns keep exactly the text format the application always wrote by hand
(``json.dumps(value, ensure_ascii=False)``; ``default=str`` only matters for values plain
``json.dumps`` would reject), so existing rows read back unchanged and the columns stay
plain ``TEXT`` in the schema (no migration).

Values are replaced, never mutated in place: SQLAlchemy does not track changes inside a
loaded dict/list, so build a new object (``{**old, "key": value}``) and assign it.
"""

import json
import logging
from typing import Any

from sqlalchemy import Text
from sqlalchemy.types import TypeDecorator

logger = logging.getLogger(__name__)


def dumps_json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


def loads_json_text(raw: str | None) -> Any:
    """``None`` for NULL, blank or unparsable text (legacy rows); the decoded value otherwise."""
    if raw is None or not raw.strip():
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Ignoring unparsable JSON column value (%d chars)", len(raw))
        return None


class JSONText(TypeDecorator):
    """A JSON document (dict, list or scalar) persisted as ``TEXT``; Python ``None`` is SQL ``NULL``."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any, dialect: Any) -> str | None:
        if value is None:
            return None
        return dumps_json_text(value)

    def process_result_value(self, value: str | None, dialect: Any) -> Any:
        return loads_json_text(value)
