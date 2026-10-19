// 회전 보정 화면의 순수 규칙(배지·카운터·필터·라벨). 유닛 테스트 대상.
import { statusLabel, type StatusTone } from "../../lib/status";
import type {
  ManualRotationDegrees,
  ManualRotationState,
  RotationBatch,
  RotationBatchItem,
  RotationItemFilter,
  RotationPageResult
} from "./types";

export const ROTATION_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.pptx";
export const ROTATION_ITEM_PAGE_SIZE = 30;
export const ROTATION_RECENT_LIMIT = 6;

export const ROTATION_ITEM_FILTERS: { value: RotationItemFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "corrected", label: "보정됨" },
  { value: "review", label: "검토 필요" },
  { value: "failed", label: "실패·취소" }
];

export type RotationPageBadge = {
  label: string;
  detail: string;
  /** 카드 테두리용 클래스 이름 */
  tone: "upright" | "corrected" | "review";
  /** StatusBadge tone */
  statusTone: StatusTone;
};

export function rotationPageBadge(page: Pick<RotationPageResult, "status" | "detected_rotation">): RotationPageBadge {
  if (page.status === "corrected") {
    return {
      label: `${page.detected_rotation}° 보정됨`,
      detail: `${page.detected_rotation}° 회전 감지 → 보정됨`,
      tone: "corrected",
      statusTone: "success"
    };
  }
  if (page.status === "low_confidence") {
    return { label: "검토 필요", detail: "확신이 낮아 적용 안 함", tone: "review", statusTone: "warning" };
  }
  if (page.status === "skipped") {
    return { label: "검토 필요", detail: "처리 중 페이지가 변경되어 건너뜀", tone: "review", statusTone: "warning" };
  }
  return { label: "정방향", detail: "정방향 (변경 없음)", tone: "upright", statusTone: "neutral" };
}

export function rotationPageNeedsReview(page: Pick<RotationPageResult, "status">): boolean {
  return page.status === "low_confidence" || page.status === "skipped";
}

/** 항목(문서) 상태 라벨. 공용 어휘와 같되 waiting_for_document만 "문서 준비 대기"로 구체적으로 쓴다. */
export function rotationItemStatusLabel(status: string | null | undefined): string {
  if (!status) return "-";
  if (status === "waiting_for_document") return "문서 준비 대기";
  return statusLabel(status, "job");
}

/** 배치 상태 라벨(결과 카드 제목·최근 실행). 상태가 없으면 "대기 중". */
export function rotationBatchStatusLabel(status: string | null | undefined): string {
  return statusLabel(status || "queued", "job");
}

export type RotationCounterItem = { label: string; value: number; tone?: StatusTone };

/** 결과 카운터. 순서는 공용 규칙(전체 · 완료 · 검토 필요 · 실패 · 모듈별)을 따르고, 값이 0이면 색을 뺀다. */
export function rotationCounterItems(batch: RotationBatch): RotationCounterItem[] {
  const needsReview = batch.needs_review_count ?? batch.items.filter((item) => item.status === "needs_review").length;
  const correctedPages =
    batch.corrected_page_count ?? batch.items.reduce((sum, item) => sum + (item.corrected_page_count ?? 0), 0);
  const tone = (value: number, active: StatusTone): StatusTone | undefined => (value ? active : undefined);
  return [
    { label: "전체", value: batch.total_count },
    { label: "완료", value: batch.completed_count },
    { label: "검토 필요", value: needsReview, tone: tone(needsReview, "warning") },
    { label: "실패", value: batch.failed_count, tone: tone(batch.failed_count, "danger") },
    { label: "보정된 페이지", value: correctedPages, tone: tone(correctedPages, "success") }
  ];
}

/** 끝난 항목 수. 바뀌면 상세(항목 목록)를 다시 읽는다. */
export function rotationDoneCount(
  batch: Pick<RotationBatch, "completed_count" | "failed_count" | "canceled_count" | "needs_review_count">
): number {
  return batch.completed_count + batch.failed_count + batch.canceled_count + (batch.needs_review_count ?? 0);
}

export function filterRotationItems(items: RotationBatchItem[], filter: RotationItemFilter): RotationBatchItem[] {
  const sorted = [...items].sort((a, b) => (a.upload_index ?? 0) - (b.upload_index ?? 0));
  if (filter === "corrected") return sorted.filter((item) => item.corrected_page_count > 0);
  if (filter === "review") {
    return sorted.filter((item) => item.status === "needs_review" || item.pages.some(rotationPageNeedsReview));
  }
  if (filter === "failed") return sorted.filter((item) => item.status === "failed" || item.status === "canceled");
  return sorted;
}

export function rotationPageKey(documentId: string, pageNumber: number): string {
  return `${documentId}:${pageNumber}`;
}

/** 수동 회전 결과를 반영한다. 서버가 적용 각도를 주면 그 값을, 아니면 누적 각도를 쓴다. */
export function applyManualRotation(
  state: ManualRotationState,
  key: string,
  degrees: ManualRotationDegrees,
  serverRotation?: number
): ManualRotationState {
  const previous = state[key];
  return {
    ...state,
    [key]: {
      rotation: serverRotation ?? ((previous?.rotation ?? 0) + degrees) % 360,
      version: (previous?.version ?? 0) + 1
    }
  };
}

/** 썸네일·원본 이미지 URL의 캐시 버스터. 회전할 때마다 바뀐다. */
export function rotationCacheBuster(page: Pick<RotationPageResult, "rotation_after">, manual?: { rotation: number; version: number }) {
  return `${manual?.rotation ?? page.rotation_after ?? 0}-${manual?.version ?? 0}`;
}
