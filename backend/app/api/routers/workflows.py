from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.application import workflows as workflows_service
from app.core.errors import NotFoundError
from app.models import WorkflowDefinition
from app.schemas import (
    WorkflowAiDraftRead,
    WorkflowDefinitionCreate,
    WorkflowDefinitionRead,
    WorkflowDefinitionUpdate,
)
from app.workflows import workflow_definition_to_read

router = APIRouter()


@router.post("/api/workflows", response_model=WorkflowDefinitionRead)
def create_workflow(payload: WorkflowDefinitionCreate, db: Session = Depends(get_db)) -> WorkflowDefinitionRead:
    return workflows_service.create_workflow(payload, db)


@router.get("/api/workflows", response_model=list[WorkflowDefinitionRead])
def list_workflows(include_archived: bool = False, db: Session = Depends(get_db)) -> list[WorkflowDefinitionRead]:
    query = db.query(WorkflowDefinition)
    if not include_archived:
        query = query.filter(WorkflowDefinition.archived == False)  # noqa: E712
    workflows = query.order_by(WorkflowDefinition.created_at.desc()).all()
    return [WorkflowDefinitionRead(**workflow_definition_to_read(workflow, db)) for workflow in workflows]


@router.post("/api/workflows/ai-draft", response_model=WorkflowAiDraftRead)
def create_workflow_ai_draft(
    files: list[UploadFile] = File(...),
    include_checklist: bool = Form(True),
    db: Session = Depends(get_db),
) -> WorkflowAiDraftRead:
    return workflows_service.create_workflow_ai_draft(files, include_checklist, db)


@router.get("/api/workflows/{workflow_id}", response_model=WorkflowDefinitionRead)
def get_workflow(workflow_id: str, db: Session = Depends(get_db)) -> WorkflowDefinitionRead:
    workflow = db.get(WorkflowDefinition, workflow_id)
    if not workflow or workflow.archived:
        raise NotFoundError("Workflow not found")
    return WorkflowDefinitionRead(**workflow_definition_to_read(workflow, db))


@router.patch("/api/workflows/{workflow_id}", response_model=WorkflowDefinitionRead)
def update_workflow(
    workflow_id: str,
    payload: WorkflowDefinitionUpdate,
    db: Session = Depends(get_db),
) -> WorkflowDefinitionRead:
    return workflows_service.update_workflow(workflow_id, payload, db)


@router.delete("/api/workflows/{workflow_id}", response_model=WorkflowDefinitionRead)
def delete_workflow(workflow_id: str, db: Session = Depends(get_db)) -> WorkflowDefinitionRead:
    return workflows_service.delete_workflow(workflow_id, db)
