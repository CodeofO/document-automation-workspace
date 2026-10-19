"""Page-level units of work (refactor plan §8.1).

Every module job, module batch item and workflow run item covers one ``(document_id, page_number)``.
A multi-page document is expanded into one unit per page when its pages are known:

* a READY library document expands immediately (``page_slots``);
* a document that is still uploading/converting gets one *placeholder* unit with
  ``page_number = None`` which is expanded once the document is ready (upload preprocessing,
  ``infra.jobs.conversion.activate_ready_document_waiters``, resume/retry/start);
* a placeholder that can never be expanded (the document failed) stays ``None`` and fails.

Rows written before page-level processing also have ``page_number = None`` and mean
"the whole document"; readers keep handling that.
"""

from sqlalchemy.orm import Session

from app.domain.status import DocumentStatus
from app.models import Document, DocumentPage


def document_page_numbers(document: Document, db: Session) -> list[int]:
    """Page numbers stored for ``document`` (flushes first so freshly rasterized pages are visible)."""
    db.flush()
    rows = (
        db.query(DocumentPage.page_number)
        .filter(DocumentPage.document_id == document.id)
        .order_by(DocumentPage.page_number.asc())
        .all()
    )
    return [int(page_number) for (page_number,) in rows]


def page_slots(document: Document, db: Session) -> list[int | None]:
    """Units a document expands into now: its page numbers when ready, else one placeholder."""
    if document.status == DocumentStatus.READY:
        return list(document_page_numbers(document, db)) or [None]
    return [None]


def expandable_page_numbers(document: Document | None, page_number: int | None, db: Session) -> list[int]:
    """Pages a placeholder unit (``page_number is None``) expands into; empty when it cannot expand yet."""
    if page_number is not None or document is None or document.status != DocumentStatus.READY:
        return []
    return document_page_numbers(document, db)
