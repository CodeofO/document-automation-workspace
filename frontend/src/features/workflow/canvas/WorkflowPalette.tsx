import { CheckSquare, ClipboardList, Plus, Sparkles } from "lucide-react";
import { useNavigate } from "react-router";
import { ROUTES } from "../../../app/routes";
import { nodePalette } from "../model/graph";
import type { WorkflowNodeKind } from "../types";
import { NodeIcon } from "./NodeIcon";

/** 왼쪽 모듈 팔레트. 누르면 노드를 추가하고 그 노드만 선택한다(편집기는 열지 않음).
 *  한 줄 행(아이콘 · 이름 · +)으로 900px 높이에서도 스크롤 없이 보이게 한다. 설명은 title 툴팁으로 보여준다. */
export function WorkflowPalette(props: { onAdd: (kind: WorkflowNodeKind) => void }) {
  const navigate = useNavigate();
  return (
    <aside className="workflow-palette" aria-label="워크플로우 모듈">
      <div className="workflow-panel-header">
        <p className="eyebrow">Builder</p>
        <h2>모듈</h2>
      </div>
      <div className="workflow-node-list">
        {nodePalette.map((item) => (
          <button
            key={item.kind}
            type="button"
            className="workflow-palette-item"
            title={item.description}
            onClick={() => props.onAdd(item.kind)}
          >
            <NodeIcon kind={item.kind} />
            <strong>{item.label}</strong>
            <Plus size={14} aria-hidden="true" className="workflow-palette-add" />
          </button>
        ))}
      </div>
      <div className="workflow-library-shortcuts">
        <button type="button" className="secondary" onClick={() => navigate(ROUTES.keyInfo)}>
          <Sparkles size={15} /> Schema 생성
        </button>
        <button type="button" className="secondary" onClick={() => navigate(ROUTES.classifier)}>
          <ClipboardList size={15} /> 분류기 생성
        </button>
        <button type="button" className="secondary" onClick={() => navigate(ROUTES.requiredCheck)}>
          <CheckSquare size={15} /> 체크리스트 생성
        </button>
      </div>
    </aside>
  );
}
