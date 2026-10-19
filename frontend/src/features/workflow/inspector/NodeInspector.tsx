// 노드 하나를 선택했을 때의 Inspector: 머리(아이콘·종류·이름·복제·삭제) + 종류별 설정 + 연결 + 검증.
import { ArrowLeft, ArrowRight, Copy, Trash2 } from "lucide-react";
import { IconButton } from "../../../components/ui";
import { NodeIcon } from "../canvas/NodeIcon";
import { branchKeyLabel, nodeKindLabel } from "../model/graph";
import type { WorkflowIssue } from "../types";
import { InspectorIssueList, InspectorSection } from "./InspectorParts";
import { inspectorRegistry, type NodeInspectorContext } from "./inspectorRegistry";

export function NodeInspector(
  props: NodeInspectorContext & {
    issues: WorkflowIssue[];
    onRename: (nodeId: string, label: string) => void;
    onDuplicate: (nodeId: string) => void;
    onDelete: (nodeId: string) => void;
  }
) {
  const { node, nodes, edges } = props;
  const labelOf = (nodeId: string) => nodes.find((item) => item.id === nodeId)?.data.label ?? nodeId;
  const incoming = edges.filter((edge) => edge.target === node.id);
  const outgoing = node.data.kind === "branch" ? [] : edges.filter((edge) => edge.source === node.id);
  return (
    <div className="wf-inspector" role="region" aria-label="노드 속성">
      <header className="wf-inspector-head">
        <span className="wf-inspector-icon" data-kind={node.data.kind}>
          <NodeIcon kind={node.data.kind} />
        </span>
        <div>
          <p className="eyebrow">{nodeKindLabel(node.data.kind)}</p>
          <input
            className="wf-inspector-title-input"
            value={node.data.label}
            onChange={(event) => props.onRename(node.id, event.target.value)}
            aria-label="노드 이름"
          />
        </div>
        <div className="wf-inspector-head-actions">
          <IconButton label="노드 복제 (⌘/Ctrl+D)" size="sm" variant="ghost" onClick={() => props.onDuplicate(node.id)}>
            <Copy size={15} />
          </IconButton>
          <IconButton label="노드 삭제 (Delete)" size="sm" variant="ghost" onClick={() => props.onDelete(node.id)}>
            <Trash2 size={15} />
          </IconButton>
        </div>
      </header>

      {inspectorRegistry[node.data.kind](props)}

      {(incoming.length > 0 || outgoing.length > 0 || node.data.kind !== "branch") && (
        <InspectorSection title="연결">
          {incoming.length === 0 && outgoing.length === 0 ? (
            <p className="wf-inspector-muted">연결된 노드가 없습니다. 노드 가장자리 점을 끌어 연결하세요.</p>
          ) : (
            <ul className="wf-connection-list">
              {incoming.map((edge) => (
                <li key={edge.id}>
                  <ArrowLeft size={13} />
                  <button type="button" className="wf-link" onClick={() => props.onSelectNode(edge.source)}>
                    {labelOf(edge.source)}
                    {edge.sourceHandle ? ` · ${branchKeyLabel(String(edge.sourceHandle))}` : ""}
                  </button>
                </li>
              ))}
              {outgoing.map((edge) => (
                <li key={edge.id}>
                  <ArrowRight size={13} />
                  <button type="button" className="wf-link" onClick={() => props.onSelectNode(edge.target)}>
                    {labelOf(edge.target)}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </InspectorSection>
      )}

      <InspectorSection title="검증">
        <InspectorIssueList issues={props.issues} emptyLabel="이 노드에는 문제가 없습니다." />
      </InspectorSection>
    </div>
  );
}
