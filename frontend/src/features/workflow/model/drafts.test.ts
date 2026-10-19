import { describe, expect, it } from "vitest";
import {
  classifierDraftPayload,
  emptyWorkflowSchemaDraft,
  normalizeChecklistDraft,
  parseClassifierSignals,
  schemaDraftPayload,
  workflowEvidenceTypeIsPreset
} from "./drafts";
import { parseWorkflowDraft } from "./draftStorage";
import { workflowItemLabel, workflowClassFilterOptions, workflowResultFilterCounts } from "./resultFilters";
import { makeItem } from "./testFixtures";

describe("에셋 초안", () => {
  it("schema payload는 빈 값을 기본값으로 채운다", () => {
    const payload = schemaDraftPayload({ name: " ", fields: [{ key_name: " ", description: "", output_format: "string" }] });
    expect(payload.name).toBe("AI 추천 schema");
    expect(payload.fields[0]).toMatchObject({ key_name: "field", description: "추출할 값을 설명하세요.", region_id: null });
  });

  it("빈 초안 이름은 노드 id에서 만든다", () => {
    expect(emptyWorkflowSchemaDraft("kie-1").name).toBe("workflow_schema_kie_1");
  });

  it("classifier signals를 정리한다", () => {
    expect(parseClassifierSignals("a, b\n c,,")).toEqual(["a", "b", "c"]);
    const payload = classifierDraftPayload({ name: "c", allow_unknown: true, classes: [{ class_name: "x", description: "d", signals: [" s "] }] });
    expect(payload.classes[0].signals).toEqual(["s"]);
  });

  it("checklist 초안은 최소 한 항목", () => {
    expect(normalizeChecklistDraft({ name: "", items: [] }).items).toHaveLength(1);
    expect(workflowEvidenceTypeIsPreset("checkbox")).toBe(true);
    expect(workflowEvidenceTypeIsPreset("도장")).toBe(false);
  });
});

describe("로컬 초안", () => {
  it("모양이 맞지 않으면 버린다", () => {
    expect(parseWorkflowDraft(null)).toBeNull();
    expect(parseWorkflowDraft({ nodes: [] })).toBeNull();
  });

  it("빠진 값은 기본값으로", () => {
    const draft = parseWorkflowDraft({ nodes: [], edges: [], workflowName: " " });
    expect(draft).toMatchObject({ activeWorkflowId: "", workflowName: "문서 자동화 워크플로우", workflowDescription: "" });
  });

  it("선택 상태는 복원하지 않는다", () => {
    const draft = parseWorkflowDraft({
      nodes: [{ id: "a", type: "workflow", position: { x: 0, y: 0 }, selected: true, data: { kind: "input", label: "a" } }],
      edges: [],
      selectedNodeId: "a"
    } as never);
    expect(draft?.nodes[0].selected).toBe(false);
    expect(draft && "selectedNodeId" in draft).toBe(false);
  });
});

describe("결과 필터·라벨", () => {
  it("page_number가 있으면 페이지를 붙인다", () => {
    expect(workflowItemLabel(makeItem({ filename: "a.pdf" }))).toBe("a.pdf");
    expect(workflowItemLabel(makeItem({ filename: "a.pdf", page_number: 3 }))).toBe("a.pdf · p.3");
    expect(workflowItemLabel(makeItem({ filename: "a.pdf", page_number: null }))).toBe("a.pdf");
  });

  it("상태·분류별로 센다", () => {
    const items = [
      makeItem({ id: "1", status: "completed", result: { classification: { class_name: "계약서" } } }),
      makeItem({ id: "2", status: "needs_review", result: { classification: { class_name: "계약서" } } }),
      makeItem({ id: "3", status: "queued" })
    ];
    expect(workflowResultFilterCounts(items)).toEqual({ all: 3, success: 1, failed: 0, waiting: 1, running: 0, review: 1 });
    expect(workflowClassFilterOptions(items).map((option) => [option.value, option.count])).toEqual([
      ["all", 3],
      ["계약서", 2],
      ["미분류", 1]
    ]);
  });
});
