// 엣지 선택·여러 노드 선택 Inspector.
import { ArrowRight, Copy, Trash2, Unlink2 } from "lucide-react";
import { Button } from "../../../components/ui";
import { NodeIcon } from "../canvas/NodeIcon";
import { branchKeyLabel } from "../model/graph";
import type { WorkflowEdge, WorkflowNode } from "../types";
import { InspectorSection } from "./InspectorParts";

export function EdgeInspector(props: {
  edge: WorkflowEdge;
  nodes: WorkflowNode[];
  onSelectNode: (nodeId: string) => void;
  onDelete: (edgeId: string) => void;
}) {
  const source = props.nodes.find((node) => node.id === props.edge.source);
  const target = props.nodes.find((node) => node.id === props.edge.target);
  const branch = props.edge.sourceHandle ? branchKeyLabel(String(props.edge.sourceHandle)) : null;
  return (
    <div className="wf-inspector" role="region" aria-label="연결 속성">
      <header className="wf-inspector-head">
        <div>
          <p className="eyebrow">연결</p>
          <h3>
            {source?.data.label ?? props.edge.source} → {target?.data.label ?? props.edge.target}
          </h3>
        </div>
      </header>
      <InspectorSection title="경로">
        <div className="wf-edge-route">
          <button type="button" className="wf-edge-endpoint" onClick={() => props.onSelectNode(props.edge.source)}>
            {source && <NodeIcon kind={source.data.kind} />}
            <span>{source?.data.label ?? props.edge.source}</span>
          </button>
          <ArrowRight size={15} aria-hidden />
          <button type="button" className="wf-edge-endpoint" onClick={() => props.onSelectNode(props.edge.target)}>
            {target && <NodeIcon kind={target.data.kind} />}
            <span>{target?.data.label ?? props.edge.target}</span>
          </button>
        </div>
        <dl className="wf-kv">
          <div>
            <dt>분기 라벨</dt>
            <dd>{branch ?? "없음(일반 연결)"}</dd>
          </div>
        </dl>
      </InspectorSection>
      <div className="wf-inspector-actions">
        <Button size="sm" variant="danger-outline" icon={<Unlink2 size={14} />} onClick={() => props.onDelete(props.edge.id)}>
          선 삭제
        </Button>
      </div>
    </div>
  );
}

export function MultiSelectionInspector(props: {
  nodes: WorkflowNode[];
  onSelectNode: (nodeId: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="wf-inspector" role="region" aria-label="여러 노드 선택">
      <header className="wf-inspector-head">
        <div>
          <p className="eyebrow">여러 노드</p>
          <h3>{props.nodes.length.toLocaleString()}개 선택</h3>
        </div>
      </header>
      <InspectorSection title="선택한 노드">
        <ul className="wf-connection-list">
          {props.nodes.map((node) => (
            <li key={node.id}>
              <NodeIcon kind={node.data.kind} />
              <button type="button" className="wf-link" onClick={() => props.onSelectNode(node.id)}>
                {node.data.label}
              </button>
            </li>
          ))}
        </ul>
      </InspectorSection>
      <div className="wf-inspector-actions">
        <Button size="sm" icon={<Copy size={14} />} onClick={props.onDuplicate}>
          모두 복제
        </Button>
        <Button size="sm" variant="danger-outline" icon={<Trash2 size={14} />} onClick={props.onDelete}>
          {props.nodes.length.toLocaleString()}개 노드 삭제
        </Button>
      </div>
    </div>
  );
}
