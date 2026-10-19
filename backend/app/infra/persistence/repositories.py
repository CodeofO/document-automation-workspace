from sqlalchemy.orm import Session

from app.models import WorkflowRun


class SqlAlchemyWorkflowRunRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get(self, run_id: str) -> WorkflowRun | None:
        return self.db.get(WorkflowRun, run_id)

    def refresh(self, run: WorkflowRun) -> None:
        self.db.refresh(run)

    def list_recent(self, *, limit: int) -> list[WorkflowRun]:
        return self.db.query(WorkflowRun).order_by(WorkflowRun.created_at.desc(), WorkflowRun.id.desc()).limit(limit).all()
