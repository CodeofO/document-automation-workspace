import { describe, expect, it } from "vitest";
import type { WorkflowDefinition } from "../types";
import { defaultEdges, defaultNodes } from "./graph";
import { isStarterWorkflowDraft, starterWorkflowToAutoLoad } from "./starter";

const draft = { activeWorkflowId: "", workflowName: "x", nodes: defaultNodes, edges: defaultEdges };
const base = { activeWorkflowId: "", initialWorkflowId: "", initialDraft: null };

function workflow(id: string): WorkflowDefinition {
  return { id, name: id, description: null, definition: { nodes: defaultNodes, edges: defaultEdges }, validation_warnings: [] };
}

describe("빌더 진입 시 자동 불러오기", () => {
  it("손대지 않은 기본 캔버스만 starter로 본다", () => {
    expect(isStarterWorkflowDraft(null)).toBe(true);
    expect(isStarterWorkflowDraft(draft)).toBe(true);
    expect(isStarterWorkflowDraft({ ...draft, activeWorkflowId: "w" })).toBe(false);
    expect(isStarterWorkflowDraft({ ...draft, nodes: defaultNodes.slice(1) })).toBe(false);
    expect(isStarterWorkflowDraft({ ...draft, schemaDraftsByNodeId: { kie: { name: "s", fields: [] } } })).toBe(false);
  });

  it("저장된 워크플로우가 없으면 아무것도 불러오지 않는다(빈 새 워크플로우)", () => {
    expect(starterWorkflowToAutoLoad({ ...base, workflows: [] })).toBeNull();
  });

  it("활성 워크플로우가 있으면 그것을, 없으면 첫 워크플로우를 불러온다", () => {
    const workflows = [workflow("a"), workflow("b")];
    expect(starterWorkflowToAutoLoad({ ...base, workflows })?.id).toBe("a");
    expect(starterWorkflowToAutoLoad({ ...base, activeWorkflowId: "b", workflows })?.id).toBe("b");
    expect(starterWorkflowToAutoLoad({ ...base, activeWorkflowId: "gone", workflows })?.id).toBe("a");
  });

  it("경로로 받았거나 사용자가 손댄 캔버스면 불러오지 않는다", () => {
    const workflows = [workflow("a")];
    expect(starterWorkflowToAutoLoad({ ...base, initialWorkflowId: "a", workflows })).toBeNull();
    expect(starterWorkflowToAutoLoad({ ...base, initialDraft: { ...draft, nodes: defaultNodes.slice(1) }, workflows })).toBeNull();
  });
});
