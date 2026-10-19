// 비동기 export job: 생성 → 완료까지 폴링 → 다운로드 창 열기.
import { api, apiUrl, jsonBody } from "../../api/client";
import type { Schemas } from "../../api/client";
import { pollUntil } from "../../api/polling";
import type { ExportMenuOption } from "../../components/ui";
import { EXPORT_FORMATS } from "../../components/ui";

export type ExportJobOwnerType =
  | "workflow_run"
  | "batch"
  | "classification_batch"
  | "required_field_check_batch"
  | "table_extraction_batch";
export type ExportJobFormat = "csv" | "json" | "xlsx";
export type ExportJobStatus = "queued" | "running" | "completed" | "failed";

/** 생성 타입(ExportJobRead)의 문자열 필드를 좁힌 뷰 모델. */
export type ExportJob = Omit<
  Schemas["ExportJobRead"],
  "owner_type" | "format" | "status" | "filename" | "content_type" | "error_message" | "started_at" | "completed_at"
> & {
  owner_type: ExportJobOwnerType;
  format: ExportJobFormat;
  status: ExportJobStatus;
  filename: string | null;
  content_type: string | null;
  error_message: string | null;
  started_at: string | null;
  completed_at: string | null;
};

export const EXPORT_JOB_UPDATED_EVENT = "digitize-export-job-updated";

export const exportJobKeys = {
  all: ["export-jobs"] as const,
  list: (filters: ExportJobFilters) => ["export-jobs", filters] as const
};

export type ExportJobFilters = {
  ownerType?: ExportJobOwnerType;
  ownerId?: string;
  status?: ExportJobStatus;
  limit?: number;
};

export function isExportJobActive(job: Pick<ExportJob, "status">) {
  return job.status === "queued" || job.status === "running";
}

export async function createAndDownloadExportJob(ownerType: ExportJobOwnerType, ownerId: string, format: ExportJobFormat) {
  const downloadWindow = openPendingExportWindow();
  try {
    const created = await api<ExportJob>(
      "/api/export-jobs",
      jsonBody("POST", { owner_type: ownerType, owner_id: ownerId, format })
    );
    notifyExportJobUpdated(created);
    const completed = await waitAndOpenExportDownload(created.id, downloadWindow);
    notifyExportJobUpdated(completed);
    return completed;
  } catch (exc) {
    downloadWindow?.close();
    throw exc;
  }
}

export async function retryAndDownloadExportJob(jobId: string) {
  const downloadWindow = openPendingExportWindow();
  try {
    const created = await api<ExportJob>(`/api/export-jobs/${jobId}/retry`, { method: "POST" });
    notifyExportJobUpdated(created);
    const completed = await waitAndOpenExportDownload(created.id, downloadWindow);
    notifyExportJobUpdated(completed);
    return completed;
  } catch (exc) {
    downloadWindow?.close();
    throw exc;
  }
}

export async function listExportJobs(filters: ExportJobFilters) {
  const params = new URLSearchParams();
  if (filters.ownerType) params.set("owner_type", filters.ownerType);
  if (filters.ownerId) params.set("owner_id", filters.ownerId);
  if (filters.status) params.set("status", filters.status);
  if (filters.limit) params.set("limit", String(filters.limit));
  const query = params.toString();
  return api<ExportJob[]>(`/api/export-jobs${query ? `?${query}` : ""}`);
}

export function exportJobDownloadUrl(jobId: string) {
  return apiUrl(`/api/export-jobs/${jobId}/download`);
}

export function openExportJobDownload(jobId: string) {
  window.open(exportJobDownloadUrl(jobId), "_blank", "noopener,noreferrer");
}

/** 배치·run export 메뉴 항목(JSON/CSV/XLSX). */
export function jobExportOptions(ownerType: ExportJobOwnerType, ownerId: string): ExportMenuOption[] {
  return EXPORT_FORMATS.map((format) => ({
    format,
    onExport: () => createAndDownloadExportJob(ownerType, ownerId, format)
  }));
}

// 서버가 끝낼 때까지 기다린다(시도 횟수 제한 없음).
async function waitAndOpenExportDownload(jobId: string, downloadWindow: Window | null) {
  const completed = await pollUntil(() => api<ExportJob>(`/api/export-jobs/${jobId}`), {
    isDone: (job) => !isExportJobActive(job),
    intervalMs: 1500
  });
  if (completed.status !== "completed") {
    throw new Error(completed.error_message || "Export 생성에 실패했습니다.");
  }
  const downloadUrl = exportJobDownloadUrl(completed.id);
  if (downloadWindow) downloadWindow.location.href = downloadUrl;
  else window.open(downloadUrl, "_blank", "noopener,noreferrer");
  return completed;
}

function openPendingExportWindow() {
  const downloadWindow = window.open("about:blank", "_blank");
  if (downloadWindow) {
    downloadWindow.opener = null;
    downloadWindow.document.title = "Export";
    downloadWindow.document.body.textContent = "Export 준비 중...";
  }
  return downloadWindow;
}

function notifyExportJobUpdated(job: ExportJob) {
  window.dispatchEvent(
    new CustomEvent(EXPORT_JOB_UPDATED_EVENT, {
      detail: { ownerType: job.owner_type, ownerId: job.owner_id, jobId: job.id, status: job.status }
    })
  );
}
