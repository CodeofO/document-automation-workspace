// 결과 창 오른쪽(문서 결과) 섹션의 행과 요약. 화면 없이 테스트한다.
import { confidenceTone } from "../../table-extraction";
import { isRecord } from "./graph";
import type { WorkflowItemResult, WorkflowKieValue } from "../types";

export type InspectorTone = "warning" | "danger" | undefined;

/** 다른 모듈과 같은 기준(표 추출 칸 색): 0.8 미만 검토(노랑), 0.6 미만 위험(빨강). */
export function inspectorConfidenceTone(confidence: number | null | undefined): InspectorTone {
  return confidenceTone(confidence) ?? undefined;
}

export type InspectorKieRow = {
  key: string;
  value: unknown;
  confidence: number | null;
  evidence: string;
  page: number | null;
  warnings: string[];
};

export type InspectorRequiredRow = {
  key: string;
  status: string;
  required: boolean;
  confidence: number | null;
  evidence: string;
  page: number | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** kie_values는 {value, confidence, evidence, …} 객체이거나(새 서버) 값 그대로(옛 결과)다. */
export function inspectorKieRows(result: WorkflowItemResult): InspectorKieRow[] {
  return Object.entries(result.kie_values ?? {}).map(([key, raw]) => {
    const entry: WorkflowKieValue = isRecord(raw) ? (raw as WorkflowKieValue) : { value: raw };
    return {
      key,
      value: entry.value,
      confidence: numberOrNull(entry.confidence),
      evidence: typeof entry.evidence === "string" ? entry.evidence : "",
      page: numberOrNull(entry.page),
      warnings: Array.isArray(entry.warnings) ? entry.warnings.map(String) : []
    };
  });
}

export function inspectorRequiredRows(result: WorkflowItemResult): InspectorRequiredRow[] {
  return Object.entries(result.required_items ?? {}).map(([key, item]) => ({
    key: item?.item_name || key,
    status: item?.status || "-",
    required: item?.required !== false,
    confidence: numberOrNull(item?.confidence),
    evidence: typeof item?.evidence === "string" ? item.evidence : "",
    page: numberOrNull(item?.page)
  }));
}

export function kieRowTone(row: InspectorKieRow): InspectorTone {
  return inspectorConfidenceTone(row.confidence) ?? (row.warnings.length ? "warning" : undefined);
}

/** 필수 항목 화면(RequiredFieldResultPanel)과 같은 색: 불확실 → 노랑, 필수 누락 → 빨강. */
export function requiredRowTone(row: InspectorRequiredRow): InspectorTone {
  if (row.status === "missing" && row.required) return "danger";
  if (row.status === "uncertain" || row.status === "needs_review") return "warning";
  return inspectorConfidenceTone(row.confidence);
}

/** "12필드 · 검토 3" */
export function kieSectionMeta(rows: InspectorKieRow[]): string {
  const review = rows.filter((row) => kieRowTone(row)).length;
  return [`${rows.length.toLocaleString()}필드`, review ? `검토 ${review.toLocaleString()}` : ""]
    .filter(Boolean)
    .join(" · ");
}

/** "5항목 · 누락 1 · 검토 2" */
export function requiredSectionMeta(rows: InspectorRequiredRow[]): string {
  const missing = rows.filter((row) => row.status === "missing").length;
  const review = rows.filter((row) => row.status !== "missing" && requiredRowTone(row)).length;
  return [
    `${rows.length.toLocaleString()}항목`,
    missing ? `누락 ${missing.toLocaleString()}` : "",
    review ? `검토 ${review.toLocaleString()}` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}
