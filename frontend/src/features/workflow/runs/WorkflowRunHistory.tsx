import { History, Maximize2, Pause, Play, X } from "lucide-react";
import { ExportMenu } from "../../../components/ui";
import { jobExportOptions } from "../../export-jobs";
import {
  formatWorkflowRunDate,
  workflowRunCanDeleteQueueEntry,
  workflowRunCanPause,
  workflowRunCanResume,
  workflowRunCanStartWaiting,
  workflowRunCompletedAtLabel,
  workflowRunDeleteQueueEntryLabel,
  workflowRunFailureSummary,
  workflowRunFinishedCount,
  workflowRunHeadline,
  workflowRunPercent,
  workflowRunQueueMeta,
  workflowRunStartedAtLabel,
  workflowRunStatusClass,
  workflowRunStatusLabel
} from "../model/runRules";
import type { WorkflowRun } from "../types";

type RunHistoryActions = {
  onSelect: (runId: string) => void;
  onOpen: (runId: string) => void;
  onResume: (runId: string) => void;
  onPause: (runId: string) => void;
  onStartWaiting: (runId: string) => void;
  onDeleteQueueEntry: (runId: string) => void;
};

/** 빌더 오른쪽 사이드바의 실행 목록. */
export function WorkflowRunHistory(props: RunHistoryActions & { runs: WorkflowRun[]; activeRunId: string }) {
  return (
    <section className="workflow-run-history" aria-label="워크플로우 실행 현황">
      <div className="workflow-run-history-head">
        <div>
          <p className="eyebrow">현황</p>
          <h3>실행 현황</h3>
        </div>
      </div>
      {props.runs.length ? (
        <div className="workflow-run-history-list">
          {props.runs.map((run) => (
            <WorkflowRunHistoryItem
              key={run.id}
              run={run}
              runs={props.runs}
              isActive={run.id === props.activeRunId}
              actions={props}
            />
          ))}
        </div>
      ) : (
        <div className="workflow-run-history-empty">
          <History size={18} />
          <span>아직 실행 작업이 없습니다.</span>
        </div>
      )}
    </section>
  );
}

function WorkflowRunHistoryItem(props: {
  run: WorkflowRun;
  runs: WorkflowRun[];
  isActive: boolean;
  actions: RunHistoryActions;
}) {
  const { run, actions } = props;
  const finishedCount = workflowRunFinishedCount(run);
  const percent = workflowRunPercent(run);
  const failureSummary = workflowRunFailureSummary(run);
  return (
    <article
      className={`workflow-run-history-item ${workflowRunStatusClass(run)} ${props.isActive ? "active" : ""}`}
      role="button"
      aria-current={props.isActive ? "true" : undefined}
      tabIndex={0}
      onClick={() => actions.onSelect(run.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          actions.onSelect(run.id);
        }
      }}
    >
      <div className="workflow-run-history-main">
        <span className="workflow-run-history-status">{workflowRunStatusLabel(run)}</span>
        <strong>
          {run.workflow_name || "워크플로우"} · {workflowRunHeadline(run)}
        </strong>
        <small>
          등록 {formatWorkflowRunDate(run.created_at)} · 시작 {workflowRunStartedAtLabel(run)} · 종료{" "}
          {workflowRunCompletedAtLabel(run)}
        </small>
        <small>
          {finishedCount.toLocaleString()} / {run.total_count.toLocaleString()} 처리
          {run.restarted_from_run_id ? " · 새 실행" : ""}
          {workflowRunQueueMeta(run)}
          {run.queue_order ? ` · 예약 순서 #${run.queue_order}` : ""}
          {run.failed_count ? ` · ${run.failed_count.toLocaleString()} 실패` : ""}
          {run.needs_review_count ? ` · ${run.needs_review_count.toLocaleString()} 검토` : ""}
        </small>
        {failureSummary && <small className="workflow-run-history-error">실패 사유 · {failureSummary}</small>}
        <div className="workflow-run-history-progress" aria-label={`${percent}%`}>
          <div>
            <span style={{ width: `${percent}%` }} />
          </div>
          <em>{percent}%</em>
        </div>
      </div>
      <div
        className="workflow-run-history-actions"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {workflowRunCanResume(run) && (
          <button type="button" className="secondary" onClick={() => actions.onResume(run.id)}>
            <Play size={14} /> 이어하기
          </button>
        )}
        {workflowRunCanPause(run) && (
          <button type="button" className="secondary" onClick={() => actions.onPause(run.id)}>
            <Pause size={14} /> 추론 일시중단
          </button>
        )}
        {workflowRunCanStartWaiting(run, props.runs) && (
          <button type="button" className="secondary" onClick={() => actions.onStartWaiting(run.id)}>
            <Play size={14} /> 바로 실행
          </button>
        )}
        {workflowRunCanDeleteQueueEntry(run) && (
          <button type="button" className="secondary danger-outline" onClick={() => actions.onDeleteQueueEntry(run.id)}>
            <X size={14} /> {workflowRunDeleteQueueEntryLabel(run)}
          </button>
        )}
        <button type="button" className="secondary" onClick={() => actions.onOpen(run.id)}>
          <Maximize2 size={14} /> 결과 보기
        </button>
        <ExportMenu options={jobExportOptions("workflow_run", run.id)} compact fixed align="right" />
      </div>
    </article>
  );
}
