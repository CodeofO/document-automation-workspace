"""Single source of "now".

Timestamps are stored as naive UTC datetimes (the database columns are timezone-less),
so ``utcnow()`` keeps exactly the semantics of the deprecated ``datetime.utcnow()``.
"""

from datetime import UTC, datetime


def utcnow() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)
