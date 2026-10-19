import { describe, expect, it } from "vitest";
import type { WorkflowNode } from "../types";
import {
  defaultEdges,
  defaultNodes,
  normalizeBranchKeys,
  normalizeWorkflowEdges,
  normalizeWorkflowNode,
  serializeDefinition,
  syncBranchKeysFromClassNames,
  UNKNOWN_BRANCH_KEY,
  validateConnection,
  duplicateWorkflowNode,
  validateWorkflow,
  workflowEdge,
  workflowIssues,
  workflowNode
} from "./graph";

function withConfig(nodes: WorkflowNode[], config: Record<string, Record<string, string>>) {
  return nodes.map((node) => (config[node.id] ? { ...node, data: { ...node.data, config: config[node.id] } } : node));
}

describe("validateWorkflow", () => {
  it("기본 그래프는 에셋 선택 오류만 낸다", () => {
    const { errors } = validateWorkflow(defaultNodes, defaultEdges);
    expect(errors).toEqual([
      "문서 분류 노드에 classifier를 선택하세요.",
      "KIE 노드에 schema를 선택하세요.",
      "필수 항목 확인 노드에 checklist를 선택하세요."
    ]);
  });

  it("에셋이나 초안이 있으면 통과한다", () => {
    const nodes = withConfig(defaultNodes, { classifier: { classifier_id: "c" }, kie_contract: { schema_id: "s" } });
    const { errors } = validateWorkflow(nodes, defaultEdges, {}, {}, {
      required_contract: { name: "x", items: [] }
    });
    expect(errors).toEqual([]);
  });

  it("Input·Export가 없으면 오류, 끊긴 노드는 경고", () => {
    const orphan = workflowNode("merge", "고립", 0, 0, {}, undefined, "orphan");
    const result = validateWorkflow([orphan], []);
    expect(result.errors).toContain("Input 노드는 정확히 1개여야 합니다.");
    expect(result.errors).toContain("Export 노드가 필요합니다.");
    const connected = validateWorkflow([...defaultNodes, orphan], defaultEdges);
    expect(connected.warnings).toContain("고립 노드는 현재 실행 경로에 연결되어 있지 않습니다.");
  });
});

describe("workflowIssues", () => {
  it("노드에 묶을 수 있는 문제는 nodeId를 단다", () => {
    const issues = workflowIssues(defaultNodes, defaultEdges);
    expect(issues.find((issue) => issue.message.startsWith("KIE"))).toMatchObject({ level: "error", nodeId: "kie_contract" });
    const missingExport = workflowIssues(defaultNodes.filter((node) => node.data.kind !== "export"), []);
    expect(missingExport.find((issue) => issue.message === "Export 노드가 필요합니다.")?.nodeId).toBeUndefined();
  });
});

describe("duplicateWorkflowNode", () => {
  it("새 id·옆 위치·같은 config로 복제하고 선택한다", () => {
    const source = { ...defaultNodes[3], data: { ...defaultNodes[3].data, config: { schema_id: "s" } } };
    const copy = duplicateWorkflowNode(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy.position).toEqual({ x: source.position.x + 48, y: source.position.y + 48 });
    expect(copy.data.config).toEqual({ schema_id: "s" });
    expect(copy.data.label).toBe("핵심 정보 추출 복사");
    expect(copy.selected).toBe(true);
  });
});

describe("validateConnection", () => {
  it("규칙 위반을 설명한다", () => {
    expect(validateConnection({ source: "input", target: "input", sourceHandle: null, targetHandle: null }, defaultNodes, [])).toBe(
      "같은 노드끼리는 연결할 수 없습니다."
    );
    expect(validateConnection({ source: "export", target: "merge", sourceHandle: null, targetHandle: null }, defaultNodes, [])).toBe(
      "Export 뒤에는 노드를 연결할 수 없습니다."
    );
    expect(validateConnection({ source: "input", target: "branch", sourceHandle: null, targetHandle: null }, defaultNodes, [])).toBe(
      "Branch 앞에는 Document Classifier만 연결하세요."
    );
    expect(
      validateConnection({ source: "input", target: "merge", sourceHandle: null, targetHandle: null }, defaultNodes, defaultEdges)
    ).toBe("이 노드의 기존 outgoing 연결을 먼저 삭제하세요.");
    expect(validateConnection({ source: "input", target: "classifier", sourceHandle: null, targetHandle: null }, defaultNodes, [])).toBeNull();
  });
});

describe("정규화", () => {
  it("branch key는 unknown을 포함하고 예전 키를 버린다", () => {
    expect(normalizeBranchKeys(undefined)).toEqual([UNKNOWN_BRANCH_KEY]);
    expect(normalizeBranchKeys(["class:a", "default", "needs_review"])).toEqual(["class:a", UNKNOWN_BRANCH_KEY]);
  });

  it("예전 handle 이름을 unknown으로 바꾸고 같은 route 중복을 없앤다", () => {
    const edges = normalizeWorkflowEdges([
      workflowEdge("branch", "a", "default"),
      workflowEdge("branch", "b", UNKNOWN_BRANCH_KEY)
    ]);
    expect(edges).toHaveLength(1);
    expect(edges[0].sourceHandle).toBe(UNKNOWN_BRANCH_KEY);
  });

  it("캔버스 전용 필드는 저장에서 뺀다", () => {
    const view = { chip: "x", errorCount: 1, warningCount: 0, hasDraft: true };
    const node = { ...defaultNodes[1], selected: true, data: { ...defaultNodes[1].data, view } };
    expect("view" in normalizeWorkflowNode(node).data).toBe(false);
    // 예전 초안에 남아 있던 콜백 필드도 버린다.
    const legacy = { ...node, data: { ...node.data, onSelect: () => {} } as WorkflowNode["data"] };
    expect("onSelect" in normalizeWorkflowNode(legacy).data).toBe(false);
    const definition = serializeDefinition([node], defaultEdges.slice(0, 1));
    expect(definition.nodes[0]).toMatchObject({ id: "classifier", type: "workflow" });
    expect("view" in definition.nodes[0].data).toBe(false);
    expect("selected" in definition.nodes[0]).toBe(false);
    expect(definition.edges[0]).toMatchObject({ source: "input", target: "classifier" });
  });

  it("분류 class 이름으로 branch key를 맞춘다", () => {
    const synced = syncBranchKeysFromClassNames(defaultNodes, [" 계약서 ", ""]);
    expect(synced.find((node) => node.id === "branch")?.data.branchKeys).toEqual(["class:계약서", UNKNOWN_BRANCH_KEY]);
  });
});

describe("표 추출 노드", () => {
  it("table_keys는 캔버스에서 쉼표 문자열, 서버로는 목록(비면 생략)", () => {
    const node = workflowNode("table", "표 추출", 0, 0, { template_id: "table_template_1", table_keys: "a, b" }, undefined, "table_1");
    const [saved] = serializeDefinition([node], []).nodes;
    expect(saved.data.config).toEqual({ template_id: "table_template_1", table_keys: ["a", "b"] });
    const all = workflowNode("table", "표 추출", 0, 0, { template_id: "t", table_keys: "" }, undefined, "table_2");
    expect(serializeDefinition([all], []).nodes[0].data.config).toEqual({ template_id: "t" });
    const loaded = { ...node, data: { ...node.data, config: { template_id: "t", table_keys: ["x", "y"] } } } as unknown as WorkflowNode;
    expect(normalizeWorkflowNode(loaded).data.config).toEqual({ template_id: "t", table_keys: "x,y" });
  });

  it("양식을 고르지 않으면 오류", () => {
    const nodes = [
      workflowNode("input", "문서 입력", 0, 0, {}, undefined, "input"),
      workflowNode("table", "표 추출", 1, 0, {}, undefined, "table_1"),
      workflowNode("export", "Export", 2, 0, {}, undefined, "export")
    ];
    const edges = [workflowEdge("input", "table_1"), workflowEdge("table_1", "export")];
    expect(workflowIssues(nodes, edges)).toContainEqual({ level: "error", message: "표 추출 노드에 표 양식을 선택하세요.", nodeId: "table_1" });
  });
});
