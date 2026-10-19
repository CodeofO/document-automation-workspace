import { Loader2 } from "lucide-react";
import { statusHasSpinner, statusLabel, statusTone, type StatusSubject, type StatusTone } from "../../lib/status";

/** 상태값 하나를 라벨·tone으로 보여준다. null이면 "–". */
export function StatusBadge(props: {
  status: string | null | undefined;
  subject?: StatusSubject;
  /** 라벨을 직접 지정할 때(예: 모듈 고유 문구). tone은 status 기준. */
  label?: string;
  tone?: StatusTone;
  className?: string;
}) {
  const tone = props.tone ?? statusTone(props.status);
  return (
    <span
      className={["ui-status-badge", props.className ?? ""].filter(Boolean).join(" ")}
      data-tone={tone}
      data-status={props.status ?? "none"}
    >
      {statusHasSpinner(props.status) && <Loader2 size={12} className="spin" aria-hidden />}
      {props.label ?? statusLabel(props.status, props.subject)}
    </span>
  );
}

/** 개수 배지. 0이면 숨긴다(showZero로 강제 표시). */
export function CountBadge(props: { count: number; tone?: StatusTone; showZero?: boolean; label?: string }) {
  if (!props.count && !props.showZero) return null;
  return (
    <span className="ui-count-badge" data-tone={props.tone ?? "neutral"} aria-label={props.label}>
      {props.count.toLocaleString()}
    </span>
  );
}
