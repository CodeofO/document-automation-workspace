import { describe, expect, it } from "vitest";
import { checklistFromRecommendation, defaultChecklist, overallStatusOf, toChecklistPayload, withItemStatus } from "./model";
import type { RequiredFieldOutput } from "./types";

describe("required-check model", () => {
  it("전체 상태: 확인 필요 > 누락 > 완료 (필수 항목만)", () => {
    expect(overallStatusOf([{ required: true, status: "uncertain" }, { required: true, status: "missing" }])).toBe("needs_review");
    expect(overallStatusOf([{ required: true, status: "missing" }])).toBe("incomplete");
    expect(overallStatusOf([{ required: false, status: "missing" }])).toBe("complete");
  });

  it("항목 상태를 바꾸면 전체 상태를 다시 계산한다", () => {
    const output: RequiredFieldOutput = {
      document_id: "d",
      checklist_id: "c",
      overall_status: "complete",
      items: [{ item_name: "서명", status: "present", required: true, evidence_type: "signature_or_stamp", confidence: 1, evidence: null, page: 1 }]
    };
    expect(withItemStatus(output, 0, "missing").overall_status).toBe("incomplete");
  });

  it("영역 좌표를 0~1로 자르고 증거 유형이 비면 오류", () => {
    const draft = defaultChecklist();
    draft.regions = [{ id: "r", name: "r", page: 1, x: -1, y: 2, width: 0.5, height: Number.NaN }];
    expect(toChecklistPayload(draft).regions?.[0]).toMatchObject({ x: 0, y: 1, width: 0.5, height: 0 });
    draft.items[0] = { ...draft.items[0], evidence_type: " " };
    expect(() => toChecklistPayload(draft)).toThrow("증거 유형");
  });

  it("AI 추천을 저장 전 초안으로 바꾼다", () => {
    const draft = checklistFromRecommendation({ name: "", items: [] });
    expect(draft.id).toBe("");
    expect(draft.name).toBe("ai_recommended_checklist");
    expect(draft.items).toHaveLength(2);
    expect(draft.regions).toEqual([]);
  });
});
