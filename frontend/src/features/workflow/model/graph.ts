// 캔버스 그래프(노드·엣지) 규칙. React에 의존하지 않는 순수 함수만 둔다.
import type { Connection } from "@xyflow/react";
import type {
  ClassifierSummary,
  WorkflowChecklistDraft,
  WorkflowClassifierDraft,
  WorkflowEdge,
  WorkflowIssue,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowNodeView,
  WorkflowSchemaDraft
} from "../types";

export const UNKNOWN_BRANCH_KEY = "unknown";
export const DEFAULT_WORKFLOW_NAME = "문서 자동화 워크플로우";

export const nodePalette: { kind: WorkflowNodeKind; label: string; description: string }[] = [
  { kind: "input", label: "문서 입력", description: "처리할 문서를 워크플로우에 전달합니다." },
  { kind: "classifier", label: "문서 분류", description: "결과는 정의한 class 또는 unknown입니다." },
  { kind: "branch", label: "분기", description: "분류 class별 경로를 나눕니다." },
  { kind: "kie", label: "핵심 정보 추출", description: "저장된 schema로 값을 추출합니다." },
  { kind: "required-checker", label: "필수 항목 확인", description: "저장된 checklist를 확인합니다." },
  { kind: "table", label: "표 추출", description: "표 양식으로 행이 여러 개인 표를 행 단위로 읽습니다." },
  { kind: "rotation", label: "회전 보정", description: "돌아간 페이지를 감지해 정방향으로 보정합니다." },
  { kind: "merge", label: "결과 병합", description: "실행된 branch 결과를 합칩니다." },
  { kind: "export", label: "Export", description: "통합 결과 파일을 만듭니다." }
];

export function workflowNode(
  kind: WorkflowNodeKind,
  label: string,
  x: number,
  y: number,
  config: Record<string, string> = {},
  branchKeys?: string[],
  id?: string
): WorkflowNode {
  return {
    id: id ?? `${kind}_${crypto.randomUUID().slice(0, 8)}`,
    type: "workflow",
    position: { x, y },
    data: { kind, label, config, branchKeys }
  };
}

export function workflowEdge(source: string, target: string, sourceHandle?: string): WorkflowEdge {
  return {
    id: `${source}-${sourceHandle || "out"}-${target}`,
    source,
    target,
    sourceHandle,
    animated: false,
    label: sourceHandle ? branchKeyLabel(sourceHandle) : undefined
  };
}

export const defaultNodes: WorkflowNode[] = [
  workflowNode("input", "문서 입력", 0, 150, {}, undefined, "input"),
  workflowNode("classifier", "문서 분류", 230, 150, {}, undefined, "classifier"),
  workflowNode("branch", "분기", 470, 150, {}, [UNKNOWN_BRANCH_KEY], "branch"),
  workflowNode("kie", "핵심 정보 추출", 730, 70, {}, undefined, "kie_contract"),
  workflowNode("required-checker", "필수 항목 확인", 970, 70, {}, undefined, "required_contract"),
  workflowNode("merge", "결과 병합", 1210, 150, {}, undefined, "merge"),
  workflowNode("export", "Export", 1450, 150, {}, undefined, "export")
];

export const defaultEdges: WorkflowEdge[] = [
  workflowEdge("input", "classifier"),
  workflowEdge("classifier", "branch"),
  workflowEdge("branch", "kie_contract", UNKNOWN_BRANCH_KEY),
  workflowEdge("kie_contract", "required_contract"),
  workflowEdge("required_contract", "merge"),
  workflowEdge("merge", "export")
];

export function branchKeyLabel(key: string) {
  if (key.startsWith("class:")) return key.replace("class:", "분류 · ");
  return key;
}

export function normalizeBranchKeys(keys: string[] | undefined) {
  const normalized = (keys?.length ? keys : [UNKNOWN_BRANCH_KEY]).filter(
    (key) => key && key !== "default" && key !== "needs_review"
  );
  if (!normalized.includes(UNKNOWN_BRANCH_KEY)) normalized.push(UNKNOWN_BRANCH_KEY);
  return [...new Set(normalized)];
}

function normalizeBranchHandle(handle: string | undefined) {
  if (handle === "default" || handle === "needs_review") return UNKNOWN_BRANCH_KEY;
  return handle;
}

export function normalizeWorkflowEdge(edge: WorkflowEdge): WorkflowEdge {
  const sourceHandle = normalizeBranchHandle(typeof edge.sourceHandle === "string" ? edge.sourceHandle : undefined);
  return {
    ...edge,
    id: edge.id || `${edge.source}-${sourceHandle || "out"}-${edge.target}`,
    sourceHandle,
    animated: false,
    label: sourceHandle ? branchKeyLabel(sourceHandle) : edge.label
  };
}

/** 엣지를 정규화하고, 같은 branch handle에서 나가는 중복 route는 첫 번째만 남긴다. */
export function normalizeWorkflowEdges(edges: WorkflowEdge[]): WorkflowEdge[] {
  const seenRouteKeys = new Set<string>();
  return edges.map(normalizeWorkflowEdge).filter((edge) => {
    if (!edge.sourceHandle) return true;
    const routeKey = `${edge.source}:${edge.sourceHandle}`;
    if (seenRouteKeys.has(routeKey)) return false;
    seenRouteKeys.add(routeKey);
    return true;
  });
}

/**
 * 캔버스의 config는 문자열 값만 둔다. 서버가 목록을 돌려주는 값(표 노드 table_keys)은 쉼표로 잇는다.
 */
function canvasConfig(config: Record<string, unknown> | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(config ?? {})) {
    if (value === null || value === undefined) continue;
    result[key] = Array.isArray(value) ? value.map(String).join(",") : String(value);
  }
  return result;
}

/** 서버로 보낼 config. 표 노드 table_keys는 목록(비면 생략 = 양식의 표 전체). */
function serverConfig(kind: WorkflowNodeKind, config: Record<string, string>): Record<string, unknown> {
  if (kind !== "table") return config;
  const { table_keys: tableKeys, ...rest } = config;
  const keys = (tableKeys ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
  return keys.length ? { ...rest, table_keys: keys } : rest;
}

/** 캔버스 렌더용 필드(콜백·파생값)를 떼고 저장 가능한 노드로. */
export function normalizeWorkflowNode(node: WorkflowNode): WorkflowNode {
  // view는 렌더 전용이고, 나머지 셋은 예전 초안(localStorage)에 남아 있을 수 있는 필드다.
  const {
    view: _view,
    connectedBranchKeys: _connectedBranchKeys,
    configSelect: _configSelect,
    onConfigChange: _onConfigChange,
    onSelect: _onSelect,
    ...data
  } = node.data as WorkflowNode["data"] & Record<string, unknown>;
  const branchKeys = data.kind === "branch" ? normalizeBranchKeys(data.branchKeys) : data.branchKeys;
  return {
    ...node,
    type: "workflow",
    data: {
      ...data,
      branchKeys,
      config: canvasConfig(data.config)
    }
  };
}

/** 캔버스 노드에 렌더용 파생값(view)을 붙인다. 선택 상태는 nodes의 selected를 그대로 쓴다. */
export function buildCanvasNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  views: Record<string, Omit<WorkflowNodeView, "connectedBranchKeys">>
): WorkflowNode[] {
  return nodes.map((node) => {
    const connectedBranchKeys =
      node.data.kind === "branch"
        ? edges.filter((edge) => edge.source === node.id && edge.sourceHandle).map((edge) => String(edge.sourceHandle))
        : undefined;
    const view = views[node.id] ?? { errorCount: 0, warningCount: 0, hasDraft: false };
    return { ...node, data: { ...node.data, view: { ...view, connectedBranchKeys } } };
  });
}

/** 노드를 복제한다(새 id, 조금 옆 위치, 같은 config). 에셋 초안은 복제하지 않는다. */
export function duplicateWorkflowNode(node: WorkflowNode, offset = 48): WorkflowNode {
  const copy = workflowNode(
    node.data.kind,
    `${node.data.label} 복사`,
    node.position.x + offset,
    node.position.y + offset,
    { ...(node.data.config ?? {}) },
    node.data.branchKeys ? [...node.data.branchKeys] : undefined
  );
  return { ...copy, selected: true };
}

export function edgeLabel(edge: WorkflowEdge, nodes: WorkflowNode[]) {
  const source = nodes.find((node) => node.id === edge.source);
  const target = nodes.find((node) => node.id === edge.target);
  const sourceLabel = source?.data.label ?? edge.source;
  const targetLabel = target?.data.label ?? edge.target;
  const routeLabel = edge.sourceHandle ? ` · ${branchKeyLabel(String(edge.sourceHandle))}` : "";
  return `${sourceLabel}${routeLabel} → ${targetLabel}`;
}

/** 서버에 저장할 definition. 캔버스 전용 필드는 뺀다. */
export function serializeDefinition(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  return {
    nodes: nodes.map((node) => {
      const data = normalizeWorkflowNode(node).data;
      return {
        id: node.id,
        type: "workflow",
        position: node.position,
        data: { ...data, config: serverConfig(data.kind, data.config ?? {}) }
      };
    }),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      data: edge.data
    }))
  };
}

export function updateWorkflowNodeConfig(nodes: WorkflowNode[], nodeId: string, key: string, value: string) {
  return nodes.map((node) => {
    if (node.id !== nodeId) return node;
    return { ...node, data: { ...node.data, config: { ...(node.data.config ?? {}), [key]: value } } };
  });
}

export function syncBranchKeysFromClassNames(nodes: WorkflowNode[], classNames: string[]) {
  const branchKeys = [
    ...classNames
      .map((className) => className.trim())
      .filter(Boolean)
      .map((className) => `class:${className}`),
    UNKNOWN_BRANCH_KEY
  ];
  return nodes.map((node) => {
    if (node.data.kind !== "branch") return node;
    return { ...node, data: { ...node.data, branchKeys } };
  });
}

export function syncBranchKeys(nodes: WorkflowNode[], classifierId: string, classifiers: ClassifierSummary[]) {
  const classifier = classifiers.find((item) => item.id === classifierId);
  return syncBranchKeysFromClassNames(nodes, classifier?.classes.map((item) => item.class_name) ?? []);
}

export function workflowNodeHasAssetEditor(node: WorkflowNode | null | undefined): node is WorkflowNode {
  return node?.data.kind === "classifier" || node?.data.kind === "kie" || node?.data.kind === "required-checker";
}

export function nodeKindLabel(kind: WorkflowNodeKind) {
  return nodePalette.find((item) => item.kind === kind)?.label ?? kind;
}

export function nodeKindDescription(kind: WorkflowNodeKind) {
  const found = nodePalette.find((item) => item.kind === kind);
  return found?.description ?? kind;
}

export function workflowNodeConfigIsEmpty(node: WorkflowNode) {
  return !Object.values(node.data.config ?? {}).some((value) => String(value || "").trim());
}

/** 연결이 불가능하면 이유 문장을, 가능하면 null. */
export function validateConnection(connection: Connection, nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  if (!connection.source || !connection.target) return "연결할 시작/도착 노드가 필요합니다.";
  if (connection.source === connection.target) return "같은 노드끼리는 연결할 수 없습니다.";
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  if (!source || !target) return "연결 대상 노드를 찾지 못했습니다.";
  if (source.data.kind === "export") return "Export 뒤에는 노드를 연결할 수 없습니다.";
  if (target.data.kind === "input") return "Input 앞에는 노드를 연결할 수 없습니다.";
  if (target.data.kind === "branch" && source.data.kind !== "classifier") return "Branch 앞에는 Document Classifier만 연결하세요.";
  if (source.data.kind === "branch" && !connection.sourceHandle) return "Branch는 class 또는 unknown handle에서 연결하세요.";
  if (
    source.data.kind === "branch" &&
    edges.some((edge) => edge.source === connection.source && edge.sourceHandle === connection.sourceHandle)
  ) {
    return "이 branch route는 이미 후속 노드가 있습니다. 기존 선을 삭제한 뒤 다시 연결하세요.";
  }
  if (
    edges.some(
      (edge) =>
        edge.source === connection.source &&
        edge.target === connection.target &&
        edge.sourceHandle === connection.sourceHandle
    )
  ) {
    return "이미 같은 연결이 있습니다.";
  }
  if (source.data.kind !== "branch" && edges.some((edge) => edge.source === connection.source)) {
    return "이 노드의 기존 outgoing 연결을 먼저 삭제하세요.";
  }
  return null;
}

export function reachableNodeIds(startNodeId: string, edges: WorkflowEdge[]) {
  const visited = new Set<string>();
  const stack = [startNodeId];
  while (stack.length) {
    const nodeId = stack.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    edges.filter((edge) => edge.source === nodeId).forEach((edge) => stack.push(edge.target));
  }
  return visited;
}

/** 워크플로우 검증 결과. 노드에 묶을 수 있는 문제는 nodeId를 단다(Inspector·노드 배지용). */
export function workflowIssues(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  classifierDraftsByNodeId: Record<string, WorkflowClassifierDraft> = {},
  schemaDraftsByNodeId: Record<string, WorkflowSchemaDraft> = {},
  checklistDraftsByNodeId: Record<string, WorkflowChecklistDraft> = {}
): WorkflowIssue[] {
  const issues: WorkflowIssue[] = [];
  const error = (message: string, nodeId?: string) => issues.push({ level: "error", message, nodeId });
  const warning = (message: string, nodeId?: string) => issues.push({ level: "warning", message, nodeId });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const inputNode = nodes.find((node) => node.data.kind === "input");
  const activeNodeIds = inputNode ? reachableNodeIds(inputNode.id, edges) : new Set(nodes.map((node) => node.id));
  const inputCount = nodes.filter((node) => node.data.kind === "input").length;
  if (inputCount !== 1) error("Input 노드는 정확히 1개여야 합니다.");
  if (!nodes.some((node) => node.data.kind === "export")) error("Export 노드가 필요합니다.");
  nodes.forEach((node) => {
    if (!activeNodeIds.has(node.id)) {
      warning(`${node.data.label} 노드는 현재 실행 경로에 연결되어 있지 않습니다.`, node.id);
      return;
    }
    if (node.data.kind === "classifier" && !node.data.config?.classifier_id && !classifierDraftsByNodeId[node.id]) {
      error("문서 분류 노드에 classifier를 선택하세요.", node.id);
    }
    if (node.data.kind === "kie" && !node.data.config?.schema_id && !schemaDraftsByNodeId[node.id]) {
      error("KIE 노드에 schema를 선택하세요.", node.id);
    }
    if (node.data.kind === "required-checker" && !node.data.config?.checklist_id && !checklistDraftsByNodeId[node.id]) {
      error("필수 항목 확인 노드에 checklist를 선택하세요.", node.id);
    }
    if (node.data.kind === "table" && !node.data.config?.template_id) {
      error("표 추출 노드에 표 양식을 선택하세요.", node.id);
    }
    if (node.data.kind === "branch") {
      const incoming = edges.filter((edge) => edge.target === node.id);
      if (!incoming.some((edge) => byId.get(edge.source)?.data.kind === "classifier")) {
        error("Branch 노드는 classifier 바로 뒤에 연결하세요.", node.id);
      }
      const sourceHandles = edges
        .filter((edge) => edge.source === node.id)
        .map((edge) => edge.sourceHandle || UNKNOWN_BRANCH_KEY);
      normalizeBranchKeys(node.data.branchKeys).forEach((key) => {
        if (!sourceHandles.includes(key)) {
          warning(`Branch ${branchKeyLabel(key)} 경로가 없습니다. 해당 문서는 분류 결과만 export됩니다.`, node.id);
        }
      });
    }
  });
  return issues;
}

/** 문장 목록으로 줄인 검증 결과(같은 문장은 한 번만). */
export function summarizeIssues(issues: WorkflowIssue[]) {
  const pick = (level: WorkflowIssue["level"]) => [
    ...new Set(issues.filter((issue) => issue.level === level).map((issue) => issue.message))
  ];
  return { errors: pick("error"), warnings: pick("warning") };
}

export function validateWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  classifierDraftsByNodeId: Record<string, WorkflowClassifierDraft> = {},
  schemaDraftsByNodeId: Record<string, WorkflowSchemaDraft> = {},
  checklistDraftsByNodeId: Record<string, WorkflowChecklistDraft> = {}
) {
  return summarizeIssues(workflowIssues(nodes, edges, classifierDraftsByNodeId, schemaDraftsByNodeId, checklistDraftsByNodeId));
}

export function upsertById<T extends { id: string }>(items: T[], item: T) {
  return [item, ...items.filter((current) => current.id !== item.id)];
}

/** 저장된 항목 묶음을 목록 앞으로 올리고 같은 id의 예전 값은 뺀다. */
export function prependSaved<T extends { id: string }>(items: T[], saved: T[]) {
  if (!saved.length) return items;
  return [...saved, ...items.filter((item) => !saved.some((entry) => entry.id === item.id))];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 우클릭 위치에 노드 추가 메뉴를 띄울 때 화면 밖으로 나가지 않게 한다. */
export function workflowContextMenuPosition(clientX: number, clientY: number, viewport = { width: window.innerWidth, height: window.innerHeight }) {
  const menuWidth = 220;
  const menuHeight = 300;
  return {
    left: Math.max(8, Math.min(clientX, viewport.width - menuWidth)),
    top: Math.max(8, Math.min(clientY, viewport.height - menuHeight))
  };
}
