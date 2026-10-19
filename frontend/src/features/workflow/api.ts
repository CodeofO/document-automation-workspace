// 워크플로우 API 호출과 쿼리 키. 화면 코드는 경로 문자열 대신 이 함수들을 쓴다.
import { api, ApiError, jsonBody } from "../../api/client";
import type {
  ChecklistSummary,
  ClassifierSummary,
  SchemaSummary,
  WorkflowAiDraft,
  WorkflowAssets,
  WorkflowDefinition,
  WorkflowDocument,
  WorkflowRun
} from "./types";
import { WORKFLOW_RUN_HISTORY_LIMIT } from "./model/runRules";
import type { TableTemplate } from "../table-extraction";

export const workflowKeys = {
  all: ["workflow"] as const,
  runs: () => [...workflowKeys.all, "runs"] as const,
  runsList: () => [...workflowKeys.runs(), "list", WORKFLOW_RUN_HISTORY_LIMIT] as const,
  runSummary: (runId: string) => [...workflowKeys.runs(), "summary", runId] as const,
  runDetail: (runId: string) => [...workflowKeys.runs(), "detail", runId] as const,
  document: (documentId: string) => [...workflowKeys.all, "document", documentId] as const
};

// --- 정의·에셋 ---

export async function fetchWorkflowAssets(): Promise<WorkflowAssets> {
  const [workflows, schemas, classifiers, checklists, tableTemplates] = await Promise.all([
    api<WorkflowDefinition[]>("/api/workflows"),
    api<SchemaSummary[]>("/api/schemas"),
    api<ClassifierSummary[]>("/api/document-classifiers"),
    api<ChecklistSummary[]>("/api/required-field-checklists"),
    // 표 양식은 보조 에셋: 목록을 못 읽어도 워크플로우 화면은 연다.
    api<TableTemplate[]>("/api/table-templates").catch(() => [] as TableTemplate[])
  ]);
  return { workflows, schemas, classifiers, checklists, tableTemplates };
}

type WorkflowPayload = { name: string; description: string | null; definition: unknown };

export function createWorkflow(payload: WorkflowPayload) {
  return api<WorkflowDefinition>("/api/workflows", jsonBody("POST", payload));
}

export function updateWorkflow(workflowId: string, payload: WorkflowPayload) {
  return api<WorkflowDefinition>(`/api/workflows/${workflowId}`, jsonBody("PATCH", payload));
}

export function isWorkflowNotFoundError(error: unknown) {
  return error instanceof Error && error.message === "Workflow not found" && (!(error instanceof ApiError) || error.status === 404);
}

/** id가 있으면 PATCH, 없으면 POST. 에셋 3종 공용. */
function saveAsset<T>(collectionPath: string, assetId: string, payload: unknown) {
  return assetId
    ? api<T>(`${collectionPath}/${assetId}`, jsonBody("PATCH", payload))
    : api<T>(collectionPath, jsonBody("POST", payload));
}

export const saveClassifier = (classifierId: string, payload: unknown) =>
  saveAsset<ClassifierSummary>("/api/document-classifiers", classifierId, payload);
export const saveSchema = (schemaId: string, payload: unknown) => saveAsset<SchemaSummary>("/api/schemas", schemaId, payload);
export const saveChecklist = (checklistId: string, payload: unknown) =>
  saveAsset<ChecklistSummary>("/api/required-field-checklists", checklistId, payload);

export function generateWorkflowAiDraft(files: File[], includeChecklist: boolean) {
  const form = new FormData();
  files.forEach((file) => form.append("files", file));
  form.append("include_checklist", includeChecklist ? "true" : "false");
  return api<WorkflowAiDraft>("/api/workflows/ai-draft", { method: "POST", body: form });
}

// --- run ---

export function fetchWorkflowRuns() {
  return api<WorkflowRun[]>(`/api/workflow-runs?limit=${WORKFLOW_RUN_HISTORY_LIMIT}`);
}

export function fetchWorkflowRunSummary(runId: string, signal?: AbortSignal) {
  return api<WorkflowRun>(`/api/workflow-runs/${runId}/summary`, { signal });
}

export function fetchWorkflowRun(runId: string, signal?: AbortSignal) {
  return api<WorkflowRun>(`/api/workflow-runs/${runId}`, { signal });
}

export function startRunFromDocuments(workflowId: string, documentIds: string[], signal?: AbortSignal) {
  return api<WorkflowRun>(`/api/workflows/${workflowId}/runs/from-documents`, {
    ...jsonBody("POST", { document_ids: documentIds }),
    signal
  });
}

type RunAction = "resume" | "pause" | "start" | "discard" | "retry-failed";

export function postRunAction(runId: string, action: RunAction, signal?: AbortSignal) {
  return api<WorkflowRun>(`/api/workflow-runs/${runId}/${action}`, { method: "POST", signal });
}

export function enqueueRun(runId: string, workflowId: string) {
  return api<WorkflowRun>(`/api/workflow-runs/${runId}/enqueue`, jsonBody("POST", { workflow_id: workflowId }));
}

export function deleteRunQueueEntry(runId: string) {
  return api<{ status: string; id: string }>(`/api/workflow-runs/${runId}/queue-entry`, { method: "DELETE" });
}

// --- 문서 미리보기 ---

export function fetchWorkflowDocument(documentId: string, signal?: AbortSignal) {
  return api<WorkflowDocument>(`/api/documents/${documentId}`, { signal });
}
