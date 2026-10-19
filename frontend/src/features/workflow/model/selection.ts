// 캔버스 선택 상태. React Flow가 알려주는 선택 노드·엣지를 하나의 값으로 줄인다.
import type { WorkflowSelection } from "../types";

export const NO_SELECTION: WorkflowSelection = { type: "none" };

/** 노드가 하나라도 선택되면 노드 선택, 아니면 첫 엣지, 아니면 선택 없음. */
export function selectionFromFlow(nodes: { id: string }[], edges: { id: string }[]): WorkflowSelection {
  if (nodes.length) return { type: "nodes", ids: nodes.map((node) => node.id) };
  if (edges.length) return { type: "edge", id: edges[0].id };
  return NO_SELECTION;
}

export function sameSelection(a: WorkflowSelection, b: WorkflowSelection) {
  if (a.type !== b.type) return false;
  if (a.type === "edge" && b.type === "edge") return a.id === b.id;
  if (a.type === "nodes" && b.type === "nodes") {
    return a.ids.length === b.ids.length && a.ids.every((id) => b.ids.includes(id));
  }
  return true;
}

const EMPTY_IDS: string[] = [];

export function selectionNodeIds(selection: WorkflowSelection) {
  return selection.type === "nodes" ? selection.ids : EMPTY_IDS;
}
