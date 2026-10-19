import { X } from "lucide-react";
import { useId, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button";
import { useFocusTrap } from "./useFocusTrap";

/** 오른쪽에서 열리는 패널. 반투명 백드롭, Esc·백드롭 클릭으로 닫는다. */
export function Drawer(props: {
  open: boolean;
  title: ReactNode;
  eyebrow?: ReactNode;
  width?: CSSProperties["width"];
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useFocusTrap(props.open, panelRef, props.onClose);
  if (!props.open) return null;
  return createPortal(
    <div
      className="ui-drawer-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <aside
        ref={panelRef}
        className="ui-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: props.width ?? "min(960px, 75vw)" }}
      >
        <header className="ui-drawer-header">
          <div>
            {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
            <h2 id={titleId}>{props.title}</h2>
          </div>
          <IconButton label="닫기" size="sm" onClick={props.onClose}>
            <X size={16} />
          </IconButton>
        </header>
        <div className="ui-drawer-body">{props.children}</div>
        {props.footer && <footer className="ui-drawer-footer">{props.footer}</footer>}
      </aside>
    </div>,
    document.body
  );
}
