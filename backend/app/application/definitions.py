import copy
from typing import Any

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.audit import log_audit_event
from app.core.errors import (
    ConflictError,
    InternalError,
    InvalidRequestError,
    NotFoundError,
    UnprocessableError,
    UpstreamError,
    ensure_found,
)
from app.models import (
    Batch,
    Document,
    DocumentClassifier,
    ExportPreset,
    ExtractionJob,
    RequiredFieldChecklist,
    Schema,
)
from app.schemas import (
    DocumentClassifierCreate,
    DocumentClassifierRead,
    DocumentClassifierUpdate,
    RequiredFieldChecklistCreate,
    RequiredFieldChecklistRead,
    RequiredFieldChecklistRecommendationRead,
    RequiredFieldChecklistRecommendationRequest,
    RequiredFieldChecklistUpdate,
    SchemaCreate,
    SchemaDescriptionRecommendationRead,
    SchemaDescriptionRecommendationRequest,
    SchemaRead,
    SchemaRecommendationRead,
    SchemaRecommendationRequest,
    SchemaUpdate,
)
from app.vlm import get_vlm_gateway, vlm_error_detail


def schema_read(schema: Schema) -> SchemaRead:
    schema_data = schema_definition_data(schema)
    return SchemaRead(
        id=schema.id,
        name=schema.name,
        display_name=schema.display_name,
        description=schema.description,
        is_template=schema.is_template,
        template_category=schema.template_category,
        pinned=schema.pinned,
        ephemeral=schema.ephemeral,
        archived=schema.archived,
        regions=schema_data.get("regions", []),
        fields=schema_data["fields"],
        created_at=schema.created_at,
        updated_at=schema.updated_at,
    )


def schema_definition_data(schema: Schema) -> dict[str, Any]:
    if not schema.schema_json:
        raise InternalError("Schema data is missing")
    return copy.deepcopy(schema.schema_json)


def classifier_read(classifier: DocumentClassifier) -> DocumentClassifierRead:
    data = classifier_data(classifier)
    return DocumentClassifierRead(
        id=classifier.id,
        name=classifier.name,
        description=classifier.description,
        allow_unknown=classifier.allow_unknown,
        archived=classifier.archived,
        classes=data["classes"],
        created_at=classifier.created_at,
        updated_at=classifier.updated_at,
    )


def classifier_data(classifier: DocumentClassifier) -> dict[str, Any]:
    if not classifier.config_json:
        raise InternalError("Document classifier data is missing")
    return copy.deepcopy(classifier.config_json)


def checklist_read(checklist: RequiredFieldChecklist) -> RequiredFieldChecklistRead:
    data = checklist_data(checklist)
    return RequiredFieldChecklistRead(
        id=checklist.id,
        name=checklist.name,
        description=checklist.description,
        archived=checklist.archived,
        regions=data.get("regions", []),
        items=data["items"],
        created_at=checklist.created_at,
        updated_at=checklist.updated_at,
    )


def checklist_data(checklist: RequiredFieldChecklist) -> dict[str, Any]:
    if not checklist.config_json:
        raise InternalError("Required field checklist data is missing")
    return copy.deepcopy(checklist.config_json)


def required_field_checklist_recommendation_read(payload: dict[str, Any]) -> RequiredFieldChecklistRecommendationRead:
    recommendation = RequiredFieldChecklistRecommendationRead(**payload)
    region_ids = {region.id for region in recommendation.regions}
    seen_items: set[str] = set()
    unique_items = []
    for item in recommendation.items:
        if item.item_name in seen_items:
            continue
        seen_items.add(item.item_name)
        if item.region_id and item.region_id not in region_ids:
            item = item.model_copy(update={"region_id": None})
        unique_items.append(item)
    if not unique_items:
        raise ValueError("checklist recommendation must include at least one item")
    return RequiredFieldChecklistRecommendationRead(
        name=recommendation.name.strip() or "ai_recommended_checklist",
        description=recommendation.description,
        reasoning=recommendation.reasoning,
        regions=recommendation.regions,
        items=unique_items,
    )


def available_scoped_name(db: Session, model, desired: str) -> str:
    base = desired.strip() or "AI 초안"
    query = db.query(model.name).filter(model.name == base, model.archived == False)  # noqa: E712
    if hasattr(model, "ephemeral"):
        query = query.filter(model.ephemeral == False)  # noqa: E712
    if not query.first():
        return base
    existing_names = {
        row[0]
        for row in db.query(model.name).filter(model.archived == False).all()  # noqa: E712
    }
    return duplicate_name(base, existing_names)


def validate_checklist_region_references(checklist_data: dict[str, Any]) -> None:
    item_names = [item.get("item_name") for item in checklist_data.get("items", []) if isinstance(item, dict)]
    if len(item_names) != len(set(item_names)):
        raise UnprocessableError("required field item_name values must be unique")
    region_ids = [region.get("id") for region in checklist_data.get("regions", []) if isinstance(region, dict)]
    if len(region_ids) != len(set(region_ids)):
        raise UnprocessableError("required field region ids must be unique")
    region_id_set = set(region_ids)
    missing_region_ids = sorted(
        {
            item.get("region_id")
            for item in checklist_data.get("items", [])
            if isinstance(item, dict) and item.get("region_id") and item.get("region_id") not in region_id_set
        }
    )
    if missing_region_ids:
        raise UnprocessableError(
            f"required field item region_id values are missing from regions: {', '.join(missing_region_ids)}",
        )


def validate_schema_region_references(schema_data: dict[str, Any]) -> None:
    region_ids = {region.get("id") for region in schema_data.get("regions", []) if isinstance(region, dict)}
    missing_region_ids = sorted(
        {
            field.get("region_id")
            for field in schema_data.get("fields", [])
            if isinstance(field, dict) and field.get("region_id") and field.get("region_id") not in region_ids
        }
    )
    if missing_region_ids:
        raise UnprocessableError(
            f"schema field region_id values are missing from regions: {', '.join(missing_region_ids)}",
        )


def raise_if_schema_name_conflicts(db: Session, name: str, schema_id: str | None = None) -> None:
    normalized = name.strip()
    if not normalized:
        return
    query = db.query(Schema).filter(Schema.name == normalized, Schema.ephemeral == False, Schema.archived == False)  # noqa: E712
    if schema_id:
        query = query.filter(Schema.id != schema_id)
    if query.first():
        raise ConflictError(f"Schema name already exists: {normalized}")


def duplicate_name(name: str, existing_names: set[str], max_length: int = 120) -> str:
    base = name.strip() or "schema"
    for index in range(1, 10000):
        suffix = f" ({index})"
        truncated_base = base[: max(1, max_length - len(suffix))].rstrip()
        candidate = f"{truncated_base}{suffix}"
        if candidate not in existing_names:
            return candidate
    raise ConflictError(f"Could not create a duplicate name for: {base}")


def merge_duplicate_schema_names_into(db: Session, schema: Schema, name: str) -> None:
    normalized = name.strip()
    if not normalized:
        return
    duplicates = (
        db.query(Schema).filter(Schema.name == normalized, Schema.ephemeral == False, Schema.archived == False, Schema.id != schema.id)  # noqa: E712
    )
    for duplicate in duplicates.all():
        db.query(ExtractionJob).filter(ExtractionJob.schema_id == duplicate.id).update(
            {ExtractionJob.schema_id: schema.id},
            synchronize_session=False,
        )
        db.query(Batch).filter(Batch.schema_id == duplicate.id).update(
            {Batch.schema_id: schema.id},
            synchronize_session=False,
        )
        db.query(ExportPreset).filter(ExportPreset.schema_id == duplicate.id).update(
            {ExportPreset.schema_id: schema.id},
            synchronize_session=False,
        )
        log_audit_event(
            db,
            entity_type="schema",
            entity_id=schema.id,
            action="merged_duplicate",
            message=f"Merged duplicate schema {duplicate.id} into {schema.id}",
            metadata={"duplicate_schema_id": duplicate.id, "name": normalized},
        )
        db.delete(duplicate)


def schema_recommendation_read(payload: dict[str, Any]) -> SchemaRecommendationRead:
    recommendation = SchemaRecommendationRead(**payload)
    seen: set[str] = set()
    unique_fields = []
    for field in recommendation.fields:
        if field.key_name in seen:
            continue
        seen.add(field.key_name)
        unique_fields.append(field)
    return SchemaRecommendationRead(
        name=recommendation.name.strip() or "ai_recommended_schema",
        display_name=recommendation.display_name,
        description=recommendation.description,
        document_type=recommendation.document_type,
        language=recommendation.language,
        reasoning=recommendation.reasoning,
        fields=unique_fields,
    )


def create_schema(payload: SchemaCreate, db: Session) -> SchemaRead:
    raise_if_schema_name_conflicts(db, payload.name)
    schema = Schema(
        name=payload.name,
        display_name=payload.display_name,
        description=payload.description,
        current_version=1,
        schema_json=payload.model_dump(),
        is_template=payload.is_template,
        template_category=payload.template_category,
        pinned=payload.pinned,
        ephemeral=False,
        archived=False,
    )
    db.add(schema)
    db.flush()
    schema_json = payload.model_dump()
    validate_schema_region_references(schema_json)
    log_audit_event(
        db,
        entity_type="schema",
        entity_id=schema.id,
        action="created",
        message=f"Created schema {schema.name}",
        metadata={"is_template": schema.is_template, "field_count": len(payload.fields)},
    )
    db.commit()
    db.refresh(schema)
    return schema_read(schema)


def recommend_schema(payload: SchemaRecommendationRequest, db: Session) -> SchemaRecommendationRead:
    document = db.get(Document, payload.document_id)
    ensure_found(document, "Document not found")
    try:
        recommendation = get_vlm_gateway().recommend_schema([page.image_path for page in document.pages])
        recommendation_read = schema_recommendation_read(recommendation)
        document.document_type = recommendation_read.document_type
        document.language = recommendation_read.language
        document.ai_summary = recommendation_read.description
        document.recommendation_reasoning = recommendation_read.reasoning
        log_audit_event(
            db,
            entity_type="document",
            entity_id=document.id,
            action="schema_recommended",
            message="AI schema recommendation generated",
            metadata={
                "document_type": recommendation_read.document_type,
                "language": recommendation_read.language,
                "field_count": len(recommendation_read.fields),
            },
        )
        db.commit()
        return recommendation_read
    except ValidationError as exc:
        raise UpstreamError(f"VLM returned an invalid schema recommendation: {exc}") from exc
    except RuntimeError as exc:
        raise InvalidRequestError(vlm_error_detail(exc)) from exc


def recommend_schema_description(payload: SchemaDescriptionRecommendationRequest, db: Session) -> SchemaDescriptionRecommendationRead:
    image_paths: list[str] = []
    if payload.document_id:
        document = db.get(Document, payload.document_id)
        ensure_found(document, "Document not found")
        image_paths = [page.image_path for page in document.pages]
    try:
        recommendation = get_vlm_gateway().recommend_schema_description(
            image_paths,
            schema_name=payload.name,
            current_description=payload.current_description,
            fields=payload.fields,
        )
        return SchemaDescriptionRecommendationRead(**recommendation)
    except ValidationError as exc:
        raise UpstreamError(f"VLM returned an invalid schema description recommendation: {exc}") from exc
    except RuntimeError as exc:
        raise InvalidRequestError(vlm_error_detail(exc)) from exc


def duplicate_schema(schema_id: str, db: Session) -> SchemaRead:
    schema = db.get(Schema, schema_id)
    if not schema:
        raise NotFoundError("Schema not found")
    if schema.ephemeral:
        raise InvalidRequestError("Draft schemas cannot be duplicated from the library")
    schema_data = schema_definition_data(schema)
    existing_names = {
        row[0]
        for row in db.query(Schema.name).filter(Schema.ephemeral == False, Schema.archived == False).all()  # noqa: E712
    }
    duplicated_name = duplicate_name(schema.name, existing_names)
    duplicated_data = {
        **schema_data,
        "name": duplicated_name,
        "display_name": duplicated_name,
    }
    duplicated = Schema(
        name=duplicated_name,
        display_name=duplicated_name,
        description=schema.description,
        current_version=1,
        schema_json=duplicated_data,
        is_template=schema.is_template,
        template_category=schema.template_category,
        pinned=schema.pinned,
        ephemeral=False,
        archived=False,
    )
    db.add(duplicated)
    db.flush()
    log_audit_event(
        db,
        entity_type="schema",
        entity_id=duplicated.id,
        action="duplicated",
        message=f"Duplicated schema {schema.name} to {duplicated.name}",
        metadata={"source_schema_id": schema.id, "field_count": len(duplicated_data["fields"])},
    )
    db.commit()
    db.refresh(duplicated)
    return schema_read(duplicated)


def update_schema(schema_id: str, payload: SchemaUpdate, db: Session) -> SchemaRead:
    schema = db.get(Schema, schema_id)
    ensure_found(schema, "Schema not found")
    current = schema_definition_data(schema)
    next_schema_data = {
        "name": payload.name if payload.name is not None else schema.name,
        "display_name": (payload.display_name if "display_name" in payload.model_fields_set else schema.display_name),
        "description": payload.description if "description" in payload.model_fields_set else schema.description,
        "is_template": payload.is_template if payload.is_template is not None else schema.is_template,
        "template_category": (payload.template_category if "template_category" in payload.model_fields_set else schema.template_category),
        "pinned": payload.pinned if payload.pinned is not None else schema.pinned,
        "regions": [region.model_dump() for region in payload.regions] if payload.regions is not None else current.get("regions", []),
        "fields": [field.model_dump() for field in payload.fields] if payload.fields is not None else current["fields"],
    }
    validate_schema_region_references(next_schema_data)
    if next_schema_data["name"].strip() == schema.name.strip():
        merge_duplicate_schema_names_into(db, schema, next_schema_data["name"])
    else:
        raise_if_schema_name_conflicts(db, next_schema_data["name"], schema_id=schema.id)

    schema.name = next_schema_data["name"]
    schema.display_name = next_schema_data["display_name"]
    schema.description = next_schema_data["description"]
    schema.is_template = next_schema_data["is_template"]
    schema.template_category = next_schema_data["template_category"]
    schema.pinned = next_schema_data["pinned"]
    schema.schema_json = next_schema_data
    log_audit_event(
        db,
        entity_type="schema",
        entity_id=schema.id,
        action="updated",
        message=f"Updated schema {schema.name}",
        metadata={
            "is_template": schema.is_template,
            "field_count": len(next_schema_data["fields"]),
        },
    )
    db.commit()
    db.refresh(schema)
    return schema_read(schema)


def delete_schema(schema_id: str, db: Session) -> SchemaRead:
    schema = db.get(Schema, schema_id)
    ensure_found(schema, "Schema not found")
    if schema.ephemeral:
        raise InvalidRequestError("Draft schemas cannot be archived from the library")

    schema.archived = True
    schema.pinned = False
    schema.is_template = False
    log_audit_event(
        db,
        entity_type="schema",
        entity_id=schema.id,
        action="archived",
        message=f"Archived schema {schema.name}",
        metadata={"name": schema.name},
    )
    db.commit()
    db.refresh(schema)
    return schema_read(schema)


def create_document_classifier(payload: DocumentClassifierCreate, db: Session) -> DocumentClassifierRead:
    classifier = DocumentClassifier(
        name=payload.name,
        description=payload.description,
        allow_unknown=payload.allow_unknown,
        config_json=payload.model_dump(),
        archived=False,
    )
    db.add(classifier)
    db.flush()
    log_audit_event(
        db,
        entity_type="document_classifier",
        entity_id=classifier.id,
        action="created",
        message=f"Created document classifier {classifier.name}",
        metadata={"class_count": len(payload.classes)},
    )
    db.commit()
    db.refresh(classifier)
    return classifier_read(classifier)


def duplicate_document_classifier(classifier_id: str, db: Session) -> DocumentClassifierRead:
    classifier = db.get(DocumentClassifier, classifier_id)
    ensure_found(classifier, "Document classifier not found")
    config = classifier_data(classifier)
    existing_names = {
        row[0]
        for row in db.query(DocumentClassifier.name).filter(DocumentClassifier.archived == False).all()  # noqa: E712
    }
    duplicated_name = duplicate_name(classifier.name, existing_names)
    duplicated_config = {
        **config,
        "name": duplicated_name,
    }
    duplicated = DocumentClassifier(
        name=duplicated_name,
        description=classifier.description,
        allow_unknown=classifier.allow_unknown,
        config_json=duplicated_config,
        archived=False,
    )
    db.add(duplicated)
    db.flush()
    log_audit_event(
        db,
        entity_type="document_classifier",
        entity_id=duplicated.id,
        action="duplicated",
        message=f"Duplicated document classifier {classifier.name} to {duplicated.name}",
        metadata={"source_classifier_id": classifier.id, "class_count": len(duplicated_config["classes"])},
    )
    db.commit()
    db.refresh(duplicated)
    return classifier_read(duplicated)


def update_document_classifier(classifier_id: str, payload: DocumentClassifierUpdate, db: Session) -> DocumentClassifierRead:
    classifier = db.get(DocumentClassifier, classifier_id)
    ensure_found(classifier, "Document classifier not found")
    current = classifier_data(classifier)
    next_config = {
        "name": payload.name if payload.name is not None else classifier.name,
        "description": payload.description if "description" in payload.model_fields_set else classifier.description,
        "allow_unknown": payload.allow_unknown if payload.allow_unknown is not None else classifier.allow_unknown,
        "classes": [item.model_dump() for item in payload.classes] if payload.classes is not None else current["classes"],
    }
    classifier.name = next_config["name"]
    classifier.description = next_config["description"]
    classifier.allow_unknown = bool(next_config["allow_unknown"])
    classifier.config_json = next_config
    log_audit_event(
        db,
        entity_type="document_classifier",
        entity_id=classifier.id,
        action="updated",
        message=f"Updated document classifier {classifier.name}",
        metadata={"class_count": len(next_config["classes"])},
    )
    db.commit()
    db.refresh(classifier)
    return classifier_read(classifier)


def delete_document_classifier(classifier_id: str, db: Session) -> DocumentClassifierRead:
    classifier = db.get(DocumentClassifier, classifier_id)
    ensure_found(classifier, "Document classifier not found")
    classifier.archived = True
    log_audit_event(
        db,
        entity_type="document_classifier",
        entity_id=classifier.id,
        action="archived",
        message=f"Archived document classifier {classifier.name}",
        metadata={"name": classifier.name},
    )
    db.commit()
    db.refresh(classifier)
    return classifier_read(classifier)


def create_required_field_checklist(payload: RequiredFieldChecklistCreate, db: Session) -> RequiredFieldChecklistRead:
    checklist = RequiredFieldChecklist(
        name=payload.name,
        description=payload.description,
        config_json=payload.model_dump(),
        archived=False,
    )
    db.add(checklist)
    db.flush()
    log_audit_event(
        db,
        entity_type="required_field_checklist",
        entity_id=checklist.id,
        action="created",
        message=f"Created required field checklist {checklist.name}",
        metadata={"item_count": len(payload.items)},
    )
    db.commit()
    db.refresh(checklist)
    return checklist_read(checklist)


def recommend_required_field_checklist(
    payload: RequiredFieldChecklistRecommendationRequest, db: Session
) -> RequiredFieldChecklistRecommendationRead:
    document = db.get(Document, payload.document_id)
    ensure_found(document, "Document not found")
    try:
        recommendation = get_vlm_gateway().recommend_required_field_checklist([page.image_path for page in document.pages])
        recommendation_read = required_field_checklist_recommendation_read(recommendation)
        log_audit_event(
            db,
            entity_type="document",
            entity_id=document.id,
            action="required_field_checklist_recommended",
            message="AI required field checklist recommendation generated",
            metadata={
                "item_count": len(recommendation_read.items),
                "region_count": len(recommendation_read.regions),
            },
        )
        db.commit()
        return recommendation_read
    except (ValidationError, ValueError) as exc:
        raise UpstreamError(f"VLM returned an invalid checklist recommendation: {exc}") from exc
    except RuntimeError as exc:
        raise InvalidRequestError(vlm_error_detail(exc)) from exc


def duplicate_required_field_checklist(checklist_id: str, db: Session) -> RequiredFieldChecklistRead:
    checklist = db.get(RequiredFieldChecklist, checklist_id)
    ensure_found(checklist, "Required field checklist not found")
    config = checklist_data(checklist)
    existing_names = {
        row[0]
        for row in db.query(RequiredFieldChecklist.name).filter(RequiredFieldChecklist.archived == False).all()  # noqa: E712
    }
    duplicated_name = duplicate_name(checklist.name, existing_names)
    duplicated_config = {
        **config,
        "name": duplicated_name,
    }
    duplicated = RequiredFieldChecklist(
        name=duplicated_name,
        description=checklist.description,
        config_json=duplicated_config,
        archived=False,
    )
    db.add(duplicated)
    db.flush()
    log_audit_event(
        db,
        entity_type="required_field_checklist",
        entity_id=duplicated.id,
        action="duplicated",
        message=f"Duplicated required field checklist {checklist.name} to {duplicated.name}",
        metadata={"source_checklist_id": checklist.id, "item_count": len(duplicated_config["items"])},
    )
    db.commit()
    db.refresh(duplicated)
    return checklist_read(duplicated)


def update_required_field_checklist(checklist_id: str, payload: RequiredFieldChecklistUpdate, db: Session) -> RequiredFieldChecklistRead:
    checklist = db.get(RequiredFieldChecklist, checklist_id)
    ensure_found(checklist, "Required field checklist not found")
    current = checklist_data(checklist)
    next_config = {
        "name": payload.name if payload.name is not None else checklist.name,
        "description": payload.description if "description" in payload.model_fields_set else checklist.description,
        "regions": [region.model_dump() for region in payload.regions] if payload.regions is not None else current.get("regions", []),
        "items": [item.model_dump() for item in payload.items] if payload.items is not None else current["items"],
    }
    validate_checklist_region_references(next_config)
    checklist.name = next_config["name"]
    checklist.description = next_config["description"]
    checklist.config_json = next_config
    log_audit_event(
        db,
        entity_type="required_field_checklist",
        entity_id=checklist.id,
        action="updated",
        message=f"Updated required field checklist {checklist.name}",
        metadata={"item_count": len(next_config["items"])},
    )
    db.commit()
    db.refresh(checklist)
    return checklist_read(checklist)


def delete_required_field_checklist(checklist_id: str, db: Session) -> RequiredFieldChecklistRead:
    checklist = db.get(RequiredFieldChecklist, checklist_id)
    ensure_found(checklist, "Required field checklist not found")
    checklist.archived = True
    log_audit_event(
        db,
        entity_type="required_field_checklist",
        entity_id=checklist.id,
        action="archived",
        message=f"Archived required field checklist {checklist.name}",
        metadata={"name": checklist.name},
    )
    db.commit()
    db.refresh(checklist)
    return checklist_read(checklist)
