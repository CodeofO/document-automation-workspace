// 에셋 노드(classifier·kie·required-checker)가 가리키는 에셋을 한 모양으로 읽는다.
// 노드 칩, Inspector 요약, Drawer 제목이 같은 규칙을 쓰도록 여기 모은다. React에 의존하지 않는다.
import type {
  WorkflowAssets,
  WorkflowChecklistDraft,
  WorkflowClassifierDraft,
  WorkflowIssue,
  WorkflowNode,
  WorkflowNodeView,
  WorkflowSchemaDraft
} from "../types";

export type WorkflowDraftMaps = {
  classifierDraftsByNodeId: Record<string, WorkflowClassifierDraft>;
  schemaDraftsByNodeId: Record<string, WorkflowSchemaDraft>;
  checklistDraftsByNodeId: Record<string, WorkflowChecklistDraft>;
};

export type AssetNodeKind = "classifier" | "kie" | "required-checker";

export type NodeAssetMeta = {
  configKey: "classifier_id" | "schema_id" | "checklist_id";
  /** 칩·Inspector에 쓰는 에셋 이름. */
  label: string;
  /** 개수 단위. */
  unit: string;
  placeholder: string;
};

export const NODE_ASSET_META: Record<AssetNodeKind, NodeAssetMeta> = {
  classifier: { configKey: "classifier_id", label: "분류기", unit: "클래스", placeholder: "분류기 선택" },
  kie: { configKey: "schema_id", label: "스키마", unit: "필드", placeholder: "스키마 선택" },
  "required-checker": { configKey: "checklist_id", label: "체크리스트", unit: "항목", placeholder: "체크리스트 선택" }
};

export function isAssetNodeKind(kind: string): kind is AssetNodeKind {
  return kind in NODE_ASSET_META;
}

export type NodeAssetInfo = NodeAssetMeta & {
  kind: AssetNodeKind;
  selectedId: string;
  /** 저장된 에셋을 찾았는가. */
  hasSaved: boolean;
  /** 저장되지 않은 초안이 있는가(있으면 아래 이름·항목은 초안 기준). */
  hasDraft: boolean;
  name: string;
  items: string[];
  options: { value: string; label: string }[];
};

/** 노드가 가리키는 에셋(초안 우선). 에셋 노드가 아니면 null. */
export function nodeAssetInfo(node: WorkflowNode, assets: WorkflowAssets, drafts: WorkflowDraftMaps): NodeAssetInfo | null {
  const kind = node.data.kind;
  if (!isAssetNodeKind(kind)) return null;
  const meta = NODE_ASSET_META[kind];
  const selectedId = node.data.config?.[meta.configKey] ?? "";
  if (kind === "classifier") {
    const saved = assets.classifiers.find((item) => item.id === selectedId);
    const draft = drafts.classifierDraftsByNodeId[node.id];
    const source = draft ?? saved;
    return {
      ...meta,
      kind,
      selectedId,
      hasSaved: Boolean(saved),
      hasDraft: Boolean(draft),
      name: source?.name ?? "",
      items: (source?.classes ?? []).map((item) => item.class_name),
      options: assets.classifiers.map((item) => ({ value: item.id, label: `${item.name} · ${item.classes.length}개 클래스` }))
    };
  }
  if (kind === "kie") {
    const saved = assets.schemas.find((item) => item.id === selectedId);
    const draft = drafts.schemaDraftsByNodeId[node.id];
    const name = draft ? draft.display_name || draft.name : saved ? saved.display_name || saved.name : "";
    return {
      ...meta,
      kind,
      selectedId,
      hasSaved: Boolean(saved),
      hasDraft: Boolean(draft),
      name,
      items: ((draft ?? saved)?.fields ?? []).map((field) => field.key_name),
      options: assets.schemas.map((item) => ({
        value: item.id,
        label: `${item.display_name || item.name} · ${item.fields.length}개 필드`
      }))
    };
  }
  const saved = assets.checklists.find((item) => item.id === selectedId);
  const draft = drafts.checklistDraftsByNodeId[node.id];
  const source = draft ?? saved;
  return {
    ...meta,
    kind,
    selectedId,
    hasSaved: Boolean(saved),
    hasDraft: Boolean(draft),
    name: source?.name ?? "",
    items: (source?.items ?? []).map((item) => item.item_name),
    options: assets.checklists.map((item) => ({ value: item.id, label: `${item.name} · ${item.items.length}개 항목` }))
  };
}

/** 표 추출 노드 config.table_keys: 쉼표로 이은 표 key 목록(비면 전체 표). */
export function parseTableKeys(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);
}

export type TableNodeInfo = {
  templateId: string;
  template: NonNullable<WorkflowAssets["tableTemplates"]>[number] | null;
  /** 실행할 표 key(비면 전체) */
  tableKeys: string[];
};

/** 표 추출 노드가 가리키는 양식. table 노드가 아니면 null. */
export function tableNodeInfo(node: WorkflowNode, assets: WorkflowAssets): TableNodeInfo | null {
  if (node.data.kind !== "table") return null;
  const templateId = node.data.config?.template_id ?? "";
  const template = (assets.tableTemplates ?? []).find((item) => item.id === templateId) ?? null;
  return { templateId, template, tableKeys: parseTableKeys(node.data.config?.table_keys) };
}

/** 표 추출 노드 칩: "양식: 용해일지 · 표 3개"(일부 표만 실행하면 "표 2/3개"). */
export function tableNodeChip(info: TableNodeInfo) {
  if (!info.templateId) return "양식: 미선택";
  if (!info.template) return "양식: 찾을 수 없음";
  const total = info.template.tables.length;
  const used = info.tableKeys.length ? info.tableKeys.filter((key) => info.template?.tables.some((table) => table.key === key)).length : total;
  const name = info.template.display_name || info.template.name;
  return `양식: ${name} · 표 ${used === total ? total : `${used}/${total}`}개`;
}

/** 노드 카드의 읽기 전용 칩 문구. 예: "스키마: 계약서 · 12필드" */
export function nodeAssetChip(info: NodeAssetInfo) {
  if (!info.hasDraft && !info.hasSaved) return `${info.label}: 미선택`;
  return `${info.label}: ${info.name || "이름 없음"} · ${info.items.length.toLocaleString()}${info.unit}`;
}

/** 캔버스 노드별 렌더 파생값(칩·배지). */
export function buildNodeViews(
  nodes: WorkflowNode[],
  assets: WorkflowAssets,
  drafts: WorkflowDraftMaps,
  issues: WorkflowIssue[]
): Record<string, Omit<WorkflowNodeView, "connectedBranchKeys">> {
  const views: Record<string, Omit<WorkflowNodeView, "connectedBranchKeys">> = {};
  for (const node of nodes) {
    const info = nodeAssetInfo(node, assets, drafts);
    const table = tableNodeInfo(node, assets);
    const nodeIssues = issues.filter((issue) => issue.nodeId === node.id);
    views[node.id] = {
      chip: info ? nodeAssetChip(info) : table ? tableNodeChip(table) : undefined,
      chipMissing: info ? !info.hasDraft && !info.hasSaved : table ? !table.template : undefined,
      errorCount: nodeIssues.filter((issue) => issue.level === "error").length,
      warningCount: nodeIssues.filter((issue) => issue.level === "warning").length,
      hasDraft: Boolean(info?.hasDraft)
    };
  }
  return views;
}

/** 저장되지 않은 초안을 가진 노드 id. */
export function draftNodeIds(drafts: WorkflowDraftMaps) {
  return new Set([
    ...Object.keys(drafts.classifierDraftsByNodeId),
    ...Object.keys(drafts.schemaDraftsByNodeId),
    ...Object.keys(drafts.checklistDraftsByNodeId)
  ]);
}
