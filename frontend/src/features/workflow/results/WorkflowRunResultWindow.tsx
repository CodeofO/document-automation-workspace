// 워크플로우 실행 결과 화면(/workflow-runs/:runId). run을 TanStack Query로 폴링한다.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { useNavigate } from "react-router";
import { pollIntervalForStatus } from "../../../api/polling";
import { workflowPath } from "../../../app/routes";
import { deleteRunQueueEntry, fetchWorkflowRun, postRunAction, workflowKeys } from "../api";
import type { WorkflowRun } from "../types";
import { WorkflowRunResults } from "./WorkflowRunResults";

type ActionError = { message: string; at: number };

export function WorkflowRunResultWindow({ runId }: { runId: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const queryKey = workflowKeys.runDetail(runId);
  const runQuery = useQuery({
    queryKey,
    queryFn: ({ signal }) => fetchWorkflowRun(runId, signal),
    enabled: Boolean(runId),
    refetchInterval: (query) => pollIntervalForStatus(query.state.data?.status)
  });
  // 동작 실패 메시지는 다음 폴링이 성공하면 사라진다(예전 화면과 같은 동작).
  const [actionError, setActionError] = useState<ActionError | null>(null);
  const run = runQuery.data ?? null;

  const fail = useCallback((error: unknown, fallback: string) => {
    setActionError({ message: error instanceof Error ? error.message : fallback, at: Date.now() });
  }, []);

  const runAction = useCallback(
    async (action: "resume" | "pause" | "start" | "retry-failed" | "discard", fallback: string) => {
      try {
        const nextRun = await postRunAction(runId, action);
        queryClient.setQueryData<WorkflowRun>(workflowKeys.runDetail(runId), nextRun);
        setActionError(null);
        if (action !== "discard") void queryClient.invalidateQueries({ queryKey: workflowKeys.runDetail(runId) });
        void queryClient.invalidateQueries({ queryKey: workflowKeys.runsList() });
      } catch (error) {
        fail(error, fallback);
      }
    },
    [fail, queryClient, runId]
  );

  const closeWindow = useCallback(() => navigate(workflowPath()), [navigate]);

  const deleteQueueEntry = useCallback(async () => {
    try {
      await deleteRunQueueEntry(runId);
      setActionError(null);
      void queryClient.invalidateQueries({ queryKey: workflowKeys.runsList() });
      closeWindow();
    } catch (error) {
      fail(error, "대기열 항목을 삭제하지 못했습니다.");
    }
  }, [closeWindow, fail, queryClient, runId]);

  const queryError = runQuery.error
    ? runQuery.error instanceof Error
      ? runQuery.error.message
      : "워크플로우 실행 결과를 불러오지 못했습니다."
    : null;
  const visibleActionError = actionError && actionError.at >= runQuery.dataUpdatedAt ? actionError.message : null;
  const error = visibleActionError ?? queryError;

  return (
    <main className="workflow-result-window">
      {error && <div className="alert">{error}</div>}
      {run ? (
        <WorkflowRunResults
          run={run}
          onResume={() => void runAction("resume", "워크플로우를 계속 처리하지 못했습니다.")}
          onPause={() => void runAction("pause", "워크플로우를 일시중단하지 못했습니다.")}
          onStartWaiting={() => void runAction("start", "대기 중인 워크플로우 실행을 시작하지 못했습니다.")}
          onDeleteQueueEntry={() => void deleteQueueEntry()}
          onRetryFailed={() => void runAction("retry-failed", "실패한 항목을 재시도하지 못했습니다.")}
          onDiscard={() => void runAction("discard", "워크플로우 실행을 중단하지 못했습니다.")}
          onClose={closeWindow}
          onDocumentError={(message) => setActionError({ message, at: Date.now() })}
        />
      ) : (
        <section className="workflow-results">
          <div className="workflow-preview-empty">워크플로우 실행 결과를 불러오는 중입니다.</div>
        </section>
      )}
    </main>
  );
}
