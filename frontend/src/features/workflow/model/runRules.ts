// 워크플로우 실행(run) 규칙: 어떤 동작이 가능한지, 상태 라벨, 대기열 순서, 목록 병합.
// 장기적으로는 백엔드가 can_* 플래그를 내려주게 바꾼다(refactor-master-plan Phase 4-5).
import { isTerminalStatus } from "../../../lib/status";
import type { WorkflowRun } from "../types";

export const WORKFLOW_RUN_HISTORY_LIMIT = 50;

const ACTIVE_ITEM_STATUSES = ["uploading", "preprocessing", "queued", "running", "paused"];
const NON_DELETABLE_QUEUE_STATUSES = ["completed", "completed_with_errors", "needs_review", "failed"];

function uploadedCount(run: WorkflowRun) {
  return run.uploaded_count ?? run.items.length;
}

function countItems(run: WorkflowRun, status: string) {
  return run.items.filter((item) => item.status === status).length;
}

export function workflowRunPreprocessingCount(run: WorkflowRun) {
  return run.preprocessing_count ?? countItems(run, "preprocessing");
}

export function workflowRunRunningCount(run: WorkflowRun) {
  return run.running_count ?? countItems(run, "running");
}

export function workflowRunQueuedCount(run: WorkflowRun) {
  return run.queued_count ?? countItems(run, "queued");
}

export function workflowRunFinishedCount(run: WorkflowRun) {
  return Math.min(run.total_count, run.completed_count + run.failed_count + run.needs_review_count + (run.canceled_count ?? 0));
}

export function workflowRunIsTerminalOrWaiting(run: WorkflowRun) {
  return isTerminalStatus(run.status) || run.status === "waiting";
}

export function workflowRunIsLive(run: WorkflowRun) {
  return !workflowRunIsTerminalOrWaiting(run);
}

export function workflowRunIsPaused(run: WorkflowRun) {
  return run.status === "paused" || run.progress_phase === "paused";
}

export function workflowRunIsProcessing(run: WorkflowRun) {
  return workflowRunIsLive(run) && run.status !== "paused" && run.progress_phase !== "paused";
}

export function workflowRunCanResume(run: WorkflowRun) {
  const pausedCount = countItems(run, "paused");
  return run.status === "paused" && uploadedCount(run) === run.total_count && (pausedCount > 0 || run.items.length > 0);
}

export function workflowRunCanPause(run: WorkflowRun) {
  if (run.status === "waiting") return false;
  const pending = workflowRunPreprocessingCount(run) + workflowRunQueuedCount(run) + workflowRunRunningCount(run);
  return (
    !isTerminalStatus(run.status) && run.status !== "paused" && (uploadedCount(run) < run.total_count || pending > 0)
  );
}

export function workflowRunCanRestart(run: WorkflowRun) {
  if (run.status === "waiting") return false;
  const restartableStatus = ["paused", "completed", "completed_with_errors", "needs_review", "failed", "canceled"].includes(
    run.status
  );
  return restartableStatus && run.items.length > 0 && (uploadedCount(run) === run.total_count || run.status === "paused");
}

export function workflowRunCanRetryFailed(run: WorkflowRun) {
  if (run.status === "canceled" || run.status === "waiting" || run.failed_count <= 0) return false;
  return !run.items.some((item) => ACTIVE_ITEM_STATUSES.includes(item.status));
}

export function workflowRunCanResumeUpload(run: WorkflowRun) {
  return run.status !== "waiting" && !isTerminalStatus(run.status) && run.total_count > 0 && uploadedCount(run) < run.total_count;
}

export function workflowRunCanEnqueue(run: WorkflowRun) {
  return !["waiting", "canceled", "failed"].includes(run.status) && run.items.length > 0 && uploadedCount(run) === run.total_count;
}

export function workflowRunCanDeleteQueueEntry(run: WorkflowRun) {
  return Boolean(run.queued_from_run_id && !NON_DELETABLE_QUEUE_STATUSES.includes(run.status));
}

export function workflowRunDeleteQueueEntryLabel(run: WorkflowRun) {
  if (workflowRunIsProcessing(run) || workflowRunIsPaused(run)) return "중단 후 삭제";
  if (run.status === "waiting") return "대기 삭제";
  return "목록 삭제";
}

export function workflowRunCanDiscard(run: WorkflowRun) {
  return run.status !== "waiting" && !isTerminalStatus(run.status);
}

// --- 대기열 ---

export function normalizeBackendUtcDate(value: string) {
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)) return value;
  return `${value}Z`;
}

export function workflowRunTimestamp(value: string | undefined | null) {
  if (!value) return 0;
  const parsed = Date.parse(normalizeBackendUtcDate(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}

type QueuePosition = [number, number, string];

function workflowRunQueuePosition(run: WorkflowRun): QueuePosition {
  return [run.queue_order ?? 0, workflowRunTimestamp(run.created_at), run.id];
}

function compareWorkflowQueuePositions(a: QueuePosition, b: QueuePosition) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2].localeCompare(b[2]);
}

function workflowRunQueueGroup(run: WorkflowRun, runs: WorkflowRun[]) {
  const groupId = run.workflow_run_group_id ?? run.id;
  return runs.filter((item) => (item.workflow_run_group_id ?? item.id) === groupId);
}

/** 같은 그룹에서 가장 앞선 대기 run이고, 앞선 진행 중 run이 없을 때만 바로 실행할 수 있다. */
export function workflowRunCanStartWaiting(run: WorkflowRun, runs?: WorkflowRun[]) {
  if (run.status !== "waiting") return false;
  if (!runs?.length) return true;
  const groupRuns = workflowRunQueueGroup(run, runs);
  const firstWaiting =
    groupRuns
      .filter((item) => item.status === "waiting")
      .sort((a, b) => compareWorkflowQueuePositions(workflowRunQueuePosition(a), workflowRunQueuePosition(b)))[0] ?? null;
  if (!firstWaiting || firstWaiting.id !== run.id) return false;
  const runPosition = workflowRunQueuePosition(run);
  return !groupRuns.some(
    (item) =>
      item.id !== run.id &&
      !isTerminalStatus(item.status) &&
      compareWorkflowQueuePositions(workflowRunQueuePosition(item), runPosition) < 0
  );
}

export function workflowRunQueueMeta(run: WorkflowRun) {
  if (!run.queued_from_run_id) return "";
  if (run.status === "waiting") return " · 실행 예약";
  if (run.status === "canceled") return " · 예약 취소";
  if (isTerminalStatus(run.status)) return " · 예약 실행 완료";
  return " · 예약 실행 중";
}

// --- 목록 정렬·병합 ---

/** 등록 시각 최신순. 같은 시각이면 이전 목록 순서를 유지한다(폴링 중 깜빡임 방지). */
export function sortWorkflowRunsByRegistration(runs: WorkflowRun[], previousOrder: WorkflowRun[] = []) {
  const previousIndex = new Map(previousOrder.map((run, index) => [run.id, index]));
  return [...runs].sort((a, b) => {
    const timeDiff = workflowRunTimestamp(b.created_at) - workflowRunTimestamp(a.created_at);
    if (timeDiff) return timeDiff;
    const previousA = previousIndex.get(a.id);
    const previousB = previousIndex.get(b.id);
    if (previousA !== undefined && previousB !== undefined) return previousA - previousB;
    return 0;
  });
}

/** 목록/요약 응답은 items가 비어 있을 수 있다. 그때는 이미 가진 items를 유지한다. */
function keepItems(next: WorkflowRun, existing: WorkflowRun | undefined): WorkflowRun {
  return next.items.length || !existing ? next : { ...next, items: existing.items };
}

/** 폴링한 목록을 기존 목록과 합친다. */
export function mergeRunsList(loaded: WorkflowRun[], current: WorkflowRun[]) {
  const currentById = new Map(current.map((run) => [run.id, run]));
  return sortWorkflowRunsByRegistration(
    loaded.map((run) => keepItems(run, currentById.get(run.id))),
    current
  );
}

/** run 하나(요약·액션 응답)를 목록 맨 앞에 넣거나 교체한다. */
export function upsertRunInList(current: WorkflowRun[], run: WorkflowRun, limit = WORKFLOW_RUN_HISTORY_LIMIT) {
  const existing = current.find((item) => item.id === run.id);
  const merged = keepItems(run, existing);
  return sortWorkflowRunsByRegistration([merged, ...current.filter((item) => item.id !== run.id)], current).slice(0, limit);
}

/**
 * 실행 현황에서 강조할 run. 진행 중인 run이 있으면 그것을 따라가되,
 * 사용자가 직접 고른 run이 아직 살아 있으면 그대로 둔다.
 */
export function resolveActiveRunId(runs: WorkflowRun[], activeRunId: string, manualSelection: boolean) {
  if (!runs.length) return "";
  const current = runs.find((run) => run.id === activeRunId) ?? null;
  const liveRun = workflowLiveRun(runs);
  if (liveRun && (!manualSelection || !current || workflowRunIsTerminalOrWaiting(current))) return liveRun.id;
  if (!current) return (liveRun ?? runs[0]).id;
  return activeRunId;
}

/** 처리 중 → 일시중단 → 그 밖의 살아 있는 run 순서로 하나. */
export function workflowLiveRun(runs: WorkflowRun[]) {
  return (
    runs.find(workflowRunIsProcessing) ?? runs.find(workflowRunIsPaused) ?? runs.find(workflowRunIsLive) ?? null
  );
}

// --- 표시 ---

export function workflowRunStatusLabel(run: WorkflowRun) {
  if (run.status === "uploading") return "업로드 중";
  if (run.status === "preprocessing") return "전처리 중";
  if (run.status === "paused") return "일시중단";
  if (run.status === "waiting") return "실행 대기";
  if (run.status === "running") return "처리 중";
  if (run.status === "queued") return "대기";
  if (run.status === "failed") return "실패";
  if (run.status === "completed_with_errors") return "일부 실패";
  if (run.status === "needs_review") return "검토 필요";
  if (run.status === "canceled") return "취소";
  return "완료";
}

export function workflowRunHeadline(run: WorkflowRun) {
  if (run.status === "canceled") return "취소됨";
  if (run.status === "failed") return "실패";
  if (run.status === "completed_with_errors") return "일부 실패";
  if (run.status === "needs_review") return "검토 필요";
  if (run.status === "completed") return "작업 완료";
  if (run.status === "waiting" || run.progress_phase === "waiting") return "실행 대기";
  if (run.status === "paused" || run.progress_phase === "paused") return "일시중단";
  if (workflowRunCanResumeUpload(run) || run.progress_phase === "uploading") return "문서 업로드 중";
  if (run.progress_phase === "preprocessing") return "문서 전처리 중";
  if (!isTerminalStatus(run.status) && run.progress < 1) return "작업 진행 중";
  return workflowRunStatusLabel(run);
}

export function workflowRunVisualStatus(run: WorkflowRun) {
  if (run.status === "completed_with_errors") return "completed-with-errors";
  if (run.status === "needs_review") return "needs-review";
  if (run.status === "canceled") return "canceled";
  if (run.status === "failed") return "failed";
  if (run.status === "completed") return "completed";
  if (run.status === "paused" || run.progress_phase === "paused") return "paused";
  if (run.status === "waiting" || run.progress_phase === "waiting") return "waiting";
  if (run.status === "uploading" || run.progress_phase === "uploading") return "uploading";
  if (run.status === "preprocessing" || run.progress_phase === "preprocessing") return "preprocessing";
  if (run.status === "queued") return "queued";
  return "running";
}

export function workflowRunStatusClass(run: WorkflowRun) {
  return `status-${workflowRunVisualStatus(run).replace(/_/g, "-")}`;
}

/** 실행 규모. 실행 항목은 페이지 단위라 total_count는 페이지 수다. */
export function workflowRunSourceLabel(run: WorkflowRun) {
  return `${run.total_count.toLocaleString()}페이지`;
}

export function workflowRunSourceTitle(run: WorkflowRun) {
  return `${run.workflow_name || "선택한 실행"}의 ${workflowRunSourceLabel(run)}`;
}

export function workflowRunFailureSummary(run: WorkflowRun) {
  if (run.error_message) return run.error_message;
  if (run.status === "failed") return "결과 보기에서 항목별 오류를 확인하세요.";
  if (run.failed_count > 0) return `${run.failed_count.toLocaleString()}개 항목 실패. 결과 보기에서 항목별 오류를 확인하세요.`;
  return "";
}

export function formatWorkflowRunDate(value: string | undefined | null) {
  if (!value) return "시간 없음";
  const date = new Date(normalizeBackendUtcDate(value));
  if (Number.isNaN(date.getTime())) return "시간 없음";
  return date.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function workflowRunStartedAtLabel(run: WorkflowRun) {
  if (run.started_at) return formatWorkflowRunDate(run.started_at);
  if (run.status === "waiting" || run.progress_phase === "waiting") return "대기 중";
  if (["uploading", "preprocessing", "queued"].includes(run.status) || ["uploading", "preprocessing"].includes(run.progress_phase ?? "")) {
    return "준비 중";
  }
  return "기록 없음";
}

export function workflowRunCompletedAtLabel(run: WorkflowRun) {
  if (run.completed_at) return formatWorkflowRunDate(run.completed_at);
  if (workflowRunIsProcessing(run)) return "진행 중";
  if (workflowRunIsPaused(run)) return "일시중단";
  if (run.status === "waiting" || run.progress_phase === "waiting") return "대기 중";
  return "기록 없음";
}

function parseRunDate(value: string | undefined | null) {
  if (!value) return null;
  const date = new Date(normalizeBackendUtcDate(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatClock(date: Date) {
  return date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/**
 * 결과 헤더용 짧은 시간 범위("10:53–10:55"). 종료가 다른 날이면 종료 쪽에 월·일을 붙인다.
 * title에는 전체 시작·종료 시각을 담아 툴팁으로 보인다.
 */
export function workflowRunTimeRange(run: WorkflowRun) {
  const title = `시작 ${workflowRunStartedAtLabel(run)} · 종료 ${workflowRunCompletedAtLabel(run)}`;
  const start = parseRunDate(run.started_at);
  if (!start) return { label: workflowRunStartedAtLabel(run), title };
  const end = parseRunDate(run.completed_at);
  let endLabel = workflowRunCompletedAtLabel(run);
  if (end) {
    const sameDay = end.toDateString() === start.toDateString();
    endLabel = sameDay
      ? formatClock(end)
      : `${end.toLocaleDateString("ko-KR", { month: "2-digit", day: "2-digit" })} ${formatClock(end)}`;
  }
  return { label: `${formatClock(start)}–${endLabel}`, title };
}

export function formatDurationMs(value: number | null | undefined) {
  if (value === null || value === undefined) return "-";
  if (value < 1000) return `${value}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}초`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}분 ${remainingSeconds}초`;
}

export function workflowRunPercent(run: WorkflowRun) {
  return Math.round(run.progress * 100);
}
