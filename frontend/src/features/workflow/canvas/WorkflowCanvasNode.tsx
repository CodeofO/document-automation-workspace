import { Handle, Position, type NodeProps } from "@xyflow/react";
import { branchKeyLabel, nodeKindDescription, normalizeBranchKeys } from "../model/graph";
import type { WorkflowNode } from "../types";
import { NodeIcon } from "./NodeIcon";

/**
 * React Flow 사용자 정의 노드. 선택은 React Flow가 처리한다(카드에 클릭 핸들러 없음).
 * 설정은 오른쪽 Inspector에서 바꾸고, 카드는 읽기 전용 칩과 배지만 보여준다.
 */
export function WorkflowCanvasNode({ data, selected }: NodeProps<WorkflowNode>) {
  const kind = data.kind;
  const view = data.view;
  const branchKeys = normalizeBranchKeys(data.branchKeys);
  const connectedBranchKeys = new Set(view?.connectedBranchKeys ?? []);
  const errorCount = view?.errorCount ?? 0;
  const warningCount = view?.warningCount ?? 0;
  return (
    <div
      className={["workflow-node", `workflow-node-${kind}`, view?.chip ? "workflow-node-configurable" : "", selected ? "selected" : ""]
        .filter(Boolean)
        .join(" ")}
      data-node-kind={kind}
    >
      {kind !== "input" && <Handle className="workflow-handle workflow-handle-target" type="target" position={Position.Left} />}
      {(errorCount > 0 || warningCount > 0 || view?.hasDraft) && (
        <div className="wf-node-badges">
          {view?.hasDraft && (
            <span className="wf-node-badge" data-tone="draft" title="저장되지 않은 에셋 초안이 있습니다">
              ● 초안
            </span>
          )}
          {errorCount > 0 && (
            <span className="wf-node-badge" data-tone="danger" title={`오류 ${errorCount}개`}>
              오류 {errorCount}
            </span>
          )}
          {warningCount > 0 && (
            <span className="wf-node-badge" data-tone="warning" title={`경고 ${warningCount}개`}>
              경고 {warningCount}
            </span>
          )}
        </div>
      )}
      <div className="workflow-node-title">
        <NodeIcon kind={kind} />
        <strong>{data.label}</strong>
      </div>
      <span>{nodeKindDescription(kind)}</span>
      {view?.chip && (
        <span className="wf-node-chip" data-missing={view.chipMissing ? "true" : undefined} title={view.chip}>
          {view.chip}
        </span>
      )}
      {kind === "branch" ? (
        <>
          <div className="branch-handles">
            {branchKeys.map((key) => (
              <div key={key} className={`branch-handle-row ${connectedBranchKeys.has(key) ? "connected" : "missing"}`}>
                <span
                  className="branch-route-dot"
                  title={connectedBranchKeys.has(key) ? "후속 노드 연결됨" : "후속 노드 없음 · 분류 결과만 export"}
                />
                <small>{branchKeyLabel(key)}</small>
              </div>
            ))}
          </div>
          {branchKeys.map((key, index) => (
            <Handle
              key={key}
              id={key}
              className="workflow-handle workflow-handle-branch-source"
              type="source"
              position={Position.Right}
              style={{ top: 76 + index * 26 }}
            />
          ))}
        </>
      ) : kind !== "export" ? (
        <Handle className="workflow-handle workflow-handle-source" type="source" position={Position.Right} />
      ) : null}
    </div>
  );
}

export const workflowNodeTypes = { workflow: WorkflowCanvasNode };
