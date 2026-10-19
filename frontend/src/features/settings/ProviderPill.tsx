import type { SystemStatus } from "../../api/types";

export function ProviderPill({ status }: { status: SystemStatus | null }) {
  if (!status) return <span className="provider-pill warning">API 상태 알 수 없음</span>;
  const detail = status.vlm_model_name || (status.is_mock ? "Mock" : status.has_vlm_credentials ? "모델 준비됨" : "모델 미설정");
  return (
    <span className={`provider-pill ${status.is_mock ? "mock" : status.has_vlm_credentials ? "ready" : "warning"}`}>
      VLM · {detail}
    </span>
  );
}
