// 결과 창의 상태·분류 필터와 항목 라벨.
import { documentLabel } from "../../../lib/format";
import type { WorkflowTableNodeResult } from "../../table-extraction";
import type { WorkflowClassFilterOption, WorkflowResultFilter, WorkflowRotationNodeResult, WorkflowRunItem } from "../types";
import { isRecord } from "./graph";

export const workflowResultFilterOptions: { value: WorkflowResultFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "success", label: "성공" },
  { value: "failed", label: "실패" },
  { value: "waiting", label: "대기" },
  { value: "running", label: "처리" },
  { value: "review", label: "검토" }
];

const WAITING_ITEM_STATUSES = ["uploading", "preprocessing", "queued", "paused"];

export function workflowResultFilterMatches(item: WorkflowRunItem, filter: WorkflowResultFilter) {
  if (filter === "all") return true;
  if (filter === "success") return item.status === "completed";
  if (filter === "failed") return item.status === "failed";
  if (filter === "waiting") return WAITING_ITEM_STATUSES.includes(item.status);
  if (filter === "running") return item.status === "running";
  return item.status === "needs_review";
}

export function workflowResultFilterCounts(items: WorkflowRunItem[]): Record<WorkflowResultFilter, number> {
  const counts: Record<WorkflowResultFilter, number> = { all: 0, success: 0, failed: 0, waiting: 0, running: 0, review: 0 };
  for (const option of workflowResultFilterOptions) {
    counts[option.value] = items.filter((item) => workflowResultFilterMatches(item, option.value)).length;
  }
  return counts;
}

export function workflowItemClassLabel(item: WorkflowRunItem) {
  const classification = item.result?.classification;
  return classification?.class_name || classification?.status || "미분류";
}

export function workflowItemClassFilterValue(item: WorkflowRunItem) {
  return workflowItemClassLabel(item).trim().toLowerCase() || "미분류";
}

export function workflowClassFilterMatches(item: WorkflowRunItem, filter: string) {
  if (filter === "all") return true;
  return workflowItemClassFilterValue(item) === filter;
}

export function workflowClassFilterOptions(items: WorkflowRunItem[]): WorkflowClassFilterOption[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    const value = workflowItemClassFilterValue(item);
    const current = counts.get(value);
    if (current) current.count += 1;
    else counts.set(value, { label: workflowItemClassLabel(item), count: 1 });
  }
  return [
    { value: "all", label: "전체 분류", count: items.length },
    ...Array.from(counts.entries())
      .map(([value, item]) => ({ value, label: item.label, count: item.count }))
      .sort((a, b) => a.label.localeCompare(b.label, "ko"))
  ];
}

/** 결과 목록·레일·Inspector 제목. 페이지 단위 item이면 "파일명 · p.3". */
export function workflowItemLabel(item: Pick<WorkflowRunItem, "filename" | "page_number">) {
  return documentLabel(item.filename, item.page_number);
}

export function workflowRotationNodeResults(
  nodeResults: Record<string, unknown> | undefined
): [string, WorkflowRotationNodeResult][] {
  return Object.entries(nodeResults ?? {}).filter((entry): entry is [string, WorkflowRotationNodeResult] => {
    const value = entry[1];
    return isRecord(value) && value.kind === "rotation";
  });
}

/** node_results 중 표 추출 노드 결과(kind "table"). */
export function workflowTableNodeResults(nodeResults: Record<string, unknown> | undefined): [string, WorkflowTableNodeResult][] {
  return Object.entries(nodeResults ?? {}).filter((entry): entry is [string, WorkflowTableNodeResult] => {
    const value = entry[1];
    return isRecord(value) && value.kind === "table";
  });
}

export function formatWorkflowValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
