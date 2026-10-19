import { CheckSquare, Play, Square } from "lucide-react";
import type { ReactNode } from "react";
import { isActiveStatus, type StatusTone } from "../../lib/status";
import { Button } from "./Button";
import { ExportMenu, type ExportMenuOption } from "./ExportMenu";
import { ProgressBar } from "./ProgressBar";
import { StatCounterRow } from "./StatCounter";
import { StatusBadge } from "./StatusBadge";

export type JobCounters = {
  total: number;
  completed: number;
  needsReview: number;
  failed: number;
  /** 모듈별 추가 카운터(예: 보정된 페이지). 고정 4개 뒤에 붙는다. */
  extra?: { label: string; value: number; tone?: StatusTone }[];
};

/** 카운터 순서는 전체 · 완료 · 검토 필요 · 실패 · (모듈별 추가)로 고정한다(spec B-3). 0이면 색을 뺀다. */
export function jobCounterItems(counters: JobCounters) {
  const toned = (value: number, tone: StatusTone): StatusTone | undefined => (value ? tone : undefined);
  return [
    { label: "전체", value: counters.total },
    { label: "완료", value: counters.completed, tone: toned(counters.completed, "success") },
    { label: "검토 필요", value: counters.needsReview, tone: toned(counters.needsReview, "warning") },
    { label: "실패", value: counters.failed, tone: toned(counters.failed, "danger") },
    ...(counters.extra ?? [])
  ];
}

/**
 * 배치·run 진행 상태 바(spec B-3). 한 화면에 하나만 둔다.
 * 버튼 순서: [다음 검토 n][Export ▾][계속 처리 ▶][중단 ■]
 */
export function JobStatusBar(props: {
  status: string | null | undefined;
  /** 0~1 */
  progress: number;
  processed: number;
  total: number;
  counters: JobCounters;
  eyebrow?: ReactNode;
  title?: ReactNode;
  onNextReview?: () => void;
  exportOptions?: ExportMenuOption[];
  exportFooter?: ReactNode;
  /** 주면 Export 메뉴를 끄고 이 문구를 툴팁으로 보인다(예: "준비 중"). */
  exportDisabledReason?: string;
  onResume?: () => void;
  onStop?: () => void;
  stopDisabled?: boolean;
  /** 진행 상황을 주기적으로 다시 읽는 중이면 true("자동 갱신 중" 표시) */
  polling?: boolean;
  className?: string;
}) {
  const polling = props.polling ?? isActiveStatus(props.status);
  return (
    <section className={["ui-job-status-bar", props.className ?? ""].filter(Boolean).join(" ")} aria-label="작업 진행 상태">
      <div className="ui-job-status-main">
        <div className="ui-job-status-title">
          {props.eyebrow && <span className="eyebrow">{props.eyebrow}</span>}
          <StatusBadge status={props.status} />
          {props.title && <strong>{props.title}</strong>}
        </div>
        <ProgressBar value={props.progress} label="진행률" showLabel />
        <span className="ui-job-status-processed">
          처리 {props.processed.toLocaleString()} / {props.total.toLocaleString()}
        </span>
        {polling && (
          <span className="ui-job-status-live" role="status">
            <span className="ui-live-dot" aria-hidden />
            자동 갱신 중
          </span>
        )}
      </div>
      <div className="ui-job-status-row">
        <StatCounterRow items={jobCounterItems(props.counters)} label="처리 결과 요약" />
        <div className="ui-job-status-actions">
          {props.onNextReview && (
            <Button size="sm" icon={<CheckSquare size={14} />} disabled={!props.counters.needsReview} onClick={props.onNextReview}>
              다음 검토{props.counters.needsReview ? ` ${props.counters.needsReview.toLocaleString()}` : ""}
            </Button>
          )}
          {props.exportOptions && (
            <ExportMenu
              compact
              fixed
              align="right"
              options={props.exportOptions}
              footer={props.exportFooter}
              disabled={Boolean(props.exportDisabledReason)}
              title={props.exportDisabledReason}
            />
          )}
          {props.onResume && (
            <Button size="sm" icon={<Play size={14} />} onClick={props.onResume}>
              계속 처리
            </Button>
          )}
          {props.onStop && (
            <Button
              size="sm"
              variant="danger-outline"
              icon={<Square size={13} />}
              disabled={props.stopDisabled}
              onClick={props.onStop}
            >
              중단
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
