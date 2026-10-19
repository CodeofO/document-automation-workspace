// KIE 배치: 최근 배치 목록, 열려 있는 배치(요약 폴링), 중단·계속.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { api } from "../../../api/client";
import { POLL_IDLE_MS, POLL_RUNNING_MS, pollIntervalForStatus } from "../../../api/polling";
import { batchIsActive } from "../../module-batch/batchRules";
import { BATCH_LIST_LIMIT, getBatch, getBatchSummary, kieKeys, listBatches } from "../api";
import type { Batch } from "../types";

function upsertBatch(list: Batch[] | undefined, batch: Batch): Batch[] {
  return [batch, ...(list ?? []).filter((item) => item.id !== batch.id)].slice(0, BATCH_LIST_LIMIT);
}

export function useKieBatches(initialBatchId: string | null = null) {
  const queryClient = useQueryClient();
  const [activeBatchId, setActiveBatchId] = useState<string | null>(initialBatchId);
  const [activeItemId, setActiveItemId] = useState<string | null>(null);

  // 최근 배치 목록: 실행 중인 배치가 있으면 1.5초, 아니면 6초마다.
  const batchesQuery = useQuery({
    queryKey: kieKeys.batches,
    queryFn: listBatches,
    refetchInterval: (current) =>
      current.state.data?.some(
        (batch) => batchIsActive(batch) || batch.items.some((item) => ["preprocessing", "queued", "running"].includes(item.status))
      )
        ? POLL_RUNNING_MS
        : POLL_IDLE_MS
  });

  // 열려 있는 배치: 처음엔 항목까지 전체를, 이후엔 요약을 받아 항목을 유지한다. terminal이면 멈춘다.
  const activeBatchQuery = useQuery({
    queryKey: kieKeys.batch(activeBatchId ?? ""),
    enabled: Boolean(activeBatchId),
    queryFn: async () => {
      const key = kieKeys.batch(activeBatchId!);
      const previous = queryClient.getQueryData<Batch>(key);
      if (!previous) return getBatch(activeBatchId!);
      const summary = await getBatchSummary(activeBatchId!);
      return summary.items.length ? summary : { ...summary, items: previous.items };
    },
    refetchInterval: (current) => pollIntervalForStatus(current.state.data?.status)
  });

  const batches = useMemo(() => {
    const list = batchesQuery.data ?? [];
    const active = activeBatchQuery.data;
    return active ? upsertBatch(list, active) : list;
  }, [batchesQuery.data, activeBatchQuery.data]);

  const activeBatch = useMemo(
    () => (activeBatchId ? (batches.find((batch) => batch.id === activeBatchId) ?? null) : null),
    [batches, activeBatchId]
  );
  const activeItem = useMemo(() => {
    if (!activeBatch) return null;
    return activeBatch.items.find((item) => item.id === activeItemId) ?? activeBatch.items[0] ?? null;
  }, [activeBatch, activeItemId]);

  const putBatch = useCallback(
    (batch: Batch) => {
      queryClient.setQueryData(kieKeys.batch(batch.id), batch);
      queryClient.setQueryData<Batch[]>(kieKeys.batches, (current) => upsertBatch(current, batch));
    },
    [queryClient]
  );

  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: kieKeys.batches }), [queryClient]);

  async function discard(batchId: string) {
    const discarded = await api<Batch>(`/api/batches/${batchId}/discard`, { method: "POST" });
    putBatch(discarded);
    await refresh();
    return discarded;
  }

  async function resume(batchId: string) {
    const resumed = await api<Batch>(`/api/batches/${batchId}/resume`, { method: "POST" });
    putBatch(resumed);
    setActiveBatchId(resumed.id);
    setActiveItemId(resumed.items[0]?.id ?? null);
    await refresh();
    return resumed;
  }

  function close() {
    setActiveBatchId(null);
    setActiveItemId(null);
  }

  return {
    batches,
    activeBatchId,
    activeBatch,
    activeItem,
    activeItemId,
    /** 열린 배치가 갱신된 시각(현재 항목 결과를 따라 읽는 데 쓴다) */
    dataUpdatedAt: activeBatchQuery.dataUpdatedAt,
    setActiveBatchId,
    setActiveItemId,
    putBatch,
    refresh,
    discard,
    resume,
    close
  };
}

export type KieBatches = ReturnType<typeof useKieBatches>;
