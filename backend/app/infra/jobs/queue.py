"""The durable job queue (``job_queue`` table).

A row is one call of a ``JobRunners`` entry point: ``kind`` is the entry point's name and
``payload`` its positional arguments. Workers claim ``queued`` rows by moving them to
``running`` under a lease they keep extending; finished rows become ``done`` / ``failed``.
A ``running`` row whose lease expired (its worker died) goes back to ``queued``.

Claiming is safe with several workers: on PostgreSQL candidates are locked with
``SELECT … FOR UPDATE SKIP LOCKED``; elsewhere (SQLite) a row is claimed by an atomic
``UPDATE … WHERE status = 'queued'`` and a worker that loses the race simply moves on.
"""

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import and_, or_, update
from sqlalchemy.orm import Session

from app.application.dispatch import JobDispatch
from app.core.clock import utcnow
from app.core.config import get_settings
from app.core.db import SessionLocal
from app.domain.status import JOB_QUEUE_ACTIVE_STATUSES, JobQueueStatus
from app.models import JobQueueEntry

# Entry points that run one unit and are deduplicated while queued: a second request to run
# the same target is redundant until the queued one starts (it picks up everything queued).
_DEDUPED_KINDS = frozenset(
    {
        "workflow_run",
        "extraction_job",
        "classification_job",
        "required_check_job",
        "table_extraction_job",
        "document_conversion",
        "export_job",
    }
)


@dataclass(frozen=True)
class ClaimedJob:
    id: str
    kind: str
    payload: list[Any]
    attempts: int
    target_id: str | None


def dedupe_key(kind: str, args: tuple[Any, ...] | list[Any]) -> str | None:
    if kind not in _DEDUPED_KINDS or not args:
        return None
    return ":".join([kind, *(str(arg) for arg in args)])


def enqueue(db: Session, kind: str, args: tuple[Any, ...] | list[Any], *, available_at: datetime | None = None) -> JobQueueEntry | None:
    """Add a job (the caller commits). Returns ``None`` when an identical job is already queued."""
    key = dedupe_key(kind, args)
    if key is not None:
        existing = db.query(JobQueueEntry.id).filter(JobQueueEntry.dedupe_key == key, JobQueueEntry.status == JobQueueStatus.QUEUED).first()
        if existing:
            return None
    entry = JobQueueEntry(
        kind=kind,
        target_id=str(args[0]) if args else None,
        payload=list(args),
        dedupe_key=key,
        status=JobQueueStatus.QUEUED,
        attempts=0,
        max_attempts=max(1, get_settings().job_queue_max_attempts),
        available_at=available_at or utcnow(),
    )
    db.add(entry)
    db.flush()
    return entry


def enqueue_dispatches(dispatches: Iterable[JobDispatch]) -> int:
    """Persist ``dispatches`` in their own transaction. Returns how many rows were added."""
    items = list(dispatches)
    if not items:
        return 0
    db = SessionLocal()
    try:
        added = sum(1 for item in items if enqueue(db, item.runner, item.args) is not None)
        db.commit()
        return added
    finally:
        db.close()


def claim_next(owner: str, kinds: Iterable[str], *, lease_seconds: int) -> ClaimedJob | None:
    """Claim the oldest available job of one of ``kinds`` for ``owner`` (``None`` if there is none)."""
    kinds = list(kinds)
    if not kinds:
        return None
    db = SessionLocal()
    try:
        now = utcnow()
        candidates = (
            db.query(JobQueueEntry)
            .filter(
                JobQueueEntry.status == JobQueueStatus.QUEUED,
                JobQueueEntry.available_at <= now,
                JobQueueEntry.kind.in_(kinds),
            )
            .order_by(JobQueueEntry.available_at.asc(), JobQueueEntry.created_at.asc(), JobQueueEntry.id.asc())
        )
        if db.get_bind().dialect.name == "postgresql":
            entry = candidates.with_for_update(skip_locked=True).first()
            if entry is None:
                db.rollback()
                return None
            _mark_claimed(entry, owner, now, lease_seconds)
            db.commit()
            return _claimed(entry)
        for entry in candidates.limit(20).all():
            claimed = db.execute(
                update(JobQueueEntry)
                .where(JobQueueEntry.id == entry.id, JobQueueEntry.status == JobQueueStatus.QUEUED)
                .values(
                    status=JobQueueStatus.RUNNING,
                    lease_owner=owner,
                    lease_expires_at=now + timedelta(seconds=lease_seconds),
                    heartbeat_at=now,
                    started_at=now,
                    attempts=JobQueueEntry.attempts + 1,
                )
                .execution_options(synchronize_session=False)
            ).rowcount
            db.commit()
            if claimed == 1:
                db.refresh(entry)
                return _claimed(entry)
        return None
    finally:
        db.close()


def _mark_claimed(entry: JobQueueEntry, owner: str, now: datetime, lease_seconds: int) -> None:
    entry.status = JobQueueStatus.RUNNING
    entry.lease_owner = owner
    entry.lease_expires_at = now + timedelta(seconds=lease_seconds)
    entry.heartbeat_at = now
    entry.started_at = now
    entry.attempts = (entry.attempts or 0) + 1


def _claimed(entry: JobQueueEntry) -> ClaimedJob:
    return ClaimedJob(
        id=entry.id,
        kind=entry.kind,
        payload=list(entry.payload or []),
        attempts=entry.attempts,
        target_id=entry.target_id,
    )


def heartbeat(owner: str, job_ids: Iterable[str], *, lease_seconds: int) -> None:
    ids = list(job_ids)
    if not ids:
        return
    db = SessionLocal()
    try:
        now = utcnow()
        db.execute(
            update(JobQueueEntry)
            .where(
                JobQueueEntry.id.in_(ids),
                JobQueueEntry.lease_owner == owner,
                JobQueueEntry.status == JobQueueStatus.RUNNING,
            )
            .values(heartbeat_at=now, lease_expires_at=now + timedelta(seconds=lease_seconds))
            .execution_options(synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()


def finish(job_id: str, owner: str, *, error: str | None = None) -> None:
    """Record the outcome of a claimed job (ignored if the lease was lost meanwhile)."""
    db = SessionLocal()
    try:
        db.execute(
            update(JobQueueEntry)
            .where(
                JobQueueEntry.id == job_id,
                JobQueueEntry.lease_owner == owner,
                JobQueueEntry.status == JobQueueStatus.RUNNING,
            )
            .values(
                status=JobQueueStatus.FAILED if error else JobQueueStatus.DONE,
                last_error=error[:4000] if error else None,
                finished_at=utcnow(),
                lease_owner=None,
                lease_expires_at=None,
            )
            .execution_options(synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()


def release(owner: str, job_ids: Iterable[str]) -> None:
    """Give claimed jobs back (graceful shutdown); they run again, as a retry, on the next claim."""
    ids = list(job_ids)
    if not ids:
        return
    db = SessionLocal()
    try:
        db.execute(
            update(JobQueueEntry)
            .where(JobQueueEntry.id.in_(ids), JobQueueEntry.lease_owner == owner, JobQueueEntry.status == JobQueueStatus.RUNNING)
            .values(status=JobQueueStatus.QUEUED, lease_owner=None, lease_expires_at=None)
            .execution_options(synchronize_session=False)
        )
        db.commit()
    finally:
        db.close()


@dataclass(frozen=True)
class AbandonedJob:
    id: str
    kind: str
    payload: list[Any]
    error: str


def requeue_expired(*, all_running: bool = False) -> list[AbandonedJob]:
    """Put ``running`` jobs whose lease expired (every ``running`` job with ``all_running``) back
    to ``queued``. Jobs that already used up their attempts are marked ``failed`` instead and
    returned so the caller can fail their domain rows."""
    db = SessionLocal()
    try:
        now = utcnow()
        query = db.query(JobQueueEntry).filter(JobQueueEntry.status == JobQueueStatus.RUNNING)
        if not all_running:
            query = query.filter(or_(JobQueueEntry.lease_expires_at.is_(None), JobQueueEntry.lease_expires_at < now))
        abandoned: list[AbandonedJob] = []
        for entry in query.all():
            if entry.attempts >= entry.max_attempts:
                message = f"Gave up after {entry.attempts} interrupted attempt(s)"
                entry.status = JobQueueStatus.FAILED
                entry.last_error = message
                entry.finished_at = now
                abandoned.append(AbandonedJob(entry.id, entry.kind, list(entry.payload or []), message))
            else:
                entry.status = JobQueueStatus.QUEUED
                entry.available_at = now
            entry.lease_owner = None
            entry.lease_expires_at = None
        db.commit()
        return abandoned
    finally:
        db.close()


def active_targets(db: Session) -> set[tuple[str, str]]:
    """``(kind, target_id)`` of every queued or running job."""
    rows = (
        db.query(JobQueueEntry.kind, JobQueueEntry.target_id)
        .filter(JobQueueEntry.status.in_(JOB_QUEUE_ACTIVE_STATUSES), JobQueueEntry.target_id.isnot(None))
        .all()
    )
    return {(kind, target_id) for kind, target_id in rows}


def has_claimable_jobs(kinds: Iterable[str] | None = None) -> bool:
    db = SessionLocal()
    try:
        query = db.query(JobQueueEntry.id).filter(JobQueueEntry.status == JobQueueStatus.QUEUED, JobQueueEntry.available_at <= utcnow())
        if kinds is not None:
            query = query.filter(JobQueueEntry.kind.in_(list(kinds)))
        return query.first() is not None
    finally:
        db.close()


def prune_finished(older_than: timedelta) -> int:
    db = SessionLocal()
    try:
        cutoff = utcnow() - older_than
        deleted = (
            db.query(JobQueueEntry)
            .filter(
                and_(
                    JobQueueEntry.status.in_([JobQueueStatus.DONE, JobQueueStatus.FAILED]),
                    JobQueueEntry.finished_at.isnot(None),
                    JobQueueEntry.finished_at < cutoff,
                )
            )
            .delete(synchronize_session=False)
        )
        db.commit()
        return deleted
    finally:
        db.close()
