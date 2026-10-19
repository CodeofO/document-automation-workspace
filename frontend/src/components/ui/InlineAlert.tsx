import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import type { ReactNode } from "react";
import type { StatusTone } from "../../lib/status";

export type AlertTone = Extract<StatusTone, "info" | "success" | "warning" | "danger">;

const ICONS: Record<AlertTone, ReactNode> = {
  info: <Info size={16} />,
  success: <CheckCircle2 size={16} />,
  warning: <AlertTriangle size={16} />,
  danger: <XCircle size={16} />
};

/** 페이지 상단·카드 안의 인라인 알림. 전역 .alert, status-card, success-card를 대체한다. */
export function InlineAlert(props: {
  tone?: AlertTone;
  children: ReactNode;
  busy?: boolean;
  onDismiss?: () => void;
  className?: string;
  action?: ReactNode;
}) {
  const tone = props.tone ?? "info";
  return (
    <div
      className={["ui-inline-alert", props.className ?? ""].filter(Boolean).join(" ")}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span className="ui-inline-alert-icon" aria-hidden>
        {props.busy ? <Loader2 size={16} className="spin" /> : ICONS[tone]}
      </span>
      <div className="ui-inline-alert-body">{props.children}</div>
      {props.action}
      {props.onDismiss && (
        <button type="button" className="ui-inline-alert-close" aria-label="알림 닫기" onClick={props.onDismiss}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}
