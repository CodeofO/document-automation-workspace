import { describe, expect, it } from "vitest";
import { batchItemLabel, batchRailCounts, initialPageIndex, mergeBatchSummary, nextReviewItem, summaryAhead, upsertById } from "./model";
import type { ModuleBatch, ModuleBatchItem } from "./types";

function item(id: string, status: string, extra: Partial<ModuleBatchItem> = {}): ModuleBatchItem {
  return { id, document_id: `doc_${id}`, job_id: `job_${id}`, filename: `${id}.pdf`, status, created_at: "", ...extra };
}

function batch(extra: Partial<ModuleBatch> = {}): ModuleBatch {
  return {
    id: "b1",
    status: "running",
    total_count: 3,
    completed_count: 1,
    failed_count: 1,
    canceled_count: 0,
    uploaded_count: 3,
    preprocessing_count: 0,
    ready_count: 0,
    queued_count: 1,
    running_count: 0,
    needs_review_count: 0,
    progress_phase: "running",
    progress: 0.5,
    items: [item("a", "completed"), item("b", "failed"), item("c", "queued")],
    created_at: "",
    completed_at: null,
    ...extra
  };
}

describe("mergeBatchSummary", () => {
  it("요약의 카운터를 쓰고 항목이 없으면 상세 항목을 유지한다", () => {
    const merged = mergeBatchSummary(batch(), batch({ status: "completed", progress: 1, items: [] }));
    expect(merged?.status).toBe("completed");
    expect(merged?.progress).toBe(1);
    expect(merged?.items).toHaveLength(3);
  });

  it("한쪽만 있으면 그것을 돌려준다", () => {
    expect(mergeBatchSummary(undefined, undefined)).toBeNull();
    expect(mergeBatchSummary(undefined, batch({ items: [] }))?.items).toEqual([]);
    expect(mergeBatchSummary(batch(), undefined)?.items).toHaveLength(3);
  });
});

describe("batchItemLabel", () => {
  it("page_number가 있으면 페이지를 붙인다", () => {
    expect(batchItemLabel(item("a", "completed", { page_number: 3 }))).toBe("a.pdf · p.3");
    expect(batchItemLabel(item("a", "completed", { page_number: null }))).toBe("a.pdf");
    expect(batchItemLabel(item("a", "completed"))).toBe("a.pdf");
  });
});

describe("nextReviewItem", () => {
  const items = [item("a", "needs_review"), item("b", "completed"), item("c", "needs_review")];
  it("현재 다음 검토 항목으로, 끝이면 처음으로 돈다", () => {
    expect(nextReviewItem(items, null)?.id).toBe("a");
    expect(nextReviewItem(items, "a")?.id).toBe("c");
    expect(nextReviewItem(items, "c")?.id).toBe("a");
  });
  it("검토 항목이 없으면 null", () => {
    expect(nextReviewItem([item("b", "completed")], null)).toBeNull();
  });
});

describe("batchRailCounts / upsertById / initialPageIndex", () => {
  it("완료+실패+취소를 끝난 수로 센다", () => {
    expect(batchRailCounts(batch())).toMatchObject({ finished: 2, uploaded: 3, queued: 1 });
  });
  it("같은 id를 바꾸고 맨 앞으로 올린다", () => {
    expect(upsertById([{ id: "1", v: 1 }, { id: "2", v: 2 }], { id: "2", v: 3 })).toEqual([
      { id: "2", v: 3 },
      { id: "1", v: 1 }
    ]);
  });
  it("페이지 번호를 0부터의 인덱스로", () => {
    expect(initialPageIndex(3)).toBe(2);
    expect(initialPageIndex(null)).toBe(0);
    expect(initialPageIndex(undefined)).toBe(0);
  });
});

describe("summaryAhead", () => {
  it("요약 카운터가 상세와 다르면 true", () => {
    expect(summaryAhead(batch(), batch({ completed_count: 2, items: [] }))).toBe(true);
    expect(summaryAhead(batch(), batch({ items: [] }))).toBe(false);
    expect(summaryAhead(undefined, batch())).toBe(false);
  });
});
