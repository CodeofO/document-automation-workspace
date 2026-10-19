import { useEffect, useRef } from "react";
import { nodePalette } from "../model/graph";
import type { WorkflowNodeContextMenu, WorkflowNodeKind } from "../types";
import { NodeIcon } from "./NodeIcon";

/** 캔버스 빈 곳 우클릭 메뉴(노드 추가). 바깥 클릭·Esc·스크롤·리사이즈로 닫는다. */
export function NodeContextMenu(props: {
  menu: WorkflowNodeContextMenu;
  onAdd: (kind: WorkflowNodeKind) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const { onClose } = props;

  useEffect(() => {
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (event.target instanceof globalThis.Node && ref.current?.contains(event.target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onClose);
    window.addEventListener("scroll", onClose, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="workflow-upload-menu workflow-upload-menu-fixed workflow-node-create-menu"
      role="menu"
      style={{ top: props.menu.top, left: props.menu.left }}
    >
      {nodePalette.map((item) => (
        <button key={item.kind} type="button" className="workflow-upload-menu-item" role="menuitem" onClick={() => props.onAdd(item.kind)}>
          <NodeIcon kind={item.kind} /> {item.label}
        </button>
      ))}
    </div>
  );
}
