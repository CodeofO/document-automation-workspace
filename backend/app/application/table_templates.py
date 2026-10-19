"""Table templates (표 양식): create, read, update (version + 1 when the tables change), archive, duplicate."""

import re
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.application.definitions import duplicate_name
from app.application.table_extraction import region_image_inputs
from app.audit import log_audit_event
from app.core.errors import (
    AppError,
    ConflictError,
    InvalidRequestError,
    NotFoundError,
    UnprocessableError,
    UpstreamError,
    ensure_found,
)
from app.domain.table_spec import (
    COLUMN_TYPES,
    MAX_COLUMNS_PER_TABLE,
    ColumnSpec,
    RowCountSpec,
    TableRegion,
    TableSpec,
    TableTemplateDefinition,
    load_definition,
)
from app.models import Document, DocumentPage, TableTemplate
from app.table_schemas import (
    SampleRef,
    TableRecommendationRead,
    TableRecommendationRequest,
    TableTemplateCreate,
    TableTemplateRead,
    TableTemplateUpdate,
)
from app.vlm import get_vlm_gateway, vlm_error_detail


def template_read(template: TableTemplate) -> TableTemplateRead:
    return TableTemplateRead(
        id=template.id,
        name=template.name,
        display_name=template.display_name,
        description=template.description,
        current_version=template.current_version,
        tables=load_definition(template.definition_json).tables,
        sample_refs=[SampleRef(**ref) for ref in template.sample_refs_json or []],
        pinned=template.pinned,
        ephemeral=template.ephemeral,
        archived=template.archived,
        created_at=template.created_at,
        updated_at=template.updated_at,
    )


def get_template(template_id: str, db: Session) -> TableTemplate:
    template = db.get(TableTemplate, template_id)
    if not template:
        raise NotFoundError("Table template not found")
    return template


def get_runnable_template(template_id: str, db: Session) -> TableTemplate:
    """A template a job/batch may run: exists and is not archived."""
    template = db.get(TableTemplate, template_id)
    if not template or template.archived:
        raise NotFoundError("Table template not found")
    return template


def _definition_json(definition: TableTemplateDefinition) -> dict:
    return definition.model_dump(mode="json")


def _raise_if_name_conflicts(db: Session, name: str, template_id: str | None = None) -> None:
    query = db.query(TableTemplate).filter(
        TableTemplate.name == name.strip(),
        TableTemplate.archived == False,  # noqa: E712
        TableTemplate.ephemeral == False,  # noqa: E712
    )
    if template_id:
        query = query.filter(TableTemplate.id != template_id)
    if query.first():
        raise ConflictError(f"Table template name already exists: {name.strip()}")


def list_templates(db: Session, *, include_archived: bool = False, include_ephemeral: bool = False) -> list[TableTemplateRead]:
    query = db.query(TableTemplate)
    if not include_archived:
        query = query.filter(TableTemplate.archived == False)  # noqa: E712
    if not include_ephemeral:
        query = query.filter(TableTemplate.ephemeral == False)  # noqa: E712
    return [template_read(template) for template in query.order_by(TableTemplate.pinned.desc(), TableTemplate.created_at.desc()).all()]


def create_template(payload: TableTemplateCreate, db: Session) -> TableTemplateRead:
    _raise_if_name_conflicts(db, payload.name)
    definition = payload.definition()
    template = TableTemplate(
        name=payload.name,
        display_name=payload.display_name or payload.name,
        description=payload.description,
        current_version=1,
        definition_json=_definition_json(definition),
        sample_refs_json=[ref.model_dump() for ref in payload.sample_refs],
        pinned=payload.pinned,
        ephemeral=False,
        archived=False,
    )
    db.add(template)
    db.flush()
    log_audit_event(
        db,
        entity_type="table_template",
        entity_id=template.id,
        action="created",
        message=f"Created table template {template.name}",
        metadata={"table_count": len(definition.tables)},
    )
    db.commit()
    db.refresh(template)
    return template_read(template)


def update_template(template_id: str, payload: TableTemplateUpdate, db: Session) -> TableTemplateRead:
    template = get_template(template_id, db)
    if template.ephemeral:
        raise InvalidRequestError("Draft table templates cannot be edited")
    if template.archived:
        raise ConflictError("Archived table templates cannot be edited")
    fields = payload.model_fields_set
    if payload.name is not None and payload.name.strip() != template.name:
        _raise_if_name_conflicts(db, payload.name, template.id)
        template.name = payload.name.strip()
    if "display_name" in fields:
        template.display_name = payload.display_name
    if "description" in fields:
        template.description = payload.description
    if payload.pinned is not None:
        template.pinned = payload.pinned
    if payload.sample_refs is not None:
        template.sample_refs_json = [ref.model_dump() for ref in payload.sample_refs]
    version_bumped = False
    if payload.tables is not None:
        next_definition = _definition_json(TableTemplateDefinition(tables=payload.tables))
        if next_definition != _definition_json(load_definition(template.definition_json)):
            template.definition_json = next_definition
            template.current_version = (template.current_version or 1) + 1
            version_bumped = True
    log_audit_event(
        db,
        entity_type="table_template",
        entity_id=template.id,
        action="updated",
        message=f"Updated table template {template.name}",
        metadata={"current_version": template.current_version, "definition_changed": version_bumped},
    )
    db.commit()
    db.refresh(template)
    return template_read(template)


def archive_template(template_id: str, db: Session) -> TableTemplateRead:
    template = get_template(template_id, db)
    if template.ephemeral:
        raise InvalidRequestError("Draft table templates cannot be archived from the library")
    template.archived = True
    template.pinned = False
    log_audit_event(
        db,
        entity_type="table_template",
        entity_id=template.id,
        action="archived",
        message=f"Archived table template {template.name}",
        metadata={"name": template.name},
    )
    db.commit()
    db.refresh(template)
    return template_read(template)


def duplicate_template(template_id: str, db: Session) -> TableTemplateRead:
    template = get_template(template_id, db)
    if template.ephemeral:
        raise InvalidRequestError("Draft table templates cannot be duplicated from the library")
    existing = {
        row[0]
        for row in db.query(TableTemplate.name).filter(TableTemplate.archived == False, TableTemplate.ephemeral == False).all()  # noqa: E712
    }
    name = duplicate_name(template.name, existing)
    duplicated = TableTemplate(
        name=name,
        display_name=name,
        description=template.description,
        current_version=1,
        definition_json=_definition_json(load_definition(template.definition_json)),
        sample_refs_json=list(template.sample_refs_json or []),
        pinned=False,
        ephemeral=False,
        archived=False,
    )
    db.add(duplicated)
    db.flush()
    log_audit_event(
        db,
        entity_type="table_template",
        entity_id=duplicated.id,
        action="duplicated",
        message=f"Duplicated table template {template.name} to {name}",
        metadata={"source_template_id": template.id},
    )
    db.commit()
    db.refresh(duplicated)
    return template_read(duplicated)


def recommend_table(payload: TableRecommendationRequest, db: Session) -> TableRecommendationRead:
    """AI column draft: one VLM call on the region crop (+ downscaled page) → a validated ``TableSpec`` draft."""
    document = db.get(Document, payload.document_id)
    ensure_found(document, "Document not found")
    page = (
        db.query(DocumentPage)
        .filter(DocumentPage.document_id == document.id, DocumentPage.page_number == payload.page_number)
        .one_or_none()
    )
    if not page:
        raise UnprocessableError(f"Page {payload.page_number} does not exist in this document")
    description = (payload.table_description or "").strip() or None
    try:
        image_inputs, _region_used = region_image_inputs(
            document.storage_path,
            page.image_path,
            f"recommend_{uuid.uuid4().hex[:12]}",
            payload.page_number,
            payload.region,
            DEFAULT_REGION_PADDING,
            "the table to describe",
        )
        output = get_vlm_gateway().recommend_table(image_inputs, table_description=description, has_region_crop=payload.region is not None)
    except AppError:
        raise
    except RuntimeError as exc:
        raise InvalidRequestError(vlm_error_detail(exc)) from exc
    if not isinstance(output, dict):
        raise UpstreamError("VLM returned an invalid table recommendation")
    table = table_spec_from_recommendation(output, region=payload.region, fallback_description=description)
    log_audit_event(
        db,
        entity_type="document",
        entity_id=document.id,
        action="table_recommended",
        message="AI table column draft generated",
        metadata={"page_number": payload.page_number, "column_count": len(table.columns), "has_region": payload.region is not None},
    )
    db.commit()
    reasoning = output.get("reasoning")
    return TableRecommendationRead(table=table, reasoning=str(reasoning).strip() or None if reasoning else None)


# --- recommendation sanitizing ----------------------------------------------------------------

DEFAULT_REGION_PADDING = 0.05
_TABLE_KEY_UNSAFE = re.compile(r"[^\w-]+", re.UNICODE)


def _text(value: Any, limit: int) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text[:limit] or None


def _text_list(value: Any, *, limit: int, item_limit: int = 200) -> list[str]:
    if not isinstance(value, list):
        return []
    items: list[str] = []
    for entry in value:
        text = _text(entry, item_limit)
        if text and text not in items:
            items.append(text)
    return items[:limit]


def _unique(base: str, used: set[str], limit: int) -> str:
    candidate = base[:limit]
    counter = 2
    while candidate in used:
        suffix = f"_{counter}"
        candidate = base[: limit - len(suffix)] + suffix
        counter += 1
    used.add(candidate)
    return candidate


def sanitize_table_key(value: Any, fallback: str = "table_1") -> str:
    text = _TABLE_KEY_UNSAFE.sub("_", str(value or "").strip()).strip("_")
    return (text or fallback)[:80]


def table_spec_from_recommendation(
    output: dict[str, Any], *, region: TableRegion | None = None, fallback_description: str | None = None
) -> TableSpec:
    """Turn a (possibly sloppy) model draft into a valid ``TableSpec``.

    Keys are trimmed and de-duplicated (``수량``, ``수량_2``…), unknown types become ``text``, a
    ``choice`` column without choices becomes ``text``, list fields are trimmed and de-duplicated,
    and ``row_count_guess`` (1~1000) becomes ``row_count = {mode: "max", value}``.
    """
    columns: list[ColumnSpec] = []
    used: set[str] = set()
    raw_columns = output.get("columns") if isinstance(output.get("columns"), list) else []
    for index, raw in enumerate(raw_columns, start=1):
        if not isinstance(raw, dict) or len(columns) >= MAX_COLUMNS_PER_TABLE:
            continue
        header_path = _text_list(raw.get("header_path"), limit=4)
        base_key = _text(raw.get("key"), 120) or (header_path[-1][:120] if header_path else f"칼럼{index}")
        column_type = raw.get("type") if raw.get("type") in COLUMN_TYPES else "text"
        choices = _text_list(raw.get("choices"), limit=100) if column_type == "choice" else []
        checkbox_options = _text_list(raw.get("checkbox_options"), limit=100) if column_type == "checkbox" else []
        if column_type == "choice" and not choices:
            column_type = "text"
        columns.append(
            ColumnSpec(
                key=_unique(base_key, used, 120),
                header_path=header_path,
                description=_text(raw.get("description"), 1000),
                type=column_type,
                choices=choices,
                checkbox_options=checkbox_options,
            )
        )
    if not columns:
        raise UpstreamError("VLM did not find any table columns; try a tighter region or a table description")
    name = _text(output.get("name"), 120) or "표 1"
    guess = output.get("row_count_guess")
    row_count = (
        RowCountSpec(mode="max", value=guess)
        if isinstance(guess, int) and not isinstance(guess, bool) and 1 <= guess <= 1000
        else RowCountSpec()
    )
    return TableSpec(
        key=sanitize_table_key(output.get("key") or name),
        name=name,
        description=_text(output.get("description"), 2000) or fallback_description,
        region=region,
        end_hint=_text(output.get("end_hint"), 500),
        row_unit_hint=_text(output.get("row_unit_hint"), 500),
        row_count=row_count,
        columns=columns,
    )
