// 단위 테스트용 run/item 생성기.
import type { WorkflowRun, WorkflowRunItem } from "../types";

export function makeItem(overrides: Partial<WorkflowRunItem> = {}): WorkflowRunItem {
  return {
    id: "item-1",
    document_id: "doc-1",
    filename: "a.pdf",
    status: "completed",
    error_message: null,
    result: {},
    ...overrides
  };
}

export function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: "run-1",
    workflow_id: "wf-1",
    workflow_name: "WF",
    status: "running",
    total_count: 2,
    completed_count: 0,
    failed_count: 0,
    needs_review_count: 0,
    progress: 0,
    error_message: null,
    items: [],
    created_at: "2026-10-15T00:00:00",
    ...overrides
  };
}
