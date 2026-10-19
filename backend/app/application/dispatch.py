"""Background work a use case asks its caller to start once the response is ready."""

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class JobDispatch:
    """Run ``JobRunners.<runner>(*args)`` after the request finishes (see ``app.background_jobs``)."""

    runner: str
    args: tuple[Any, ...]
