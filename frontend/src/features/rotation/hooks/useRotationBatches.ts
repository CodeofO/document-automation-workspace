import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { pollIntervalForStatus } from "../../../api/polling";
import { isTerminalStatus } from "../../../lib/status";
import { fetchRecentRotationBatches, fetchRotationBatchProgress, rotationKeys } from "../api";
import { ROTATION_RECENT_LIMIT } from "../model";
import type { RotationBatch } from "../types";

/**
 * 최근 실행 목록과 지금 보는 배치. 배치는 실행 중 1.5초, 대기 6초로 폴링하고 terminal이면 멈춘다.
 * 폴링 오류는 다음 주기에 다시 시도하므로 화면을 막지 않는다.
 */
export function useRotationBatches(initialBatchId: string | null = null) {
  const queryClient = useQueryClient();
  const [activeBatchId, setActiveBatchId] = useState<string | null>(initialBatchId);

  const recentQuery = useQuery({
    queryKey: rotationKeys.recent(),
    queryFn: ({ signal }) => fetchRecentRotationBatches(signal)
  });

  const batchQuery = useQuery({
    queryKey: rotationKeys.batch(activeBatchId ?? ""),
    queryFn: ({ signal }) =>
      fetchRotationBatchProgress(
        activeBatchId as string,
        queryClient.getQueryData<RotationBatch>(rotationKeys.batch(activeBatchId as string)),
        signal
      ),
    enabled: Boolean(activeBatchId),
    refetchInterval: (query) => pollIntervalForStatus(query.state.data?.status)
  });
  const activeBatch = activeBatchId ? batchQuery.data : undefined;
  const terminal = activeBatch ? isTerminalStatus(activeBatch.status) : true;

  // 배치가 끝나면 최근 실행 목록(상태·보정 페이지 수)을 다시 읽는다.
  const finishedBatchId = activeBatch && terminal ? activeBatch.id : null;
  useEffect(() => {
    if (finishedBatchId) void queryClient.invalidateQueries({ queryKey: rotationKeys.recent() });
  }, [finishedBatchId, queryClient]);

  /** 새로 만든 배치를 바로 보여주고 최근 목록 맨 앞에 넣는다. */
  const showNewBatch = useCallback(
    (batch: RotationBatch) => {
      queryClient.setQueryData(rotationKeys.batch(batch.id), batch);
      queryClient.setQueryData<RotationBatch[]>(rotationKeys.recent(), (items = []) =>
        [{ ...batch, items: [] }, ...items.filter((item) => item.id !== batch.id)].slice(0, ROTATION_RECENT_LIMIT)
      );
      setActiveBatchId(batch.id);
    },
    [queryClient]
  );

  /** 최근 실행에서 배치를 연다(항상 서버에서 다시 읽는다). */
  const openBatch = useCallback(
    (batchId: string) => {
      void queryClient.resetQueries({ queryKey: rotationKeys.batch(batchId), exact: true });
      setActiveBatchId(batchId);
    },
    [queryClient]
  );

  /** 취소 응답을 반영한다. 응답에 항목이 없으면 기존 항목을 유지한다. */
  const applyBatchUpdate = useCallback(
    (batch: RotationBatch) => {
      queryClient.setQueryData<RotationBatch>(rotationKeys.batch(batch.id), (current) =>
        current ? { ...batch, items: batch.items.length ? batch.items : current.items } : batch
      );
    },
    [queryClient]
  );

  return {
    recentBatches: recentQuery.data ?? [],
    refreshRecent: () => void recentQuery.refetch(),
    activeBatch,
    activeTerminal: terminal,
    /** 배치를 처음 여는 데 실패했을 때만(폴링 중 오류는 숨긴다). */
    openError: activeBatchId && !batchQuery.data ? batchQuery.error : null,
    showNewBatch,
    openBatch,
    clearActiveBatch: () => setActiveBatchId(null),
    applyBatchUpdate,
    refreshRecentAfterCancel: () => void queryClient.invalidateQueries({ queryKey: rotationKeys.recent() })
  };
}
