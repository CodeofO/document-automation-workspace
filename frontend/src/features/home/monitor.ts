// 홈 "최근 실행" 모니터: 워크플로우 run과 모듈 배치를 한 목록으로 합친다.
import { clamp01 } from "../../lib/format";
import { isActiveStatus } from "../../lib/status";

export type HomeWorkflowRun = {
  id: string;
  status: string;
  total_count: number;
  completed_count: number;
  failed_count: number;
  needs_review_count: number;
  canceled_count?: number;
  uploaded_count?: number;
  preprocessing_count?: number;
  ready_count?: number;
  queued_count?: number;
  running_count?: number;
  progress_phase?: string;
  progress: number;
  items: { status: string }[];
  created_at: string;
};

export type HomeModuleBatch = {
  id: string;
  status: string;
  total_count: number;
  completed_count: number;
  failed_count: number;
  canceled_count: number;
  uploaded_count?: number;
  preprocessing_count?: number;
  ready_count?: number;
  queued_count?: number;
  running_count?: number;
  needs_review_count?: number;
  progress_phase?: string;
  progress: number;
  items: { status: string }[];
  created_at: string;
  completed_at: string | null;
};

export type HomeMonitorTarget = "workflow" | "key-info" | "classifier" | "required-checker" | "rotation" | "table";

export type HomeMonitorItem = {
  id: string;
  target: HomeMonitorTarget;
  moduleLabel: string;
  title: string;
  status: string;
  progress: number;
  totalCount: number;
  doneCount: number;
  uploadedCount: number;
  preprocessingCount: number;
  runningCount: number;
  queuedCount: number;
  needsReviewCount: number;
  failedCount: number;
  canceledCount: number;
  pausedCount: number;
  createdAt: string;
};

export function buildHomeMonitorItems(
  workflowRuns: HomeWorkflowRun[],
  kieBatches: HomeModuleBatch[],
  classificationBatches: HomeModuleBatch[],
  requiredBatches: HomeModuleBatch[],
  rotationBatches: HomeModuleBatch[] = [],
  tableBatches: HomeModuleBatch[] = []
) {
  const workflowItems: HomeMonitorItem[] = workflowRuns.map((run) => {
    const pausedCount = run.items.filter((item) => item.status === "paused").length;
    const canceledCount = run.canceled_count ?? run.items.filter((item) => item.status === "canceled").length;
    return {
      id: run.id,
      target: "workflow",
      moduleLabel: "워크플로우",
      title: "워크플로우 실행",
      status: run.status,
      progress: run.progress ?? progressFromCounts(run.items, run.total_count, run.progress),
      totalCount: run.total_count,
      doneCount: Math.min(run.total_count, run.completed_count + run.failed_count + run.needs_review_count + canceledCount),
      uploadedCount: run.uploaded_count ?? run.items.length,
      preprocessingCount: run.preprocessing_count ?? run.items.filter((item) => item.status === "preprocessing").length,
      runningCount: run.running_count ?? run.items.filter((item) => item.status === "running").length,
      queuedCount: run.queued_count ?? run.items.filter((item) => item.status === "queued").length,
      needsReviewCount: run.needs_review_count,
      failedCount: run.failed_count,
      canceledCount,
      pausedCount,
      createdAt: run.created_at
    };
  });

  const moduleItems = [
    ...kieBatches.map((batch) => homeBatchToMonitorItem(batch, "key-info", "핵심 정보 추출")),
    ...classificationBatches.map((batch) => homeBatchToMonitorItem(batch, "classifier", "문서 분류")),
    ...requiredBatches.map((batch) => homeBatchToMonitorItem(batch, "required-checker", "필수 항목 확인")),
    ...rotationBatches.map((batch) => homeBatchToMonitorItem(batch, "rotation", "회전 보정")),
    ...tableBatches.map((batch) => homeBatchToMonitorItem(batch, "table", "표 추출"))
  ];

  const items = [...workflowItems, ...moduleItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const activeItems = items.filter((item) => isActiveHomeStatus(item.status));
  const recentItems = items.filter((item) => !isActiveHomeStatus(item.status));
  return [...activeItems, ...recentItems].slice(0, 5);
}

export function homeBatchToMonitorItem(batch: HomeModuleBatch, target: HomeMonitorTarget, moduleLabel: string): HomeMonitorItem {
  const runningCount = batch.running_count ?? batch.items.filter((item) => item.status === "running").length;
  const queuedCount = batch.queued_count ?? batch.items.filter((item) => item.status === "queued").length;
  const needsReviewCount = batch.needs_review_count ?? batch.items.filter((item) => item.status === "needs_review").length;
  const pausedCount = batch.items.filter((item) => item.status === "paused").length;
  const doneCount = Math.min(batch.total_count, batch.completed_count + batch.failed_count + batch.canceled_count + needsReviewCount);
  return {
    id: batch.id,
    target,
    moduleLabel,
    title: `${moduleLabel} 배치`,
    status: batch.status,
    progress: batch.progress ?? progressFromCounts(batch.items, batch.total_count, batch.progress),
    totalCount: batch.total_count,
    doneCount,
    uploadedCount: batch.uploaded_count ?? batch.items.length,
    preprocessingCount: batch.preprocessing_count ?? batch.items.filter((item) => item.status === "preprocessing").length,
    runningCount,
    queuedCount,
    needsReviewCount,
    failedCount: batch.failed_count,
    canceledCount: batch.canceled_count,
    pausedCount,
    createdAt: batch.created_at
  };
}

export function hasRunningHomeItems(items: { status: string }[]) {
  return items.some((item) => isActiveHomeStatus(item.status));
}

export function isActiveHomeStatus(status: string) {
  return isActiveStatus(status);
}

export function isStoppedHomeStatus(status: string) {
  return ["paused", "interrupted", "failed", "canceled", "completed_with_errors"].includes(status);
}

/** 카운터 문구. 순서는 공용 규칙(처리 · 검토 필요 · 실패 · 취소)을 따르고, 진행 중이면 실행·대기를 덧붙인다. */
export function homeMonitorCountText(item: HomeMonitorItem): string {
  const parts = [`처리 ${item.doneCount.toLocaleString()} / ${item.totalCount.toLocaleString()}`];
  if (item.needsReviewCount) parts.push(`검토 필요 ${item.needsReviewCount.toLocaleString()}`);
  if (item.failedCount) parts.push(`실패 ${item.failedCount.toLocaleString()}`);
  if (item.canceledCount) parts.push(`취소 ${item.canceledCount.toLocaleString()}`);
  if (isActiveStatus(item.status)) {
    if (item.preprocessingCount) parts.push(`전처리 ${item.preprocessingCount.toLocaleString()}`);
    if (item.runningCount) parts.push(`실행 ${item.runningCount.toLocaleString()}`);
    if (item.queuedCount) parts.push(`대기 ${item.queuedCount.toLocaleString()}`);
  }
  if (item.pausedCount) parts.push(`일시중단 ${item.pausedCount.toLocaleString()}`);
  return parts.join(" · ");
}

export function homeMonitorStopReason(item: HomeMonitorItem) {
  if (item.status === "paused") return "사용자가 일시중단했습니다.";
  if (item.status === "interrupted") return "업로드 또는 실행이 중간에 끊겼습니다.";
  if (item.status === "canceled") return "중단된 작업입니다. 끝난 결과는 남아 있습니다.";
  if (item.status === "failed") return "실패로 종료되었습니다.";
  if (item.status === "completed_with_errors") return "일부 항목이 실패하거나 취소된 채 끝났습니다.";
  return null;
}

export function terminalItemCount(items: { status: string }[], totalCount: number) {
  const count = items.filter((item) => ["completed", "completed_with_errors", "needs_review", "failed", "canceled"].includes(item.status)).length;
  return Math.min(Math.max(0, count), Math.max(0, totalCount));
}

export function progressFromCounts(items: { status: string }[], totalCount: number, fallbackProgress: number) {
  const total = Math.max(0, totalCount);
  if (total > 0 && items.length) return clamp01(terminalItemCount(items, total) / total);
  return clamp01(fallbackProgress);
}

