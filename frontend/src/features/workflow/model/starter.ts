// 빌더에 처음 들어왔을 때 무엇을 캔버스에 띄울지 정하는 규칙.
// 손대지 않은 기본 캔버스면 마지막으로 쓴(또는 첫) 저장 워크플로우를 불러오고, 없으면 빈 새 워크플로우 그대로 둔다.
import { defaultEdges, defaultNodes, workflowNodeConfigIsEmpty } from "./graph";
import type { WorkflowDefinition, WorkflowDraft } from "../types";

export type StarterParams = {
  activeWorkflowId: string;
  initialDraft: WorkflowDraft | null;
  initialWorkflowId: string;
  workflows: WorkflowDefinition[];
};

/** 사용자가 손대지 않은 기본 캔버스인가. 그래야 저장된 워크플로우를 자동으로 띄워도 된다. */
export function isStarterWorkflowDraft(draft: WorkflowDraft | null) {
  if (!draft) return true;
  if (
    Object.keys(draft.classifierDraftsByNodeId ?? {}).length ||
    Object.keys(draft.schemaDraftsByNodeId ?? {}).length ||
    Object.keys(draft.checklistDraftsByNodeId ?? {}).length
  ) {
    return false;
  }
  if (draft.activeWorkflowId) return false;
  if (draft.nodes.length !== defaultNodes.length || draft.edges.length !== defaultEdges.length) return false;
  return draft.nodes.every((node, index) => {
    const defaultNode = defaultNodes[index];
    return (
      node.id === defaultNode.id &&
      node.data.kind === defaultNode.data.kind &&
      node.data.label === defaultNode.data.label &&
      workflowNodeConfigIsEmpty(node) &&
      Math.abs(node.position.x - defaultNode.position.x) < 0.5 &&
      Math.abs(node.position.y - defaultNode.position.y) < 0.5
    );
  });
}

/** 기본 캔버스로 들어왔을 때 자동으로 불러올 워크플로우(활성 워크플로우 → 목록의 첫 항목). 없으면 null. */
export function starterWorkflowToAutoLoad(params: StarterParams) {
  if (params.initialWorkflowId || !isStarterWorkflowDraft(params.initialDraft)) return null;
  if (params.activeWorkflowId) {
    const activeWorkflow = params.workflows.find((workflow) => workflow.id === params.activeWorkflowId);
    if (activeWorkflow) return activeWorkflow;
  }
  return params.workflows[0] ?? null;
}
