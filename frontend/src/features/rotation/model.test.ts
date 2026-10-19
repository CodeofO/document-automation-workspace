import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { API_BASE } from "../../api/config";
import { server } from "../../test/server";
import { fetchRotationBatchProgress } from "./api";
import {
  applyManualRotation,
  filterRotationItems,
  rotationBatchStatusLabel,
  rotationCounterItems,
  rotationItemStatusLabel,
  rotationPageBadge
} from "./model";
import type { RotationBatch, RotationBatchItem, RotationPageResult } from "./types";

function page(overrides: Partial<RotationPageResult> = {}): RotationPageResult {
  return {
    page_number: 1,
    status: "upright",
    applied: false,
    correction: 0,
    detected_rotation: 0,
    confidence: 0.9,
    reason: "",
    ...overrides
  };
}

function item(id: string, overrides: Partial<RotationBatchItem> = {}): RotationBatchItem {
  return {
    id,
    document_id: `doc_${id}`,
    job_id: null,
    filename: `${id}.pdf`,
    status: "completed",
    error_message: null,
    corrected_page_count: 0,
    pages: [page()],
    created_at: "2026-10-15T00:00:00",
    ...overrides
  };
}

function batch(overrides: Partial<RotationBatch> = {}): RotationBatch {
  return {
    id: "rb_1",
    status: "running",
    total_count: 3,
    completed_count: 1,
    failed_count: 0,
    canceled_count: 0,
    uploaded_count: 3,
    preprocessing_count: 0,
    ready_count: 3,
    queued_count: 0,
    running_count: 2,
    needs_review_count: 0,
    corrected_page_count: 0,
    progress_phase: "running",
    progress: 0.3,
    items: [],
    created_at: "2026-10-15T00:00:00",
    completed_at: null,
    ...overrides
  };
}

describe("rotationPageBadge", () => {
  it("상태별 라벨·설명·tone", () => {
    expect(rotationPageBadge(page({ status: "corrected", detected_rotation: 90 }))).toMatchObject({
      label: "90° 보정됨",
      tone: "corrected",
      statusTone: "success"
    });
    expect(rotationPageBadge(page({ status: "low_confidence" }))).toMatchObject({ label: "검토 필요", statusTone: "warning" });
    expect(rotationPageBadge(page({ status: "skipped" })).detail).toBe("처리 중 페이지가 변경되어 건너뜀");
    expect(rotationPageBadge(page()).detail).toBe("정방향 (변경 없음)");
  });
});

describe("status labels", () => {
  it("항목·배치 상태 라벨", () => {
    expect(rotationItemStatusLabel("waiting_for_document")).toBe("문서 준비 대기");
    expect(rotationItemStatusLabel("completed")).toBe("완료");
    expect(rotationItemStatusLabel(null)).toBe("-");
    expect(rotationBatchStatusLabel("completed_with_errors")).toBe("일부 실패");
    expect(rotationBatchStatusLabel(undefined)).toBe("대기 중");
  });
});

describe("rotationCounterItems", () => {
  it("공용 순서를 따르고 0이면 tone을 비운다", () => {
    const items = rotationCounterItems(batch({ failed_count: 1, corrected_page_count: 0, needs_review_count: 2 }));
    expect(items.map((entry) => entry.label)).toEqual(["전체", "완료", "검토 필요", "실패", "보정된 페이지"]);
    expect(items[2].tone).toBe("warning");
    expect(items[3].tone).toBe("danger");
    expect(items[4].tone).toBeUndefined();
  });
});

describe("filterRotationItems", () => {
  const items = [
    item("c", { upload_index: 2, corrected_page_count: 1 }),
    item("r", { upload_index: 0, pages: [page({ status: "low_confidence" })] }),
    item("f", { upload_index: 1, status: "canceled" })
  ];

  it("upload_index순으로 정렬하고 필터를 적용한다", () => {
    expect(filterRotationItems(items, "all").map((entry) => entry.id)).toEqual(["r", "f", "c"]);
    expect(filterRotationItems(items, "corrected").map((entry) => entry.id)).toEqual(["c"]);
    expect(filterRotationItems(items, "review").map((entry) => entry.id)).toEqual(["r"]);
    expect(filterRotationItems(items, "failed").map((entry) => entry.id)).toEqual(["f"]);
  });
});

describe("applyManualRotation", () => {
  it("서버 각도가 있으면 그 값, 없으면 누적하고 version을 올린다", () => {
    const first = applyManualRotation({}, "k", 90);
    expect(first.k).toEqual({ rotation: 90, version: 1 });
    expect(applyManualRotation(first, "k", 270).k).toEqual({ rotation: 0, version: 2 });
    expect(applyManualRotation(first, "k", 180, 270).k).toEqual({ rotation: 270, version: 2 });
  });
});

describe("fetchRotationBatchProgress", () => {
  it("끝난 항목 수가 그대로면 요약만 읽고 기존 항목을 유지한다", async () => {
    let detailCalls = 0;
    server.use(
      http.get(`${API_BASE}/api/rotation-batches/rb_1/summary`, () => HttpResponse.json(batch({ progress: 0.5 }))),
      http.get(`${API_BASE}/api/rotation-batches/rb_1`, () => {
        detailCalls += 1;
        return HttpResponse.json(batch());
      })
    );
    const previous = batch({ items: [item("a")] });
    const next = await fetchRotationBatchProgress("rb_1", previous);
    expect(detailCalls).toBe(0);
    expect(next.progress).toBe(0.5);
    expect(next.items).toBe(previous.items);
  });

  it("terminal이 되면 상세를 다시 읽는다(page_number가 없어도 null로 둔다)", async () => {
    server.use(
      http.get(`${API_BASE}/api/rotation-batches/rb_1/summary`, () => HttpResponse.json(batch({ status: "completed" }))),
      http.get(`${API_BASE}/api/rotation-batches/rb_1`, () =>
        HttpResponse.json(batch({ status: "completed", items: [{ ...item("a"), pages: undefined } as never] }))
      )
    );
    const next = await fetchRotationBatchProgress("rb_1", batch());
    expect(next.status).toBe("completed");
    expect(next.items[0].pages).toEqual([]);
    expect(next.items[0].page_number).toBeNull();
  });
});
