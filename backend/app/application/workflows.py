import copy
import shutil
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.application.definitions import available_scoped_name, required_field_checklist_recommendation_read, schema_recommendation_read
from app.application.uploads import UploadedFile
from app.application.workflow_drafts import save_workflow_ai_draft_images, workflow_ai_draft_definition, workflow_ai_draft_name
from app.audit import log_audit_event
from app.core.errors import InvalidRequestError, NotFoundError, UnprocessableError, UpstreamError
from app.models import (
    RequiredFieldChecklist,
    Schema,
    WorkflowDefinition,
)
from app.schemas import (
    RequiredFieldChecklistCreate,
    SchemaCreate,
    WorkflowAiDraftRead,
    WorkflowDefinitionCreate,
    WorkflowDefinitionRead,
    WorkflowDefinitionUpdate,
)
from app.vlm import get_vlm_gateway, vlm_error_detail
from app.workflows import (
    WorkflowDefinitionError,
    validate_workflow_definition,
    workflow_definition_to_read,
)


def create_workflow(payload: WorkflowDefinitionCreate, db: Session) -> WorkflowDefinitionRead:
    try:
        validate_workflow_definition(payload.definition, db)
    except WorkflowDefinitionError as exc:
        raise UnprocessableError({"errors": exc.errors}) from exc
    workflow = WorkflowDefinition(
        name=payload.name.strip(),
        description=payload.description,
        definition_json=copy.deepcopy(payload.definition),
        archived=False,
    )
    db.add(workflow)
    db.flush()
    log_audit_event(
        db,
        entity_type="workflow_definition",
        entity_id=workflow.id,
        action="created",
        message=f"Created workflow {workflow.name}",
        metadata={"node_count": len(payload.definition.get("nodes", [])), "edge_count": len(payload.definition.get("edges", []))},
    )
    db.commit()
    db.refresh(workflow)
    return WorkflowDefinitionRead(**workflow_definition_to_read(workflow, db))


def create_workflow_ai_draft(files: list[UploadedFile], include_checklist: bool, db: Session) -> WorkflowAiDraftRead:
    image_paths = save_workflow_ai_draft_images(files)
    try:
        schema_recommendation = schema_recommendation_read(get_vlm_gateway().recommend_schema([str(path) for path in image_paths]))
        schema_name = available_scoped_name(
            db,
            Schema,
            schema_recommendation.name or "AI 추천 schema",
        )
        schema_draft = SchemaCreate(
            name=schema_name,
            display_name=schema_recommendation.display_name or schema_name,
            description=schema_recommendation.description,
            fields=schema_recommendation.fields,
            regions=[],
        )

        checklist_draft = None
        if include_checklist:
            checklist_recommendation = required_field_checklist_recommendation_read(
                get_vlm_gateway().recommend_required_field_checklist([str(path) for path in image_paths])
            )
            checklist_draft = RequiredFieldChecklistCreate(
                name=available_scoped_name(
                    db,
                    RequiredFieldChecklist,
                    checklist_recommendation.name or "AI 추천 checklist",
                ),
                description=checklist_recommendation.description,
                regions=checklist_recommendation.regions,
                items=checklist_recommendation.items,
            )

        definition = workflow_ai_draft_definition(include_checklist=checklist_draft is not None)
        workflow_name = workflow_ai_draft_name(schema_draft, sample_count=len(image_paths))
        draft_event_id = f"workflow_ai_draft_{uuid4().hex}"
        log_audit_event(
            db,
            entity_type="workflow_ai_draft",
            entity_id=draft_event_id,
            action="created",
            message="AI workflow draft generated without persisting sample images",
            metadata={
                "sample_count": len(image_paths),
                "schema_field_count": len(schema_draft.fields),
                "checklist_item_count": len(checklist_draft.items) if checklist_draft else 0,
                "images_persisted": False,
            },
        )
        db.commit()
        return WorkflowAiDraftRead(
            workflow_name=workflow_name,
            schema_draft=schema_draft,
            checklist_draft=checklist_draft,
            definition=definition,
            sample_count=len(image_paths),
            images_persisted=False,
            reasoning=schema_recommendation.reasoning,
        )
    except (ValidationError, ValueError) as exc:
        raise UpstreamError(f"VLM returned an invalid workflow draft recommendation: {exc}") from exc
    except RuntimeError as exc:
        raise InvalidRequestError(vlm_error_detail(exc)) from exc
    finally:
        for path in image_paths:
            shutil.rmtree(path.parent, ignore_errors=True)


def update_workflow(workflow_id: str, payload: WorkflowDefinitionUpdate, db: Session) -> WorkflowDefinitionRead:
    workflow = db.get(WorkflowDefinition, workflow_id)
    if not workflow or workflow.archived:
        raise NotFoundError("Workflow not found")
    if payload.definition is not None:
        try:
            validate_workflow_definition(payload.definition, db)
        except WorkflowDefinitionError as exc:
            raise UnprocessableError({"errors": exc.errors}) from exc
        workflow.definition_json = copy.deepcopy(payload.definition)
    if payload.name is not None:
        workflow.name = payload.name.strip()
    if "description" in payload.model_fields_set:
        workflow.description = payload.description
    log_audit_event(
        db,
        entity_type="workflow_definition",
        entity_id=workflow.id,
        action="updated",
        message=f"Updated workflow {workflow.name}",
        metadata={},
    )
    db.commit()
    db.refresh(workflow)
    return WorkflowDefinitionRead(**workflow_definition_to_read(workflow, db))


def delete_workflow(workflow_id: str, db: Session) -> WorkflowDefinitionRead:
    workflow = db.get(WorkflowDefinition, workflow_id)
    if not workflow:
        raise NotFoundError("Workflow not found")
    workflow.archived = True
    log_audit_event(
        db,
        entity_type="workflow_definition",
        entity_id=workflow.id,
        action="archived",
        message=f"Archived workflow {workflow.name}",
        metadata={},
    )
    db.commit()
    db.refresh(workflow)
    return WorkflowDefinitionRead(**workflow_definition_to_read(workflow, db))
