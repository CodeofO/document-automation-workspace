// 셸의 순수 규칙(테스트 대상). React·fetch에 의존하지 않는다.
import { documentLabel } from "../../lib/format";
import type { ModuleBatch, ModuleBatchItem } from "./types";

/**
 * 상세(항목 포함)와 요약(카운터만, 더 자주 갱신)을 합친다.
 * 요약에 항목이 있으면 그것을, 없으면 상세의 항목을 쓴다.
 */
export function mergeBatchSummary(detail: ModuleBatch | undefined, summary: ModuleBatch | undefined): ModuleBatch | null {
  if (!detail) return summary ?? null;
  if (!summary) return detail;
  return { ...detail, ...summary, items: summary.items.length ? summary.items : detail.items };
}

function progressSignature(batch: ModuleBatch) {
  return [
    batch.status,
    batch.completed_count,
    batch.failed_count,
    batch.canceled_count,
    batch.needs_review_count,
    batch.running_count,
    batch.preprocessing_count,
    batch.queued_count
  ].join("|");
}

/** 요약이 상세와 다른 진행 상태를 가리키면 true(상세 항목을 다시 읽어야 한다). */
export function summaryAhead(detail: ModuleBatch | undefined, summary: ModuleBatch | undefined): boolean {
  if (!detail || !summary) return false;
  return progressSignature(detail) !== progressSignature(summary);
}

/** id가 같은 항목을 바꾸고 맨 앞으로 올린다. */
export function upsertById<T extends { id: string }>(items: T[], next: T): T[] {
  return [next, ...items.filter((item) => item.id !== next.id)];
}

/** 레일·결과 목록 라벨: "파일명" 또는 페이지 단위면 "파일명 · p.3". */
export function batchItemLabel(item: Pick<ModuleBatchItem, "filename" | "page_number">): string {
  return documentLabel(item.filename, item.page_number);
}

/** 현재 항목 다음의 "검토 필요" 항목(끝이면 처음으로). 없으면 null. */
export function nextReviewItem(items: ModuleBatchItem[], currentItemId: string | null): ModuleBatchItem | null {
  const reviewItems = items.filter((item) => item.status === "needs_review");
  if (!reviewItems.length) return null;
  const currentIndex = reviewItems.findIndex((item) => item.id === currentItemId);
  return reviewItems[(currentIndex + 1) % reviewItems.length];
}

export type BatchRailCounts = {
  finished: number;
  uploaded: number;
  preprocessing: number;
  running: number;
  queued: number;
  needsReview: number;
};

function countStatus(items: ModuleBatchItem[], status: string) {
  return items.filter((item) => item.status === status).length;
}

/** 서버 카운터를 우선 쓰고, 없으면 항목에서 센다. */
export function batchRailCounts(batch: ModuleBatch): BatchRailCounts {
  const items = batch.items;
  return {
    finished: batch.completed_count + batch.failed_count + batch.canceled_count,
    uploaded: batch.uploaded_count ?? items.length,
    preprocessing: batch.preprocessing_count ?? countStatus(items, "preprocessing"),
    running: batch.running_count ?? countStatus(items, "running"),
    queued: batch.queued_count ?? countStatus(items, "queued"),
    needsReview: batch.needs_review_count ?? countStatus(items, "needs_review")
  };
}

/** 페이지 단위 job·항목이면 그 페이지를 먼저 보여준다(0부터). */
export function initialPageIndex(pageNumber: number | null | undefined): number {
  return typeof pageNumber === "number" && pageNumber > 0 ? pageNumber - 1 : 0;
}
