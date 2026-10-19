// 회전 보정 API(openapi-fetch 타입 클라이언트)와 Query 키.
import { apiClient, unwrap, type Schemas } from "../../api/client";
import { isTerminalStatus } from "../../lib/status";
import { ROTATION_RECENT_LIMIT, rotationDoneCount } from "./model";
import type { ManualRotationDegrees, RotationBatch, RotationBatchItem, RotationPageResult } from "./types";

export const rotationKeys = {
  all: ["rotation"] as const,
  recent: () => ["rotation", "batches", "recent"] as const,
  batch: (batchId: string) => ["rotation", "batches", batchId] as const
};

/** 서버 응답을 뷰 모델로. pages가 빠져 있어도 빈 배열로 둔다. page_number는 있으면 그대로 둔다. */
export function toRotationBatch(batch: Schemas["RotationBatchRead"]): RotationBatch {
  return { ...batch, items: (batch.items ?? []).map(toRotationBatchItem) };
}

function toRotationBatchItem(item: Schemas["RotationBatchItemRead"]): RotationBatchItem {
  const withPage = item as Schemas["RotationBatchItemRead"] & { page_number?: number | null };
  return {
    ...item,
    job_id: item.job_id ?? null,
    error_message: item.error_message ?? null,
    page_number: withPage.page_number ?? null,
    pages: (item.pages ?? []) as RotationPageResult[]
  };
}

export async function fetchRecentRotationBatches(signal?: AbortSignal): Promise<RotationBatch[]> {
  const batches = unwrap(
    await apiClient.GET("/api/rotation-batches", {
      params: { query: { limit: ROTATION_RECENT_LIMIT, include_items: false } },
      signal
    })
  );
  return Array.isArray(batches) ? batches.map(toRotationBatch) : [];
}

export async function fetchRotationBatch(batchId: string, signal?: AbortSignal): Promise<RotationBatch> {
  return toRotationBatch(
    unwrap(await apiClient.GET("/api/rotation-batches/{batch_id}", { params: { path: { batch_id: batchId } }, signal }))
  );
}

export async function fetchRotationBatchSummary(batchId: string, signal?: AbortSignal): Promise<RotationBatch> {
  return toRotationBatch(
    unwrap(
      await apiClient.GET("/api/rotation-batches/{batch_id}/summary", { params: { path: { batch_id: batchId } }, signal })
    )
  );
}

/**
 * 폴링 한 번. 요약(항목 없음)을 먼저 읽고, 끝난 항목 수가 바뀌었거나 terminal이면 상세를 다시 읽는다.
 * 그 외에는 이전 항목 목록을 유지한 채 카운터만 갱신한다.
 */
export async function fetchRotationBatchProgress(
  batchId: string,
  previous: RotationBatch | undefined,
  signal?: AbortSignal
): Promise<RotationBatch> {
  if (!previous) return fetchRotationBatch(batchId, signal);
  const summary = await fetchRotationBatchSummary(batchId, signal);
  if (isTerminalStatus(summary.status) || rotationDoneCount(summary) !== rotationDoneCount(previous)) {
    return fetchRotationBatch(batchId, signal);
  }
  return { ...summary, items: previous.items };
}

export async function createRotationBatch(documentIds: string[]): Promise<RotationBatch> {
  return toRotationBatch(
    unwrap(await apiClient.POST("/api/rotation-batches/from-documents", { body: { document_ids: documentIds } }))
  );
}

export async function cancelRotationBatch(batchId: string): Promise<RotationBatch> {
  return toRotationBatch(
    unwrap(await apiClient.POST("/api/rotation-batches/{batch_id}/cancel", { params: { path: { batch_id: batchId } } }))
  );
}

/** 페이지 하나를 수동으로 돌린다. 서버가 적용한 누적 각도를 돌려준다(없으면 undefined). */
export async function rotateDocumentPage(
  documentId: string,
  pageNumber: number,
  degrees: ManualRotationDegrees
): Promise<number | undefined> {
  const document = unwrap(
    await apiClient.POST("/api/documents/{document_id}/pages/{page_number}/rotate", {
      params: { path: { document_id: documentId, page_number: pageNumber } },
      body: { degrees }
    })
  );
  return document.pages?.find((page) => page.page === pageNumber)?.rotation_applied;
}
