// 캔버스 초안을 localStorage에 남기고 되살린다.
import { readJson, writeJson } from "../../../lib/storage";
import type {
  WorkflowChecklistDraft,
  WorkflowClassifierDraft,
  WorkflowDraft,
  WorkflowEdge,
  WorkflowSchemaDraft
} from "../types";
import { DEFAULT_WORKFLOW_NAME, isRecord, normalizeWorkflowEdges, normalizeWorkflowNode } from "./graph";

export const WORKFLOW_DRAFT_KEY = "digitize_workflow_builder_draft_v1";

export function parseWorkflowDraft(parsed: Partial<WorkflowDraft> | null): WorkflowDraft | null {
  if (!parsed || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
  return {
    activeWorkflowId: typeof parsed.activeWorkflowId === "string" ? parsed.activeWorkflowId : "",
    workflowName:
      typeof parsed.workflowName === "string" && parsed.workflowName.trim() ? parsed.workflowName : DEFAULT_WORKFLOW_NAME,
    workflowDescription: typeof parsed.workflowDescription === "string" ? parsed.workflowDescription : "",
    // 선택 상태는 저장하지 않는다. 화면에 들어오면 항상 선택 없음으로 시작한다(예전 초안의 selectedNodeId는 무시).
    nodes: parsed.nodes.map(normalizeWorkflowNode).map((node) => ({ ...node, selected: false })),
    edges: normalizeWorkflowEdges(parsed.edges as WorkflowEdge[]).map((edge) => ({ ...edge, selected: false })),
    classifierDraftsByNodeId: isRecord(parsed.classifierDraftsByNodeId)
      ? (parsed.classifierDraftsByNodeId as Record<string, WorkflowClassifierDraft>)
      : {},
    schemaDraftsByNodeId: isRecord(parsed.schemaDraftsByNodeId)
      ? (parsed.schemaDraftsByNodeId as Record<string, WorkflowSchemaDraft>)
      : {},
    checklistDraftsByNodeId: isRecord(parsed.checklistDraftsByNodeId)
      ? (parsed.checklistDraftsByNodeId as Record<string, WorkflowChecklistDraft>)
      : {}
  };
}

export function readWorkflowDraft(): WorkflowDraft | null {
  try {
    return parseWorkflowDraft(readJson<Partial<WorkflowDraft>>(WORKFLOW_DRAFT_KEY));
  } catch {
    return null;
  }
}

/** 저장 가능한 모양으로 줄인다(캔버스 상태 필드는 뺀다). */
export function serializeWorkflowDraft(draft: WorkflowDraft) {
  return {
    activeWorkflowId: draft.activeWorkflowId,
    workflowName: draft.workflowName,
    workflowDescription: draft.workflowDescription ?? "",
    nodes: draft.nodes.map((node) => ({
      id: node.id,
      type: "workflow",
      position: node.position,
      data: normalizeWorkflowNode(node).data
    })),
    edges: draft.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      label: edge.label,
      animated: false,
      data: edge.data
    })),
    classifierDraftsByNodeId: draft.classifierDraftsByNodeId ?? {},
    schemaDraftsByNodeId: draft.schemaDraftsByNodeId ?? {},
    checklistDraftsByNodeId: draft.checklistDraftsByNodeId ?? {}
  };
}

export function writeWorkflowDraft(draft: WorkflowDraft) {
  try {
    writeJson(WORKFLOW_DRAFT_KEY, serializeWorkflowDraft(draft));
  } catch {
    // 직렬화할 수 없는 값이 섞이면 이번 저장만 건너뛴다.
  }
}
