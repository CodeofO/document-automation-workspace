import { describe, expect, it } from "vitest";
import type { TableTemplate } from "../../table-extraction";
import type { WorkflowAssets } from "../types";
import { workflowNode } from "./graph";
import { tableNodeChip, tableNodeInfo } from "./nodeAssets";

const spec = (key: string) =>
  ({ key, name: key, columns: [{ key: "a" }] }) as unknown as TableTemplate["tables"][number];
const template = {
  id: "tt1",
  name: "용해일지",
  display_name: null,
  tables: [spec("lot"), spec("chem"), spec("time")]
} as unknown as TableTemplate;
const assets: WorkflowAssets = {
  workflows: [],
  schemas: [],
  classifiers: [],
  checklists: [],
  tableTemplates: [template]
};

describe("표 추출 노드 칩", () => {
  it("양식 이름 · 표 개수(일부만 실행하면 n/전체)", () => {
    const all = tableNodeInfo(workflowNode("table", "표", 0, 0, { template_id: "tt1" }), assets);
    expect(all && tableNodeChip(all)).toBe("양식: 용해일지 · 표 3개");
    const some = tableNodeInfo(
      workflowNode("table", "표", 0, 0, { template_id: "tt1", table_keys: "lot,chem" }),
      assets
    );
    expect(some && tableNodeChip(some)).toBe("양식: 용해일지 · 표 2/3개");
    const none = tableNodeInfo(workflowNode("table", "표", 0, 0, {}), assets);
    expect(none && tableNodeChip(none)).toBe("양식: 미선택");
    expect(tableNodeInfo(workflowNode("kie", "K", 0, 0, {}), assets)).toBeNull();
  });
});
