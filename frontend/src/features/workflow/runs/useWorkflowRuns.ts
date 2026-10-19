// 빌더 오른쪽 "실행 현황"의 데이터. 목록과 선택된 run 요약을 TanStack Query로 폴링한다.
// 규칙(spec B-3): 실행 중 1.5초, 대기·일시중단 6초, terminal이면 멈춘다. 클라이언트 시간 제한으로 실패 처리하지 않는다.
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { pollIntervalForList, pollIntervalForStatus } from "../../../api/polling";
import { isTerminalStatus } from "../../../lib/status";
import { deleteRunQueueEntry, fetchWorkflowRuns, fetchWorkflowRunSummary, postRunAction, workflowKeys } from "../api";
import { mergeRunsList, resolveActiveRunId, upsertRunInList } from "../model/runRules";
import type { WorkflowRun } from "../types";

const EMPTY_RUNS: WorkflowRun[] = [];

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** run 하나를 목록 캐시에 넣거나 바꾼다. */
export function upsertRunInCache(queryClient: QueryClient, run: WorkflowRun) {
  queryClient.setQueryData<WorkflowRun[]>(workflowKeys.runsList(), (current) => upsertRunInList(current ?? [], run));
}

/** run 요약을 받아 목록 캐시에 합친다. */
export async function refreshRunIntoCache(queryClient: QueryClient, runId: string, signal?: AbortSignal) {
  const run = await fetchWorkflowRunSummary(runId, signal);
  upsertRunInCache(queryClient, run);
  return run;
}

export function useWorkflowRunsList() {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: workflowKeys.runsList(),
    queryFn: async () => {
      const loaded = await fetchWorkflowRuns();
      return mergeRunsList(loaded, queryClient.getQueryData<WorkflowRun[]>(workflowKeys.runsList()) ?? []);
    },
    refetchInterval: (query) => pollIntervalForList((query.state.data ?? EMPTY_RUNS).map((run) => run.status))
  });
}

/** 선택된 run이 끝나지 않았으면 요약을 빠르게 폴링해 목록에 반영한다. */
function useActiveRunSummary(run: WorkflowRun | null) {
  const queryClient = useQueryClient();
  const runId = run?.id ?? "";
  return useQuery({
    queryKey: workflowKeys.runSummary(runId),
    queryFn: ({ signal }) => refreshRunIntoCache(queryClient, runId, signal),
    enabled: Boolean(run && !isTerminalStatus(run.status)),
    refetchInterval: (query) => pollIntervalForStatus(query.state.data?.status ?? run?.status)
  });
}

export type WorkflowRunsNotify = {
  message: (message: string | null) => void;
  error: (message: string | null) => void;
};

export function useWorkflowRuns(notify: WorkflowRunsNotify) {
  const queryClient = useQueryClient();
  const runsQuery = useWorkflowRunsList();
  const runs = runsQuery.data ?? EMPTY_RUNS;
  const [selection, setSelection] = useState({ runId: "", manual: false });

  // 진행 중인 run을 따라가도록 선택을 맞춘다(렌더 중 상태 보정, effect 없이).
  const activeRunId = resolveActiveRunId(runs, selection.runId, selection.manual);
  if (activeRunId !== selection.runId) setSelection((current) => ({ ...current, runId: activeRunId }));
  const activeRun = runs.find((run) => run.id === activeRunId) ?? runs[0] ?? null;
  const summaryQuery = useActiveRunSummary(activeRun);

  const focusRun = useCallback((runId: string, manual = true) => setSelection({ runId, manual }), []);
  const upsertRun = useCallback((run: WorkflowRun) => upsertRunInCache(queryClient, run), [queryClient]);

  const refreshRun = useCallback(
    async (runId: string) => {
      try {
        await refreshRunIntoCache(queryClient, runId);
      } catch (error) {
        notify.error(errorMessage(error, "워크플로우 실행 상태를 갱신하지 못했습니다."));
      }
    },
    [notify, queryClient]
  );

  /** 상태를 바꾸는 run 동작 공통: 응답을 캐시에 넣고 선택한 뒤 요약을 한 번 더 읽는다. */
  const runAction = useCallback(
    async (
      runId: string,
      action: "resume" | "pause" | "start" | "discard",
      messages: { success: string; failure: string },
      refreshAfter = true
    ) => {
      notify.error(null);
      try {
        const run = await postRunAction(runId, action);
        upsertRun(run);
        focusRun(run.id, false);
        notify.message(messages.success);
        if (refreshAfter) void refreshRun(run.id);
      } catch (error) {
        notify.error(errorMessage(error, messages.failure));
      }
    },
    [focusRun, notify, refreshRun, upsertRun]
  );

  const resumeRun = useCallback(
    (runId: string) =>
      runAction(runId, "resume", {
        success: "일시중단된 워크플로우 처리를 이어갑니다.",
        failure: "워크플로우를 계속 처리하지 못했습니다."
      }),
    [runAction]
  );
  const pauseRun = useCallback(
    (runId: string) =>
      runAction(runId, "pause", {
        success: "워크플로우 실행을 일시중단했습니다. 업로드된 문서는 보존됩니다.",
        failure: "워크플로우를 일시중단하지 못했습니다."
      }),
    [runAction]
  );
  const startWaitingRun = useCallback(
    (runId: string) =>
      runAction(runId, "start", {
        success: "대기 중인 워크플로우 실행을 바로 시작했습니다.",
        failure: "대기 중인 워크플로우 실행을 시작하지 못했습니다."
      }),
    [runAction]
  );
  const discardRun = useCallback(
    (runId: string) =>
      runAction(
        runId,
        "discard",
        { success: "워크플로우 추론을 중단했습니다. 문서는 보관함에 유지됩니다.", failure: "워크플로우 실행을 중단하지 못했습니다." },
        false
      ),
    [runAction]
  );

  const deleteQueueEntry = useCallback(
    async (runId: string) => {
      notify.error(null);
      try {
        await deleteRunQueueEntry(runId);
        queryClient.setQueryData<WorkflowRun[]>(workflowKeys.runsList(), (current) =>
          (current ?? []).filter((run) => run.id !== runId)
        );
        setSelection((current) => (current.runId === runId ? { runId: "", manual: false } : current));
        notify.message("추론 실행을 중단하고 대기열 항목을 삭제했습니다. 업로드된 문서는 보존됩니다.");
      } catch (error) {
        notify.error(errorMessage(error, "대기열 항목을 삭제하지 못했습니다."));
      }
    },
    [notify, queryClient]
  );

  const summaryError = summaryQuery.error
    ? errorMessage(summaryQuery.error, "워크플로우 실행 상태를 갱신하지 못했습니다.")
    : null;

  return {
    runs,
    activeRun,
    activeRunId,
    summaryError,
    focusRun,
    upsertRun,
    refreshRun,
    resumeRun,
    pauseRun,
    startWaitingRun,
    discardRun,
    deleteQueueEntry
  };
}
export type WorkflowRunsController = ReturnType<typeof useWorkflowRuns>;
