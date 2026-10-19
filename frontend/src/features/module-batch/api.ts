// 분류·필수항목 공용 API 호출, query key, query hook.
// 폴링 규칙은 api/polling.ts를 따른다(실행 중 1.5초, 대기 6초, terminal이면 멈춤, 시도 횟수 제한 없음).
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { api, jsonBody } from "../../api/client";
import { POLL_IDLE_MS, POLL_RUNNING_MS, pollIntervalForStatus, pollUntil } from "../../api/polling";
import { isActiveStatus, isTerminalStatus } from "../../lib/status";
import { mergeBatchSummary, summaryAhead, upsertById } from "./model";
import type { ModuleBatch, ModuleDefinition, ModuleDocument, ModuleEndpoints, ModuleJob, ModuleKind, ModuleResultRecord } from "./types";

export const moduleKeys = {
  all: ["module-batch"] as const,
  kind: (kind: ModuleKind) => ["module-batch", kind] as const,
  definitions: (kind: ModuleKind) => ["module-batch", kind, "definitions"] as const,
  batch: (kind: ModuleKind, batchId: string) => ["module-batch", kind, "batch", batchId] as const,
  batchSummary: (kind: ModuleKind, batchId: string) => ["module-batch", kind, "batch", batchId, "summary"] as const,
  job: (kind: ModuleKind, jobId: string) => ["module-batch", kind, "job", jobId] as const,
  document: (documentId: string) => ["module-batch", "document", documentId] as const
};

type KindRef = { kind: ModuleKind; endpoints: ModuleEndpoints };

// ---- 정의(분류기·체크리스트) ----

export function listDefinitions<TDef>(ref: KindRef) {
  return api<TDef[]>(ref.endpoints.definitions);
}

export function saveDefinition<TDef>(ref: KindRef, id: string | null, payload: unknown) {
  const path = id ? `${ref.endpoints.definitions}/${id}` : ref.endpoints.definitions;
  return api<TDef>(path, jsonBody(id ? "PATCH" : "POST", payload));
}

export function deleteDefinition(ref: KindRef, id: string) {
  return api<unknown>(`${ref.endpoints.definitions}/${id}`, { method: "DELETE" });
}

export function duplicateDefinition<TDef>(ref: KindRef, id: string) {
  return api<TDef>(`${ref.endpoints.definitions}/${id}/duplicate`, { method: "POST" });
}

// ---- 단건 job ----

/** 단건 job. pageNumber가 없으면 여러 페이지 문서는 서버가 페이지마다 job을 만든다(배치 경로를 권장). */
export function createModuleJob<TOutput>(ref: KindRef, documentId: string, definitionId: string, pageNumber?: number | null) {
  return api<ModuleJob<TOutput>>(
    ref.endpoints.jobs,
    jsonBody("POST", {
      document_id: documentId,
      [ref.endpoints.definitionField]: definitionId,
      ...(pageNumber ? { page_number: pageNumber } : {})
    })
  );
}

export function fetchModuleJob<TOutput>(ref: KindRef, jobId: string, signal?: AbortSignal) {
  return api<ModuleJob<TOutput>>(`${ref.endpoints.jobs}/${jobId}`, { signal });
}

/** job이 terminal이 될 때까지 기다린다. 시도 횟수 제한 없음(ERROR_NOTE: 클라이언트가 실행 중 job을 실패 처리하지 않는다). */
export function waitForModuleJob<TOutput>(
  ref: KindRef,
  jobId: string,
  options: { signal?: AbortSignal; onProgress?: (job: ModuleJob<TOutput>) => void } = {}
) {
  return pollUntil((signal) => fetchModuleJob<TOutput>(ref, jobId, signal), {
    isDone: (job) => isTerminalStatus(job.status),
    onProgress: (job) => options.onProgress?.(job),
    intervalMs: POLL_RUNNING_MS,
    signal: options.signal
  });
}

export function patchModuleResult<TOutput>(ref: KindRef, resultId: string, output: TOutput) {
  return api<ModuleResultRecord<TOutput>>(
    `${ref.endpoints.results}/${resultId}`,
    jsonBody("PATCH", { corrected_output: output, reviewed: true })
  );
}

// ---- 배치 ----

export function createBatchFromDocuments(ref: KindRef, definitionId: string, documentIds: string[]) {
  return api<ModuleBatch>(
    `${ref.endpoints.batches}/from-documents`,
    jsonBody("POST", { [ref.endpoints.definitionField]: definitionId, document_ids: documentIds })
  );
}

export function fetchBatch(ref: KindRef, batchId: string) {
  return api<ModuleBatch>(`${ref.endpoints.batches}/${batchId}`);
}

/** 항목 없이 카운터만 담긴 요약(빠른 폴링용). */
export function fetchBatchSummary(ref: KindRef, batchId: string) {
  return api<ModuleBatch>(`${ref.endpoints.batches}/${batchId}/summary`);
}

export function resumeBatch(ref: KindRef, batchId: string) {
  return api<ModuleBatch>(`${ref.endpoints.batches}/${batchId}/resume`, { method: "POST" });
}

export function discardBatch(ref: KindRef, batchId: string) {
  return api<ModuleBatch>(`${ref.endpoints.batches}/${batchId}/discard`, { method: "POST" });
}

export function fetchModuleDocument(documentId: string) {
  return api<ModuleDocument>(`/api/documents/${documentId}`);
}

// ---- 캐시 갱신 ----

/** 서버가 돌려준 배치를 상세·요약 캐시에 반영한다(변경 응답에는 항목이 들어 있다). */
export function writeBatchCache(queryClient: QueryClient, kind: ModuleKind, batch: ModuleBatch) {
  queryClient.setQueryData(moduleKeys.batch(kind, batch.id), batch);
  queryClient.setQueryData(moduleKeys.batchSummary(kind, batch.id), batch);
}

export function writeDefinitionCache<TDef extends ModuleDefinition>(queryClient: QueryClient, kind: ModuleKind, definition: TDef) {
  queryClient.setQueryData<TDef[]>(moduleKeys.definitions(kind), (current) => upsertById(current ?? [], definition));
}

export function removeDefinitionCache<TDef extends ModuleDefinition>(queryClient: QueryClient, kind: ModuleKind, id: string) {
  queryClient.setQueryData<TDef[]>(moduleKeys.definitions(kind), (current) => (current ?? []).filter((item) => item.id !== id));
}

// ---- hooks ----

/** 정의 목록. 다른 탭·사용자의 변경을 반영하도록 대기 주기로 갱신한다. */
export function useModuleDefinitions<TDef extends ModuleDefinition>(ref: KindRef) {
  return useQuery({
    queryKey: moduleKeys.definitions(ref.kind),
    queryFn: () => listDefinitions<TDef>(ref),
    refetchInterval: POLL_IDLE_MS
  });
}

/**
 * 활성 배치. 카운터는 /summary를 실행 중 1.5초 주기로, 항목 목록은 상세를 대기 주기(6초)로 갱신하고
 * 둘을 합친다. 배치가 terminal이 되면 둘 다 멈춘다.
 */
export function useActiveModuleBatch(ref: KindRef, batchId: string | null) {
  const summary = useQuery({
    queryKey: moduleKeys.batchSummary(ref.kind, batchId ?? ""),
    queryFn: () => fetchBatchSummary(ref, batchId as string),
    enabled: Boolean(batchId),
    refetchInterval: (query) => pollIntervalForStatus(query.state.data?.status)
  });
  const detail = useQuery({
    queryKey: moduleKeys.batch(ref.kind, batchId ?? ""),
    queryFn: () => fetchBatch(ref, batchId as string),
    enabled: Boolean(batchId),
    // 요약의 진행 카운터가 상세보다 앞서 있으면(항목 상태가 바뀌었으면) 곧바로 다시 읽는다.
    refetchInterval: (query) => {
      const current = query.state.data;
      if (isTerminalStatus(current?.status) && !summaryAhead(current, summary.data)) return false;
      return summaryAhead(current, summary.data) ? POLL_RUNNING_MS : POLL_IDLE_MS;
    }
  });
  const batch = batchId ? mergeBatchSummary(detail.data, summary.data) : null;
  return { batch, error: detail.error ?? summary.error };
}

/** 단건 job. 실행 중이면 1.5초, terminal이면 멈춘다. externallyPolled면(실행 버튼이 기다리는 중) 쉰다. */
export function useModuleJob<TOutput>(ref: KindRef, jobId: string | null, externallyPolled: boolean) {
  return useQuery({
    queryKey: moduleKeys.job(ref.kind, jobId ?? ""),
    queryFn: ({ signal }) => fetchModuleJob<TOutput>(ref, jobId as string, signal),
    enabled: Boolean(jobId),
    refetchInterval: (query) => (externallyPolled ? false : pollIntervalForStatus(query.state.data?.status))
  });
}

/** 미리보기 문서. 변환 중이면 준비될 때까지 갱신한다. */
export function useModuleDocument(documentId: string | null) {
  return useQuery({
    queryKey: moduleKeys.document(documentId ?? ""),
    queryFn: () => fetchModuleDocument(documentId as string),
    enabled: Boolean(documentId),
    staleTime: 30_000,
    refetchInterval: (query) => (isActiveStatus(query.state.data?.status) ? POLL_RUNNING_MS : false)
  });
}
