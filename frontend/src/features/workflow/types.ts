// 워크플로우 기능의 타입. API 응답은 가능한 한 생성 타입(Schemas)에서 파생하고,
// 캔버스·초안처럼 화면 전용인 모양은 여기서 정의한다.
import type { Edge, Node } from "@xyflow/react";
import type { Schemas } from "../../api/client";
import type { RotationPageResult } from "../rotation";
import type { TableTemplate } from "../table-extraction";

export type WorkflowNodeKind =
  | "input"
  | "classifier"
  | "branch"
  | "kie"
  | "required-checker"
  | "table"
  | "rotation"
  | "merge"
  | "export";
export type WorkflowResultFilter = "all" | "success" | "failed" | "waiting" | "running" | "review";
export type WorkflowOutputFormat = "string" | "float" | "bool" | "date";

export type WorkflowClassFilterOption = {
  value: string;
  label: string;
  count: number;
};

export type WorkflowNodeContextMenu = {
  left: number;
  top: number;
  flowPosition: { x: number; y: number };
};

export type ReactFlowScreenProjector = {
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
  fitView?: (options?: { padding?: number; duration?: number }) => void;
  setViewport?: (viewport: { x: number; y: number; zoom: number }, options?: { duration?: number }) => void;
};

/** 캔버스 렌더 전용 파생값. 저장할 때는 normalizeWorkflowNode가 뗀다. */
export type WorkflowNodeView = {
  /** 읽기 전용 에셋 칩. 예: "스키마: 계약서 · 12필드" */
  chip?: string;
  chipMissing?: boolean;
  errorCount: number;
  warningCount: number;
  /** 저장되지 않은 에셋 초안이 있다. */
  hasDraft: boolean;
  connectedBranchKeys?: string[];
};

export type WorkflowNodeData = {
  kind: WorkflowNodeKind;
  label: string;
  config?: Record<string, string>;
  branchKeys?: string[];
  view?: WorkflowNodeView;
};

/** 캔버스 선택. React Flow onSelectionChange 하나로만 바뀐다. */
export type WorkflowSelection =
  | { type: "none" }
  | { type: "nodes"; ids: string[] }
  | { type: "edge"; id: string };

export type WorkflowIssue = { level: "error" | "warning"; message: string; nodeId?: string };

export type WorkflowNode = Node<WorkflowNodeData>;
export type WorkflowEdge = Edge;

export type WorkflowSchemaRegion = {
  id: string;
  name: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkflowSchemaField = {
  key_name: string;
  description: string;
  output_format: WorkflowOutputFormat;
  region_id?: string | null;
  judgement_enabled?: boolean;
};

export type WorkflowSchemaDraft = {
  name: string;
  display_name?: string | null;
  description?: string | null;
  is_template?: boolean;
  template_category?: string | null;
  pinned?: boolean;
  regions?: WorkflowSchemaRegion[];
  fields: WorkflowSchemaField[];
};

export type SchemaSummary = {
  id: string;
  name: string;
  display_name: string | null;
  description?: string | null;
  regions?: WorkflowSchemaRegion[];
  fields: WorkflowSchemaField[];
};

export type WorkflowClassifierClass = {
  class_name: string;
  description: string;
  signals: string[];
};

export type WorkflowClassifierDraft = {
  name: string;
  description?: string | null;
  allow_unknown: boolean;
  classes: WorkflowClassifierClass[];
};

export type ClassifierSummary = {
  id: string;
  name: string;
  description?: string | null;
  allow_unknown?: boolean;
  classes: WorkflowClassifierClass[];
};

export type WorkflowChecklistItem = {
  item_name: string;
  description: string;
  evidence_type: string;
  required: boolean;
  region_id?: string | null;
};

export type ChecklistSummary = {
  id: string;
  name: string;
  description?: string | null;
  regions?: WorkflowSchemaRegion[];
  items: WorkflowChecklistItem[];
};

export type WorkflowChecklistDraft = {
  name: string;
  description?: string | null;
  regions?: WorkflowSchemaRegion[];
  items: WorkflowChecklistItem[];
};

export type WorkflowGraph = { nodes: WorkflowNode[]; edges: WorkflowEdge[] };

export type WorkflowAiDraft = {
  workflow_name: string;
  schema_draft: WorkflowSchemaDraft;
  checklist_draft?: WorkflowChecklistDraft | null;
  definition: WorkflowGraph;
  sample_count: number;
  images_persisted: boolean;
  reasoning?: string | null;
};

/** 생성 타입의 definition은 Record<string, unknown>이라 캔버스 그래프 모양으로 좁힌다. */
export type WorkflowDefinition = Pick<Schemas["WorkflowDefinitionRead"], "id" | "name" | "description"> & {
  definition: WorkflowGraph;
  validation_warnings: string[];
};

export type WorkflowAssets = {
  workflows: WorkflowDefinition[];
  schemas: SchemaSummary[];
  classifiers: ClassifierSummary[];
  checklists: ChecklistSummary[];
  /** 표 양식(표 추출 노드). 목록을 못 읽으면 빈 배열. */
  tableTemplates?: TableTemplate[];
};

/** run item 결과의 KIE 값 하나(kie_values[field]). */
export type WorkflowKieValue = {
  value?: unknown;
  normalized_value?: unknown;
  evidence?: string | null;
  confidence?: number | null;
  page?: number | null;
  warnings?: string[] | null;
};

/** run item 결과의 필수 항목 하나(required_items[name]). */
export type WorkflowRequiredItem = {
  item_name?: string;
  status?: string;
  required?: boolean;
  confidence?: number | null;
  evidence?: string | null;
  page?: number | null;
  region_id?: string | null;
};

export type WorkflowItemResult = {
  classification?: {
    status?: string;
    class_name?: string | null;
    reason?: string;
    confidence?: number | null;
    evidence?: string[] | null;
  };
  branch_path?: string | null;
  kie_values?: Record<string, WorkflowKieValue | unknown>;
  required_overall_status?: string | null;
  required_items?: Record<string, WorkflowRequiredItem>;
  node_results?: Record<string, unknown>;
  error_message?: string | null;
  current_node_id?: string | null;
  current_node_kind?: string | null;
  current_node_label?: string | null;
  completed_node_ids?: string[];
  path_node_ids?: string[];
};

/**
 * run item. 백엔드가 페이지 단위 처리로 바뀌면 page_number가 생긴다(여러 페이지 문서는 페이지마다 item 하나).
 * 아직 없는 서버도 있으므로 optional로 둔다.
 */
export type WorkflowRunItem = Pick<
  Schemas["WorkflowRunItemRead"],
  "id" | "document_id" | "filename" | "upload_index" | "status" | "upload_duration_ms" | "inference_duration_ms"
> & {
  error_message: string | null;
  page_number?: number | null;
  result: WorkflowItemResult;
};

type RunCounts =
  | "uploaded_count"
  | "preprocessing_count"
  | "ready_count"
  | "queued_count"
  | "running_count"
  | "canceled_count"
  | "vlm_active_count"
  | "vlm_waiting_count"
  | "vlm_limit"
  | "progress_phase"
  | "created_at";

/**
 * run. 생성 타입에서 필수인 집계 필드 일부는 오래된 응답(요약/목록)에서 빠질 수 있어 optional로 완화한다.
 */
export type WorkflowRun = Omit<Schemas["WorkflowRunRead"], "items" | "error_message" | "completed_at" | RunCounts> &
  Partial<Pick<Schemas["WorkflowRunRead"], RunCounts>> & {
    error_message: string | null;
    completed_at?: string | null;
    items: WorkflowRunItem[];
  };

export type WorkflowDocumentPage = Pick<Schemas["DocumentPageRead"], "id" | "page" | "image_url" | "width" | "height"> & {
  rotation_applied?: number;
};

export type WorkflowDocument = Pick<Schemas["DocumentRead"], "document_id" | "filename" | "page_count"> & {
  pages: WorkflowDocumentPage[];
};

export type WorkflowRotationNodeResult = {
  kind: "rotation";
  status?: string;
  job_id?: string | null;
  corrected_page_count?: number;
  pages?: RotationPageResult[];
  error_message?: string | null;
};

/** localStorage에 남기는 캔버스 초안. */
export type WorkflowDraft = {
  activeWorkflowId: string;
  workflowName: string;
  workflowDescription?: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  classifierDraftsByNodeId?: Record<string, WorkflowClassifierDraft>;
  schemaDraftsByNodeId?: Record<string, WorkflowSchemaDraft>;
  checklistDraftsByNodeId?: Record<string, WorkflowChecklistDraft>;
};
