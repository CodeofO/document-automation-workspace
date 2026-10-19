// 검수 화면 라벨·export 링크(순수 함수).
import { apiUrl, documentPageThumbnailUrl } from "../../../api/client";
import type { ExportFormat, ExportMenuOption } from "../../../components/ui";
import { jobExportOptions } from "../../export-jobs";
import type { DocumentPage, ExtractionValue, ReviewFilter } from "../types";

export function reviewFilterLabel(filter: ReviewFilter) {
  const labels: Record<ReviewFilter, string> = {
    needs_review: "검토 필요",
    all: "전체",
    warning: "경고",
    null: "누락값",
    changed: "수정됨",
    low_confidence: "낮은 신뢰도",
    unreviewed: "미검수",
    ai_corrected: "AI 보정됨",
    ai_review_failed: "AI 검수 실패"
  };
  return labels[filter];
}

export function formatFieldWarning(warning: string) {
  if (warning.startsWith("invalid_type:")) {
    return `형식 확인(${warning.slice("invalid_type:".length)})`;
  }
  const labels: Record<string, string> = {
    missing: "누락",
    not_detected: "미검출",
    low_confidence: "낮은 신뢰도",
    invalid_page: "페이지 오류",
    invalid_confidence: "신뢰도 오류",
    invalid_date: "날짜 형식 확인",
    ai_review_failed: "AI 검수 실패",
    ai_correction_failed: "AI 보정 실패",
    ai_correction_discarded_null: "AI 보정 보류",
    ai_correction_low_confidence: "AI 보정 신뢰도 낮음",
    ai_correction_large_change: "AI 보정 변화량 큼"
  };
  return labels[warning] ?? warning;
}

export function aiReviewLabel(value?: ExtractionValue) {
  const review = value?.ai_review;
  if (!review?.enabled) return "검수 안함";
  if (review.judgement_status === "failed") return "검수 실패";
  if (review.corrected) return "AI 보정";
  if (review.judgement_status === "correct") return "정상 판단";
  if (review.judgement_status === "needs_correction") return "보정 필요";
  return "검수 안함";
}

export function aiReviewClassName(value?: ExtractionValue) {
  const review = value?.ai_review;
  if (!review?.enabled) return "muted";
  if (review.judgement_status === "failed") return "warn-text";
  if (review.corrected) return "ai-review-corrected";
  if (review.judgement_status === "correct") return "ai-review-ok";
  return "warn-text";
}

export function aiReviewTitle(value?: ExtractionValue) {
  const review = value?.ai_review;
  if (!review?.enabled) return "AI 검수를 적용하지 않은 필드입니다.";
  return [review.judgement_reason, review.correction_reason].filter(Boolean).join(" / ") || aiReviewLabel(value);
}

export function resultExportOptions(resultId: string, presetId: string): ExportMenuOption[] {
  return (["csv", "json", "xlsx"] as ExportFormat[]).map((format) => ({
    format,
    href: exportHref(resultId, format, presetId),
  }));
}

export function exportHref(resultId: string, format: ExportFormat, presetId: string) {
  const params = new URLSearchParams({ format });
  if (presetId) params.set("preset_id", presetId);
  return apiUrl(`/api/extraction-results/${resultId}/export?${params.toString()}`);
}

export function documentPageImageSrc(page: DocumentPage) {
  return apiUrl(`${page.image_url}?v=${page.width}x${page.height}`);
}

export function batchJobExportOptions(batchId: string): ExportMenuOption[] {
  return jobExportOptions("batch", batchId);
}

export { documentPageThumbnailUrl };

/** 검수 필터 조건. 검토 필요 = 미검수이면서 경고·빈 값·낮은 신뢰도(0.75 미만) 중 하나. */
export function matchesReviewFilter(
  filter: ReviewFilter,
  key: string,
  value: ExtractionValue | undefined,
  editedKeys: string[],
  reviewedFields: string[]
): boolean {
  const empty = value?.value === null || value?.value === undefined || value?.value === "";
  const lowConfidence = (value?.confidence ?? 1) < 0.75;
  const warned = Boolean(value?.warnings?.length);
  if (filter === "needs_review") return !reviewedFields.includes(key) && (warned || empty || lowConfidence);
  if (filter === "warning") return warned;
  if (filter === "null") return empty;
  if (filter === "changed") return editedKeys.includes(key);
  if (filter === "low_confidence") return lowConfidence;
  if (filter === "unreviewed") return !reviewedFields.includes(key);
  if (filter === "ai_corrected") return Boolean(value?.ai_review?.corrected);
  if (filter === "ai_review_failed") {
    return (
      value?.ai_review?.judgement_status === "failed" ||
      Boolean(value?.warnings?.some((warning) => warning === "ai_review_failed" || warning === "ai_correction_failed"))
    );
  }
  return true;
}

/** 칩으로 보여줄 필터 순서(spec B-4: 전체 / 검토 필요 / 수정됨 / 경고 …). */
export const REVIEW_FILTER_CHIPS: ReviewFilter[] = [
  "all",
  "needs_review",
  "changed",
  "warning",
  "null",
  "unreviewed",
  "low_confidence",
  "ai_corrected",
  "ai_review_failed"
];
