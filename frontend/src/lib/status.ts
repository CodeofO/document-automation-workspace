// 상태 어휘 (docs/ux/module-unification-spec.md B-3). 화면마다 따로 있던 라벨 사전 5벌을 대체한다.

export type StatusTone = "info" | "neutral" | "warning" | "success" | "danger-soft" | "danger";

/** 같은 상태값이라도 주어(문서/작업/항목)에 따라 라벨이 다르다. */
export type StatusSubject = "job" | "document" | "field";

type StatusEntry = { label: string; tone: StatusTone; spinner?: boolean; documentLabel?: string; fieldLabel?: string };

const STATUS_VOCABULARY: Record<string, StatusEntry> = {
  uploading: { label: "업로드 중", tone: "info", spinner: true },
  queued: { label: "대기 중", tone: "neutral" },
  waiting_for_document: { label: "대기 중", tone: "neutral" },
  preprocessing: { label: "전처리 중", documentLabel: "변환 중", tone: "info", spinner: true },
  running: { label: "실행 중", tone: "info", spinner: true },
  canceling: { label: "중단 중", tone: "warning", spinner: true },
  paused: { label: "일시중단", tone: "warning" },
  interrupted: { label: "일시중단", tone: "warning" },
  cancel_requested: { label: "중단 중", tone: "warning", spinner: true },
  needs_review: { label: "검토 필요", tone: "warning" },
  uncertain: { label: "검토 필요", tone: "warning" },
  low_confidence: { label: "검토 필요", tone: "warning" },
  completed: { label: "완료", tone: "success" },
  complete: { label: "완료", tone: "success" },
  classified: { label: "분류 완료", tone: "success" },
  ready: { label: "준비 완료", tone: "success" },
  present: { label: "있음", tone: "success" },
  completed_with_errors: { label: "일부 실패", tone: "danger-soft" },
  incomplete: { label: "누락 있음", tone: "danger-soft" },
  missing: { label: "누락", tone: "danger-soft" },
  failed: { label: "실패", tone: "danger" },
  canceled: { label: "취소됨", tone: "neutral" },
  deleted: { label: "원본 삭제", tone: "neutral" },
  unknown: { label: "미분류", tone: "warning" }
};

export const ACTIVE_STATUSES = new Set([
  "uploading",
  "preprocessing",
  "queued",
  "running",
  "cancel_requested",
  "canceling"
]);

/** 더 이상 바뀌지 않는 배치·run·job 상태. 이 상태에서는 폴링을 멈춘다. */
export const TERMINAL_STATUSES = new Set(["completed", "completed_with_errors", "needs_review", "failed", "canceled"]);

/** 진행 중도 끝도 아닌, 사용자의 행동을 기다리는 상태. 느리게 폴링한다. */
export const WAITING_STATUSES = new Set(["paused", "interrupted", "waiting_for_document"]);

export function isActiveStatus(status: string | null | undefined): boolean {
  return Boolean(status && ACTIVE_STATUSES.has(status));
}

export function isTerminalStatus(status: string | null | undefined): boolean {
  return Boolean(status && TERMINAL_STATUSES.has(status));
}

export function statusLabel(status: string | null | undefined, subject: StatusSubject = "job"): string {
  if (!status) return "–";
  const entry = STATUS_VOCABULARY[status];
  if (!entry) return status;
  if (subject === "document" && entry.documentLabel) return entry.documentLabel;
  if (subject === "field" && entry.fieldLabel) return entry.fieldLabel;
  return entry.label;
}

export function statusTone(status: string | null | undefined): StatusTone {
  if (!status) return "neutral";
  return STATUS_VOCABULARY[status]?.tone ?? "neutral";
}

export function statusHasSpinner(status: string | null | undefined): boolean {
  return Boolean(status && STATUS_VOCABULARY[status]?.spinner);
}
