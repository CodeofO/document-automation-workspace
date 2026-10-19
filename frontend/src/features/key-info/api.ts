// KIE API 호출과 쿼리 키.
import { api, jsonBody } from "../../api/client";
import type { ArchiveSearchResult, AuditEvent, ExportPreset } from "../../api/types";
import { pollUntil } from "../../api/polling";
import type { Batch, ExtractionJob, SavedSchema, UploadedDocument } from "./types";

export const kieKeys = {
  schemas: ["kie", "schemas"] as const,
  batches: ["kie", "batches"] as const,
  batch: (batchId: string) => ["kie", "batch", batchId] as const,
  archive: (query: string, status: string) => ["kie", "archive", query, status] as const,
  exportPresets: (schemaId: string) => ["kie", "export-presets", schemaId] as const
};

export const BATCH_LIST_LIMIT = 12;

export const listSchemas = () => api<SavedSchema[]>("/api/schemas");
export const listBatches = () => api<Batch[]>(`/api/batches?limit=${BATCH_LIST_LIMIT}`);
export const getBatch = (batchId: string) => api<Batch>(`/api/batches/${batchId}`);
export const getBatchSummary = (batchId: string) => api<Batch>(`/api/batches/${batchId}/summary`);
export const getDocument = (documentId: string, signal?: AbortSignal) =>
  api<UploadedDocument>(`/api/documents/${documentId}`, { signal });
export const getSchema = (schemaId: string, signal?: AbortSignal) =>
  api<SavedSchema>(`/api/schemas/${schemaId}`, { signal });
export const getExtractionJob = (jobId: string, signal?: AbortSignal) =>
  api<ExtractionJob>(`/api/extraction-jobs/${jobId}`, { signal });

export function searchArchive(query: string, status: string) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  if (status) params.set("status", status);
  params.set("limit", "12");
  return api<ArchiveSearchResult[]>(`/api/archive/search?${params.toString()}`);
}

export function listAuditEvents(entityType: string, entityId: string) {
  return api<AuditEvent[]>(`/api/audit-events?entity_type=${entityType}&entity_id=${entityId}&limit=8`);
}

export function listExportPresets(schemaId: string) {
  return api<ExportPreset[]>(`/api/export-presets?schema_id=${schemaId}`);
}

export function uploadDocument(file: File) {
  const form = new FormData();
  form.append("file", file);
  return api<UploadedDocument>("/api/documents", { method: "POST", body: form });
}

export function createBatchFromDocuments(schemaId: string, documentIds: string[]) {
  return api<Batch>("/api/batches/from-documents", jsonBody("POST", { schema_id: schemaId, document_ids: documentIds }));
}

export const EXTRACTION_TERMINAL_STATUSES = new Set(["completed", "failed", "needs_review", "canceled"]);
export const EXTRACTION_LONG_RUNNING_NOTICE_MS = 60_000;

function extractionPollDelayMs(elapsedMs: number) {
  if (elapsedMs < EXTRACTION_LONG_RUNNING_NOTICE_MS) return 800;
  if (elapsedMs < 5 * 60_000) return 1_500;
  return 3_000;
}

/**
 * 추출 job이 끝날 때까지 기다린다. 서버 job이 running인 동안은 클라이언트가 실패 처리하지 않는다
 * (ERROR_NOTE 2026-06-08: 로컬 VLM은 수 분 이상 걸릴 수 있다).
 */
export function pollExtractionJob(
  jobId: string,
  options: { onProgress?: (job: ExtractionJob, elapsedMs: number) => void; signal?: AbortSignal } = {}
) {
  return pollUntil((signal) => getExtractionJob(jobId, signal), {
    isDone: (job) => EXTRACTION_TERMINAL_STATUSES.has(job.status),
    onProgress: options.onProgress,
    intervalMs: extractionPollDelayMs,
    signal: options.signal
  });
}
