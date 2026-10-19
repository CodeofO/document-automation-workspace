import { AlertCircle, Check, Loader2 } from "lucide-react";

export type SaveState = "idle" | "dirty" | "pending" | "saving" | "saved" | "error";

const LABELS: Record<SaveState, string> = {
  idle: "저장 전",
  dirty: "저장 안 된 변경",
  pending: "저장 대기",
  saving: "저장 중",
  saved: "저장됨",
  error: "저장 실패"
};

/** 정의 자동 저장·결과 수정 상태 표시. message가 있으면 툴팁으로 이유를 보여준다. */
export function SaveIndicator(props: { state: SaveState; label?: string; message?: string | null }) {
  return (
    <span className="ui-save-indicator" data-state={props.state} title={props.message ?? undefined} role="status">
      {props.state === "saving" ? (
        <Loader2 size={12} className="spin" aria-hidden />
      ) : props.state === "saved" ? (
        <Check size={12} aria-hidden />
      ) : props.state === "error" ? (
        <AlertCircle size={12} aria-hidden />
      ) : (
        <span className="ui-save-dot" aria-hidden />
      )}
      {props.label ?? LABELS[props.state]}
    </span>
  );
}
