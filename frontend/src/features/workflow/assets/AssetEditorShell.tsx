import { Plus } from "lucide-react";
import type { ReactNode } from "react";

/** Drawer 안 에셋 편집기 공통 머리: 부제(초안 상태)·주 동작. 닫기는 Drawer가 맡는다. */
export function AssetEditorShell(props: {
  title: string;
  subtitle: ReactNode;
  actionLabel: string;
  onAction: () => void;
  ariaLabel?: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section className={["wf-asset-editor", props.className ?? ""].filter(Boolean).join(" ")} aria-label={props.ariaLabel ?? props.title}>
      <div className="wf-asset-editor-head">
        <div>
          <strong>{props.title}</strong>
          <span>{props.subtitle}</span>
        </div>
        <button type="button" className="secondary compact" onClick={props.onAction}>
          <Plus size={14} /> {props.actionLabel}
        </button>
      </div>
      {props.children}
    </section>
  );
}

export type DraftUpdater<T> = (draft: T) => T;
