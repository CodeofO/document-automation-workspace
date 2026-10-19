// 표 추출 API 호출·query key·hook. 계약: docs/table-extraction-api.md.
// 폴링 규칙은 api/polling.ts(실행 중 1.5초, 대기 6초, terminal이면 멈춤, 시도 횟수 제한 없음)를 따른다.
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, jsonBody } from "../../api/client";
import { POLL_IDLE_MS, POLL_RUNNING_MS, pollIntervalForStatus, pollUntil } from "../../api/polling";
import { isTerminalStatus } from "../../lib/status";
import type {
  TableExtractionBatch,
  TableExtractionJob,
  TableExtractionResult,
  TableExtractionResultPatch,
  TableRecommendation,
  TableRecommendationRequest,
  TableSpec,
  TableTemplate,
  TableTemplatePayload
} from "./types";

const TEMPLATES = "/api/table-templates";
const JOBS = "/api/table-extraction-jobs";
const RESULTS = "/api/table-extraction-results";
const BATCHES = "/api/table-extraction-batches";

export const tableKeys = {
  all: ["table-extraction"] as const,
  templates: () => ["table-extraction", "templates"] as const,
  template: (id: string) => ["table-extraction", "template", id] as const,
  job: (jobId: string) => ["table-extraction", "job", jobId] as const,
  batch: (batchId: string) => ["table-extraction", "batch", batchId] as const,
  batchSummary: (batchId: string) => ["table-extraction", "batch", batchId, "summary"] as const,
  capabilities: () => ["table-extraction", "capabilities"] as const
};

// ---- 양식 ----

export function listTableTemplates() {
  return api<TableTemplate[]>(TEMPLATES);
}

export function fetchTableTemplate(id: string) {
  return api<TableTemplate>(`${TEMPLATES}/${encodeURIComponent(id)}`);
}

export function createTableTemplate(payload: TableTemplatePayload) {
  return api<TableTemplate>(TEMPLATES, jsonBody("POST", payload));
}

export function updateTableTemplate(id: string, payload: Partial<TableTemplatePayload>) {
  return api<TableTemplate>(`${TEMPLATES}/${encodeURIComponent(id)}`, jsonBody("PATCH", payload));
}

/** 보관(archive). 응답은 archived=true인 양식. */
export function archiveTableTemplate(id: string) {
  return api<TableTemplate>(`${TEMPLATES}/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function duplicateTableTemplate(id: string) {
  return api<TableTemplate>(`${TEMPLATES}/${encodeURIComponent(id)}/duplicate`, { method: "POST" });
}

/** AI 칼럼 초안(VLM 1회, 동기). 오류: 문서 없음 404, 페이지 없음 422, VLM 오류 400, 칼럼 없음 502. */
export function recommendTableSpec(body: TableRecommendationRequest) {
  return api<TableRecommendation>(`${TEMPLATES}/recommendations`, jsonBody("POST", body));
}

// ---- 실행 ----

export function createTableJob(body: {
  document_id: string;
  page_number?: number;
  template_id: string;
  table_keys?: string[];
}) {
  return api<TableExtractionJob>(JOBS, jsonBody("POST", body));
}

/** 미저장 정의로 미리보기(ephemeral 양식). */
export function createDraftTableJob(body: {
  document_id: string;
  page_number?: number;
  definition: { name?: string; tables: TableSpec[] };
  table_keys?: string[];
}) {
  return api<TableExtractionJob>(`${JOBS}/draft`, jsonBody("POST", body));
}

export function fetchTableJob(jobId: string, signal?: AbortSignal) {
  return api<TableExtractionJob>(`${JOBS}/${encodeURIComponent(jobId)}`, { signal });
}

export function waitForTableJob(
  jobId: string,
  options: { signal?: AbortSignal; onProgress?: (job: TableExtractionJob) => void } = {}
) {
  return pollUntil((signal) => fetchTableJob(jobId, signal), {
    isDone: (job) => isTerminalStatus(job.status),
    onProgress: (job) => options.onProgress?.(job),
    intervalMs: POLL_RUNNING_MS,
    signal: options.signal
  });
}

export function patchTableResult(resultId: string, patch: TableExtractionResultPatch) {
  return api<TableExtractionResult>(`${RESULTS}/${encodeURIComponent(resultId)}`, jsonBody("PATCH", patch));
}

// ---- 배치 ----

export function createTableBatch(templateId: string, documentIds: string[]) {
  return api<TableExtractionBatch>(
    `${BATCHES}/from-documents`,
    jsonBody("POST", { template_id: templateId, document_ids: documentIds })
  );
}

export function fetchTableBatch(batchId: string) {
  return api<TableExtractionBatch>(`${BATCHES}/${encodeURIComponent(batchId)}`);
}

export function fetchTableBatchSummary(batchId: string) {
  return api<TableExtractionBatch>(`${BATCHES}/${encodeURIComponent(batchId)}/summary`);
}

export function resumeTableBatch(batchId: string) {
  return api<TableExtractionBatch>(`${BATCHES}/${encodeURIComponent(batchId)}/resume`, { method: "POST" });
}

export function discardTableBatch(batchId: string) {
  return api<TableExtractionBatch>(`${BATCHES}/${encodeURIComponent(batchId)}/discard`, { method: "POST" });
}

/** 단건(페이지) 결과 export. 결과가 없으면 409. */
export function tableJobExportUrl(jobId: string, format: TableExportFormat) {
  return `${JOBS}/${encodeURIComponent(jobId)}/export?format=${format}`;
}

export type TableExportFormat = "xlsx" | "csv" | "json";

/** 배치 export 파일(csv는 표마다 CSV를 담은 zip). 사람 수정본 우선. */
export function tableBatchExportUrl(batchId: string, format: TableExportFormat) {
  return `${BATCHES}/${encodeURIComponent(batchId)}/export?format=${format}`;
}

// ---- 캐시 ----

export function writeTemplateCache(queryClient: QueryClient, template: TableTemplate) {
  queryClient.setQueryData(tableKeys.template(template.id), template);
  queryClient.setQueryData<TableTemplate[]>(tableKeys.templates(), (current) => {
    const rest = (current ?? []).filter((item) => item.id !== template.id);
    return template.archived || template.ephemeral ? rest : [template, ...rest];
  });
}

export function writeTableBatchCache(queryClient: QueryClient, batch: TableExtractionBatch) {
  queryClient.setQueryData(tableKeys.batch(batch.id), batch);
  queryClient.setQueryData(tableKeys.batchSummary(batch.id), batch);
}

export function writeTableJobResult(queryClient: QueryClient, jobId: string, result: TableExtractionResult) {
  queryClient.setQueryData<TableExtractionJob>(tableKeys.job(jobId), (current) =>
    current ? { ...current, result } : current
  );
}

// ---- 배치 요약 합치기 ----

function progressSignature(batch: TableExtractionBatch) {
  return [
    batch.status,
    batch.completed_count,
    batch.failed_count,
    batch.canceled_count,
    batch.needs_review_count,
    batch.running_count,
    batch.preprocessing_count,
    batch.queued_count,
    batch.total_count
  ].join("|");
}

export function mergeTableBatch(detail: TableExtractionBatch | undefined, summary: TableExtractionBatch | undefined) {
  if (!detail) return summary ?? null;
  if (!summary) return detail;
  return { ...detail, ...summary, items: summary.items.length ? summary.items : detail.items };
}

function summaryAhead(detail: TableExtractionBatch | undefined, summary: TableExtractionBatch | undefined) {
  if (!detail || !summary) return false;
  return progressSignature(detail) !== progressSignature(summary);
}

// ---- hooks ----

/** 양식 목록(보관·draft 제외). 다른 탭의 변경을 반영하도록 대기 주기로 갱신한다. */
export function useTableTemplates() {
  return useQuery({ queryKey: tableKeys.templates(), queryFn: listTableTemplates, refetchInterval: POLL_IDLE_MS });
}

export function useTableTemplate(id: string | null) {
  return useQuery({
    queryKey: tableKeys.template(id ?? ""),
    queryFn: () => fetchTableTemplate(id as string),
    enabled: Boolean(id),
    staleTime: 10_000
  });
}

/** job(결과 포함). 실행 중이면 1.5초, terminal이면 멈춘다. */
export function useTableJob(jobId: string | null, externallyPolled = false) {
  return useQuery({
    queryKey: tableKeys.job(jobId ?? ""),
    queryFn: ({ signal }) => fetchTableJob(jobId as string, signal),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (externallyPolled ? false : pollIntervalForStatus(query.state.data?.status))
  });
}

/** 활성 배치: 요약(카운터)은 실행 중 1.5초, 항목 목록은 요약이 앞서면 곧바로·아니면 6초. */
export function useActiveTableBatch(batchId: string | null) {
  const summary = useQuery({
    queryKey: tableKeys.batchSummary(batchId ?? ""),
    queryFn: () => fetchTableBatchSummary(batchId as string),
    enabled: Boolean(batchId),
    refetchInterval: (query) => pollIntervalForStatus(query.state.data?.status)
  });
  const detail = useQuery({
    queryKey: tableKeys.batch(batchId ?? ""),
    queryFn: () => fetchTableBatch(batchId as string),
    enabled: Boolean(batchId),
    refetchInterval: (query) => {
      const current = query.state.data;
      if (isTerminalStatus(current?.status) && !summaryAhead(current, summary.data)) return false;
      return summaryAhead(current, summary.data) ? POLL_RUNNING_MS : POLL_IDLE_MS;
    }
  });
  const batch = batchId ? mergeTableBatch(detail.data, summary.data) : null;
  return { batch, error: detail.error ?? summary.error };
}
