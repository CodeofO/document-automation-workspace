// 노드 에셋(schema·classifier·checklist) 초안 변환. 서버 요약 → 초안 → 저장 payload.
import type {
  ChecklistSummary,
  ClassifierSummary,
  SchemaSummary,
  WorkflowChecklistDraft,
  WorkflowChecklistItem,
  WorkflowClassifierClass,
  WorkflowClassifierDraft,
  WorkflowSchemaDraft,
  WorkflowSchemaField
} from "../types";

export const WORKFLOW_EVIDENCE_TYPES = ["text_or_handwriting", "checkbox", "signature_or_stamp", "visual_mark", "other"] as const;
export const WORKFLOW_CUSTOM_EVIDENCE_TYPE_VALUE = "__custom_evidence_type__";
export const WORKFLOW_EVIDENCE_TYPE_LABELS: Record<string, string> = {
  text_or_handwriting: "문자/손글씨",
  checkbox: "체크박스",
  signature_or_stamp: "서명/도장",
  visual_mark: "시각 표시",
  other: "기타"
};

const DEFAULT_FIELD_DESCRIPTION = "추출할 값을 설명하세요.";
const DEFAULT_CLASS_DESCRIPTION = "분류 기준을 설명하세요.";
const DEFAULT_ITEM_DESCRIPTION = "확인할 항목을 설명하세요.";

function draftNameSuffix(nodeId: string) {
  return (
    nodeId
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || Date.now().toString(36)
  );
}

// --- schema ---

export function normalizeSchemaField(field: WorkflowSchemaField): WorkflowSchemaField {
  return {
    key_name: field.key_name || "field",
    description: field.description || DEFAULT_FIELD_DESCRIPTION,
    output_format: field.output_format || "string",
    region_id: field.region_id ?? null,
    judgement_enabled: Boolean(field.judgement_enabled)
  };
}

export function normalizeSchemaDraft(schema: WorkflowSchemaDraft): WorkflowSchemaDraft {
  return {
    name: schema.name || "AI 추천 schema",
    display_name: schema.display_name ?? schema.name,
    description: schema.description ?? null,
    is_template: Boolean(schema.is_template),
    template_category: schema.template_category ?? null,
    pinned: Boolean(schema.pinned),
    regions: schema.regions ?? [],
    fields: schema.fields.length
      ? schema.fields.map(normalizeSchemaField)
      : [{ key_name: "field_1", description: DEFAULT_FIELD_DESCRIPTION, output_format: "string" }]
  };
}

export function schemaSummaryToDraft(schema: SchemaSummary | undefined): WorkflowSchemaDraft | null {
  if (!schema) return null;
  return normalizeSchemaDraft({
    name: schema.name,
    display_name: schema.display_name,
    description: schema.description ?? null,
    regions: schema.regions ?? [],
    fields: schema.fields
  });
}

export function emptyWorkflowSchemaDraft(nodeId: string): WorkflowSchemaDraft {
  return {
    name: `workflow_schema_${draftNameSuffix(nodeId)}`.slice(0, 120),
    display_name: "Workflow schema",
    description: "Workflow Builder에서 만든 schema 초안입니다.",
    is_template: false,
    template_category: null,
    pinned: false,
    regions: [],
    fields: [{ key_name: "field_1", description: DEFAULT_FIELD_DESCRIPTION, output_format: "string" }]
  };
}

export function schemaDraftPayload(draft: WorkflowSchemaDraft) {
  const normalized = normalizeSchemaDraft(draft);
  return {
    name: normalized.name.trim() || "AI 추천 schema",
    display_name: normalized.display_name?.trim() || normalized.name.trim() || "AI 추천 schema",
    description: normalized.description ?? null,
    is_template: Boolean(normalized.is_template),
    template_category: normalized.template_category ?? null,
    pinned: Boolean(normalized.pinned),
    regions: normalized.regions ?? [],
    fields: normalized.fields.map((field) => ({
      key_name: field.key_name.trim() || "field",
      description: field.description.trim() || DEFAULT_FIELD_DESCRIPTION,
      output_format: field.output_format,
      region_id: field.region_id || null,
      judgement_enabled: Boolean(field.judgement_enabled)
    }))
  };
}

export function updateSchemaDraftField(
  draft: WorkflowSchemaDraft,
  index: number,
  patch: Partial<WorkflowSchemaField>
): WorkflowSchemaDraft {
  return { ...draft, fields: draft.fields.map((field, fieldIndex) => (fieldIndex === index ? { ...field, ...patch } : field)) };
}

// --- classifier ---

export function normalizeClassifierClass(candidate: WorkflowClassifierClass): WorkflowClassifierClass {
  return {
    class_name: candidate.class_name || "class",
    description: candidate.description || DEFAULT_CLASS_DESCRIPTION,
    signals: (candidate.signals ?? []).map((signal) => signal.trim()).filter(Boolean)
  };
}

export function normalizeClassifierDraft(draft: WorkflowClassifierDraft): WorkflowClassifierDraft {
  return {
    name: draft.name || "AI 추천 classifier",
    description: draft.description ?? null,
    allow_unknown: draft.allow_unknown ?? true,
    classes: draft.classes.length
      ? draft.classes.map(normalizeClassifierClass)
      : [{ class_name: "class_1", description: DEFAULT_CLASS_DESCRIPTION, signals: [] }]
  };
}

export function classifierSummaryToDraft(classifier: ClassifierSummary | undefined): WorkflowClassifierDraft | null {
  if (!classifier) return null;
  return normalizeClassifierDraft({
    name: classifier.name,
    description: classifier.description ?? null,
    allow_unknown: classifier.allow_unknown ?? true,
    classes: classifier.classes ?? []
  });
}

export function emptyWorkflowClassifierDraft(nodeId: string): WorkflowClassifierDraft {
  return {
    name: `workflow_classifier_${draftNameSuffix(nodeId)}`.slice(0, 120),
    description: "Workflow Builder에서 만든 classifier 초안입니다.",
    allow_unknown: true,
    classes: [{ class_name: "class_1", description: DEFAULT_CLASS_DESCRIPTION, signals: [] }]
  };
}

export function classifierDraftPayload(draft: WorkflowClassifierDraft) {
  const normalized = normalizeClassifierDraft(draft);
  return {
    name: normalized.name.trim() || "AI 추천 classifier",
    description: normalized.description?.trim() || null,
    allow_unknown: Boolean(normalized.allow_unknown),
    classes: normalized.classes.map((candidate) => ({
      class_name: candidate.class_name.trim() || "class",
      description: candidate.description.trim() || DEFAULT_CLASS_DESCRIPTION,
      signals: candidate.signals.map((signal) => signal.trim()).filter(Boolean)
    }))
  };
}

export function updateClassifierDraftClass(
  draft: WorkflowClassifierDraft,
  index: number,
  patch: Partial<WorkflowClassifierClass>
): WorkflowClassifierDraft {
  return {
    ...draft,
    classes: draft.classes.map((candidate, classIndex) => (classIndex === index ? { ...candidate, ...patch } : candidate))
  };
}

export function formatClassifierSignals(signals: string[]) {
  return signals.join(", ");
}

export function parseClassifierSignals(value: string) {
  return value
    .split(/[,\n]+/)
    .map((signal) => signal.trim())
    .filter(Boolean);
}

// --- checklist ---

export function normalizeChecklistItem(item: WorkflowChecklistItem): WorkflowChecklistItem {
  return {
    item_name: item.item_name || "항목",
    description: item.description || DEFAULT_ITEM_DESCRIPTION,
    evidence_type: item.evidence_type || "text_or_handwriting",
    required: item.required ?? true,
    region_id: item.region_id ?? null
  };
}

export function normalizeChecklistDraft(draft: WorkflowChecklistDraft): WorkflowChecklistDraft {
  return {
    name: draft.name || "AI 추천 checklist",
    description: draft.description ?? null,
    regions: draft.regions ?? [],
    items: draft.items.length
      ? draft.items.map(normalizeChecklistItem)
      : [{ item_name: "항목 1", description: DEFAULT_ITEM_DESCRIPTION, evidence_type: "text_or_handwriting", required: true }]
  };
}

export function checklistSummaryToDraft(checklist: ChecklistSummary | undefined): WorkflowChecklistDraft | null {
  if (!checklist) return null;
  return normalizeChecklistDraft({
    name: checklist.name,
    description: checklist.description ?? null,
    regions: checklist.regions ?? [],
    items: checklist.items ?? []
  });
}

export function emptyWorkflowChecklistDraft(nodeId: string): WorkflowChecklistDraft {
  return {
    name: `workflow_checklist_${draftNameSuffix(nodeId)}`.slice(0, 120),
    description: "Workflow Builder에서 만든 checklist 초안입니다.",
    regions: [],
    items: [{ item_name: "항목 1", description: DEFAULT_ITEM_DESCRIPTION, evidence_type: "text_or_handwriting", required: true }]
  };
}

export function checklistDraftPayload(draft: WorkflowChecklistDraft) {
  const normalized = normalizeChecklistDraft(draft);
  return {
    name: normalized.name.trim() || "AI 추천 checklist",
    description: normalized.description?.trim() || null,
    regions: normalized.regions ?? [],
    items: normalized.items.map((item) => ({
      item_name: item.item_name.trim() || "항목",
      description: item.description.trim() || DEFAULT_ITEM_DESCRIPTION,
      evidence_type: item.evidence_type || "text_or_handwriting",
      required: item.required,
      region_id: item.region_id || null
    }))
  };
}

export function updateChecklistDraftItem(
  draft: WorkflowChecklistDraft,
  index: number,
  patch: Partial<WorkflowChecklistItem>
): WorkflowChecklistDraft {
  return { ...draft, items: draft.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) };
}

export function workflowEvidenceTypeIsPreset(value: string) {
  return WORKFLOW_EVIDENCE_TYPES.includes(value as (typeof WORKFLOW_EVIDENCE_TYPES)[number]);
}
