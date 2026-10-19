// 캔버스 아래 고정 높이 한 줄: 검증 요약(누르면 워크플로우 Inspector), 실행 상태 오류, 자동 저장 시각.
// 일시 메시지는 토스트로 보내므로 여기 쌓이지 않는다.
import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";

export function WorkflowStatusBar(props: {
  errorCount: number;
  warningCount: number;
  persistentError: string | null;
  autosaveLabel: string | null;
  onOpenValidation: () => void;
}) {
  const ok = props.errorCount === 0 && props.warningCount === 0;
  return (
    <div className="wf-status-bar">
      <button
        type="button"
        className="wf-status-summary"
        data-tone={props.errorCount ? "danger" : props.warningCount ? "warning" : "success"}
        onClick={props.onOpenValidation}
        title="검증 내용을 오른쪽 패널에서 봅니다"
      >
        {ok ? (
          <>
            <CheckCircle2 size={14} /> 검증 통과
          </>
        ) : (
          <>
            {props.errorCount ? <CircleAlert size={14} /> : <AlertTriangle size={14} />}
            오류 {props.errorCount.toLocaleString()} · 경고 {props.warningCount.toLocaleString()}
          </>
        )}
      </button>
      {props.persistentError && (
        <span className="wf-status-error" role="alert" title={props.persistentError}>
          <AlertTriangle size={14} /> {props.persistentError}
        </span>
      )}
      <span className="wf-status-autosave">자동 저장 {props.autosaveLabel ?? "대기"}</span>
    </div>
  );
}
