import { describe, expect, it } from "vitest";
import { defaultEdges, defaultNodes } from "./graph";
import { buildNodeViews, nodeAssetChip, nodeAssetInfo } from "./nodeAssets";
import { sameSelection, selectionFromFlow } from "./selection";

const noDrafts = { classifierDraftsByNodeId: {}, schemaDraftsByNodeId: {}, checklistDraftsByNodeId: {} };

describe("selectionFromFlow", () => {
  it("노드가 엣지보다 우선하고, 없으면 선택 없음", () => {
    expect(selectionFromFlow([{ id: "a" }, { id: "b" }], [{ id: "e" }])).toEqual({ type: "nodes", ids: ["a", "b"] });
    expect(selectionFromFlow([], [{ id: "e" }])).toEqual({ type: "edge", id: "e" });
    expect(selectionFromFlow([], [])).toEqual({ type: "none" });
  });

  it("순서와 무관하게 같은 선택을 알아본다", () => {
    expect(sameSelection({ type: "nodes", ids: ["a", "b"] }, { type: "nodes", ids: ["b", "a"] })).toBe(true);
    expect(sameSelection({ type: "nodes", ids: ["a"] }, { type: "edge", id: "a" })).toBe(false);
    expect(sameSelection({ type: "none" }, { type: "none" })).toBe(true);
  });
});

describe("nodeAssets", () => {
  const schema = {
    id: "s1",
    name: "contract",
    display_name: "계약서",
    fields: Array.from({ length: 12 }, (_, index) => ({ key_name: `f${index}`, description: "", output_format: "string" as const }))
  };
  const assets = { workflows: [], schemas: [schema], classifiers: [], checklists: [] };
  const kie = { ...defaultNodes[3], data: { ...defaultNodes[3].data, config: { schema_id: "s1" } } };

  it("칩은 에셋 이름과 개수를 보여준다", () => {
    const info = nodeAssetInfo(kie, assets, noDrafts);
    expect(info && nodeAssetChip(info)).toBe("스키마: 계약서 · 12필드");
    const missing = nodeAssetInfo(defaultNodes[3], assets, noDrafts);
    expect(missing && nodeAssetChip(missing)).toBe("스키마: 미선택");
    expect(nodeAssetInfo(defaultNodes[0], assets, noDrafts)).toBeNull();
  });

  it("초안이 있으면 초안 기준으로 보이고 배지를 단다", () => {
    const drafts = { ...noDrafts, schemaDraftsByNodeId: { [kie.id]: { name: "draft", fields: [schema.fields[0]] } } };
    const info = nodeAssetInfo(kie, assets, drafts);
    expect(info?.hasDraft).toBe(true);
    expect(info && nodeAssetChip(info)).toBe("스키마: draft · 1필드");
    const views = buildNodeViews([kie], assets, drafts, [{ level: "error", message: "x", nodeId: kie.id }]);
    expect(views[kie.id]).toMatchObject({ hasDraft: true, errorCount: 1, warningCount: 0 });
  });

  it("기본 그래프의 노드마다 view를 만든다", () => {
    const views = buildNodeViews(defaultNodes, assets, noDrafts, []);
    expect(Object.keys(views)).toHaveLength(defaultNodes.length);
    expect(defaultEdges.length).toBeGreaterThan(0);
  });
});
