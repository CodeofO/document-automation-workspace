import type { ReactNode } from "react";

/** 빈 상태 표시. 기존 .empty-state 계열 7종을 이 하나로 모은다. */
export function EmptyState(props: {
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={["ui-empty-state", props.compact ? "compact" : "", props.className ?? ""].filter(Boolean).join(" ")}>
      {props.icon && <span className="ui-empty-state-icon">{props.icon}</span>}
      {props.title && <strong>{props.title}</strong>}
      {props.children && <span>{props.children}</span>}
      {props.action}
    </div>
  );
}
