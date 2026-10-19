// 체크리스트 초안 기본값·정규화·저장 바디, 결과 전체 상태 재계산. (순수 함수, 테스트 대상)
import type { Schemas } from "../../api/client";
import { clamp01, formatDate } from "../../lib/format";
import type { SchemaRegion } from "../module-batch";
import type {
  ChecklistRecommendation,
  RequiredFieldChecklist,
  RequiredFieldItemStatus,
  RequiredFieldOutput,
  RequiredOverallStatus
} from "./types";

export const EVIDENCE_TYPES = ["text_or_handwriting", "checkbox", "signature_or_stamp", "visual_mark", "other"] as const;
export const CUSTOM_EVIDENCE_TYPE = "__custom_evidence_type__";
export const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  text_or_handwriting: "문자/손글씨",
  checkbox: "체크박스",
  signature_or_stamp: "서명/도장",
  visual_mark: "시각 표시",
  other: "기타"
};

export function isPresetEvidenceType(value: string): boolean {
  return (EVIDENCE_TYPES as readonly string[]).includes(value);
}

export function defaultChecklist(): RequiredFieldChecklist {
  return {
    id: "",
    name: "새 필수 항목 체크리스트",
    description: "문서에서 필수 항목의 존재 여부만 확인합니다.",
    archived: false,
    regions: [],
    items: [
      { item_name: "성명", description: "작성자 또는 대상자의 성명이 문서에 존재하는지 확인합니다.", evidence_type: "text_or_handwriting", required: true },
      { item_name: "서명", description: "서명 또는 날인이 존재하는지 확인합니다.", evidence_type: "signature_or_stamp", required: true }
    ],
    created_at: "",
    updated_at: ""
  };
}

export function normalizeChecklist(config: RequiredFieldChecklist): RequiredFieldChecklist {
  return { ...config, items: config.items.length ? config.items : defaultChecklist().items, regions: config.regions ?? [] };
}

/** AI 추천을 저장 전 초안으로. */
export function checklistFromRecommendation(recommendation: ChecklistRecommendation): RequiredFieldChecklist {
  return normalizeChecklist({
    id: "",
    name: recommendation.name || "ai_recommended_checklist",
    description: recommendation.description ?? null,
    archived: false,
    regions: recommendation.regions ?? [],
    items: recommendation.items,
    created_at: "",
    updated_at: ""
  });
}

export function defaultRegion(index: number): SchemaRegion {
  return { id: `region_${Date.now()}_${index}`, name: `영역 ${index}`, page: 1, x: 0.55, y: 0.55, width: 0.35, height: 0.2 };
}

export function toChecklistPayload(config: RequiredFieldChecklist): Schemas["RequiredFieldChecklistCreate"] {
  const items = config.items
    .map((item) => ({
      item_name: item.item_name.trim(),
      description: item.description.trim(),
      evidence_type: item.evidence_type.trim(),
      required: item.required,
      region_id: item.region_id || null
    }))
    .filter((item) => item.item_name && item.description);
  if (!config.name.trim()) throw new Error("체크리스트 이름을 입력하세요.");
  if (!items.length) throw new Error("체크 항목을 최소 1개 이상 입력하세요.");
  if (items.some((item) => !item.evidence_type)) throw new Error("체크 항목의 증거 유형을 입력하세요.");
  return {
    name: config.name.trim(),
    description: config.description?.trim() || null,
    regions: config.regions.map((region) => ({
      ...region,
      x: clamp01(region.x),
      y: clamp01(region.y),
      width: clamp01(region.width),
      height: clamp01(region.height)
    })),
    items
  };
}

export function summarizeChecklist(config: RequiredFieldChecklist): string {
  return `${config.items.length}개 항목 · ${config.regions.length}개 영역 · ${formatDate(config.updated_at)}`;
}

/** 필수 항목 중 확인 필요가 있으면 검토 필요, 누락이 있으면 누락 있음, 아니면 완료. */
export function overallStatusOf(items: { required: boolean; status: RequiredFieldItemStatus }[]): RequiredOverallStatus {
  if (items.some((item) => item.required && item.status === "uncertain")) return "needs_review";
  if (items.some((item) => item.required && item.status === "missing")) return "incomplete";
  return "complete";
}

export function withItemStatus(output: RequiredFieldOutput, index: number, status: RequiredFieldItemStatus): RequiredFieldOutput {
  const items = output.items.map((item, itemIndex) => (itemIndex === index ? { ...item, status } : item));
  return { ...output, items, overall_status: overallStatusOf(items) };
}
