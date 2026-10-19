import { CheckSquare, Pause, Play, RefreshCcw, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button, ExportMenu, IconButton, StatusBadge } from "../../../components/ui";
import type { StatusTone } from "../../../lib/status";
import { ExportJobHistory, jobExportOptions } from "../../export-jobs";
import {
  formatDurationMs,
  workflowRunCanDeleteQueueEntry,
  workflowRunCanDiscard,
  workflowRunCanPause,
  workflowRunCanResume,
  workflowRunCanRetryFailed,
  workflowRunCanStartWaiting,
  workflowRunDeleteQueueEntryLabel,
  workflowRunFinishedCount,
  workflowRunHeadline,
  workflowRunIsLive,
  workflowRunPercent,
  workflowRunPreprocessingCount,
  workflowRunQueuedCount,
  workflowRunRunningCount,
  workflowRunTimeRange
} from "../model/runRules";
import type { WorkflowRun } from "../types";
import type { WorkflowRunResultActions } from "./WorkflowRunResults";

type Part = { label: string; value: ReactNode; tone?: StatusTone };

/** 묶음 알약 하나: "3/3 처리 · 검토 3 · 실패 0"처럼 여러 값을 한 칸에 담는다. */
function StatPill(props: { parts: Part[]; title?: string; live?: boolean }) {
  return (
    <span className="wf-run-pill" title={props.title} data-live={props.live ? "true" : undefined}>
      {props.live && <span className="ui-live-dot" aria-hidden />}
      {props.parts.map((part, index) => (
        <span key={part.label} className="wf-run-pill-part" data-tone={part.tone}>
          {index > 0 && <span className="wf-run-pill-sep" aria-hidden>·</span>}
          {part.label === "처리" ? (
            <>
              <strong>{part.value}</strong> {part.label}
            </>
          ) : (
            <>
              {part.label} <strong>{part.value}</strong>
            </>
          )}
        </span>
      ))}
    </span>
  );
}

/**
 * 결과 창 헤더(한 줄). 왼쪽: 이름 · 상태 · 진행률 / 가운데: 묶음 카운터 / 오른쪽: [다음 검토 n][Export ▾][동작…][×].
 * 최근 export 이력은 Export 메뉴 아래쪽(footer)에 둔다(spec B-4).
 */
export function WorkflowRunHeader(
  props: WorkflowRunResultActions & { run: WorkflowRun; reviewCount: number; onNextReview: () => void }
) {
  const { run, reviewCount } = props;
  const live = workflowRunIsLive(run);
  const percent = workflowRunPercent(run);
  const total = run.total_count;
  const toned = (value: number, tone: StatusTone) => (value ? tone : undefined);

  const resultParts: Part[] = [
    { label: "처리", value: `${workflowRunFinishedCount(run).toLocaleString()}/${total.toLocaleString()}` },
    ...(run.completed_count ? [{ label: "완료", value: run.completed_count.toLocaleString(), tone: "success" as const }] : []),
    { label: "검토", value: run.needs_review_count.toLocaleString(), tone: toned(run.needs_review_count, "warning") },
    { label: "실패", value: run.failed_count.toLocaleString(), tone: toned(run.failed_count, "danger") }
  ];

  // 진행 중일 때만: 전처리·처리 중·대기(0은 숨기되 처리 중은 항상) + AI 요청(·AI 대기)을 한 알약에.
  const preprocessing = workflowRunPreprocessingCount(run);
  const running = workflowRunRunningCount(run);
  const queued = workflowRunQueuedCount(run);
  const liveParts: Part[] = [
    ...(preprocessing ? [{ label: "전처리", value: preprocessing.toLocaleString() }] : []),
    { label: "처리 중", value: running.toLocaleString(), tone: toned(running, "info") },
    ...(queued ? [{ label: "대기", value: queued.toLocaleString() }] : [])
  ];
  const vlmActive = run.vlm_active_count ?? 0;
  const vlmWaiting = run.vlm_waiting_count ?? 0;
  liveParts.push({ label: "AI 요청", value: `${vlmActive.toLocaleString()}${run.vlm_limit ? `/${run.vlm_limit}` : ""}` });
  if (vlmWaiting) liveParts.push({ label: "AI 대기", value: vlmWaiting.toLocaleString() });

  const durationParts: Part[] = [
    ...(run.upload_duration_ms != null ? [{ label: "업로드", value: formatDurationMs(run.upload_duration_ms) }] : []),
    ...(run.inference_duration_ms != null ? [{ label: "추론", value: formatDurationMs(run.inference_duration_ms) }] : [])
  ];
  const timeRange = workflowRunTimeRange(run);
  // 진행 중에는 소요 시간이 아직 확정 전이라 알약 대신 시간 범위 툴팁에만 둔다.
  const timeTitle = [timeRange.title, ...durationParts.map((part) => `${part.label} ${part.value}`)].join(" · ");
  const name = run.workflow_name || "워크플로우";

  return (
    <section className="wf-run-header" aria-label="실행 요약">
      <div className="wf-run-header-title">
        <span className="eyebrow">Run</span>
        <h2 title={name}>{name}</h2>
        <StatusBadge status={run.status} label={workflowRunHeadline(run)} />
        <span className="wf-run-header-percent" aria-label={`진행률 ${percent}%`}>
          {percent}%
        </span>
      </div>
      <div className="wf-run-header-stats" aria-label="처리 결과 요약">
        <StatPill parts={resultParts} />
        {live && <StatPill parts={liveParts} live title="자동 갱신 중 · AI 요청 중/동시 한도" />}
        {!live && durationParts.length > 0 && <StatPill parts={durationParts} />}
        <span className="wf-run-pill" title={timeTitle}>
          {timeRange.label}
        </span>
      </div>
      <div className="wf-run-header-actions">
        <Button size="sm" icon={<CheckSquare size={14} />} disabled={!reviewCount} onClick={props.onNextReview}>
          다음 검토{reviewCount ? ` ${reviewCount.toLocaleString()}` : ""}
        </Button>
        <ExportMenu
          compact
          fixed
          align="right"
          title="결과 내보내기 · 최근 export"
          options={jobExportOptions("workflow_run", run.id)}
          footer={<ExportJobHistory ownerType="workflow_run" ownerId={run.id} compact limit={3} />}
        />
        {props.onResume && workflowRunCanResume(run) && (
          <Button size="sm" icon={<Play size={14} />} onClick={props.onResume}>
            이어하기
          </Button>
        )}
        {props.onPause && workflowRunCanPause(run) && (
          <Button size="sm" icon={<Pause size={14} />} onClick={props.onPause}>
            추론 일시중단
          </Button>
        )}
        {props.onStartWaiting && workflowRunCanStartWaiting(run) && (
          <Button size="sm" icon={<Play size={14} />} onClick={props.onStartWaiting}>
            바로 실행
          </Button>
        )}
        {props.onDeleteQueueEntry && workflowRunCanDeleteQueueEntry(run) && (
          <Button size="sm" variant="danger-outline" icon={<X size={14} />} onClick={props.onDeleteQueueEntry}>
            {workflowRunDeleteQueueEntryLabel(run)}
          </Button>
        )}
        {props.onRetryFailed && workflowRunCanRetryFailed(run) && (
          <Button size="sm" icon={<RefreshCcw size={14} />} onClick={props.onRetryFailed}>
            실패 재시도
          </Button>
        )}
        {props.onDiscard && workflowRunCanDiscard(run) && (
          <Button size="sm" variant="danger-outline" icon={<X size={14} />} onClick={props.onDiscard}>
            추론 중단
          </Button>
        )}
        <IconButton label="닫기" size="sm" variant="ghost" className="wf-run-header-close" onClick={props.onClose}>
          <X size={16} />
        </IconButton>
      </div>
    </section>
  );
}
