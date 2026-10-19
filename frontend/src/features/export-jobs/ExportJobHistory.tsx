import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, History, Loader2, RefreshCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { toFriendlyError } from "../../api/client";
import { POLL_RUNNING_MS } from "../../api/polling";
import { Button, StatusBadge, useToast } from "../../components/ui";
import { formatBytes, formatDateTime } from "../../lib/format";
import {
  EXPORT_JOB_UPDATED_EVENT,
  exportJobKeys,
  isExportJobActive,
  listExportJobs,
  openExportJobDownload,
  retryAndDownloadExportJob,
  type ExportJob,
  type ExportJobFilters,
  type ExportJobOwnerType
} from "./api";

const EXPORT_OWNER_LABELS: Record<string, string> = {
  workflow_run: "워크플로우",
  batch: "핵심 정보 추출",
  classification_batch: "문서 분류",
  required_field_check_batch: "필수 항목 확인",
  table_extraction_batch: "표 추출"
};

const EXPORT_JOB_LABELS: Record<ExportJob["status"], string> = {
  queued: "대기",
  running: "생성 중",
  completed: "완료",
  failed: "실패"
};

/** export job 목록 쿼리. 생성 중인 job이 있으면 1.5초마다, 아니면 멈춘다. */
export function useExportJobs(filters: ExportJobFilters) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: exportJobKeys.list(filters),
    queryFn: () => listExportJobs(filters),
    refetchInterval: (current) => (current.state.data?.some(isExportJobActive) ? POLL_RUNNING_MS : false)
  });

  // 다른 화면에서 export를 만들면 같은 owner의 목록을 다시 읽는다.
  const { ownerType, ownerId } = filters;
  useEffect(() => {
    const onExportUpdated = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerType?: string; ownerId?: string }>).detail;
      if ((!ownerType || detail?.ownerType === ownerType) && (!ownerId || detail?.ownerId === ownerId)) {
        void queryClient.invalidateQueries({ queryKey: exportJobKeys.all });
      }
    };
    window.addEventListener(EXPORT_JOB_UPDATED_EVENT, onExportUpdated);
    return () => window.removeEventListener(EXPORT_JOB_UPDATED_EVENT, onExportUpdated);
  }, [ownerId, ownerType, queryClient]);

  return query;
}

export function ExportJobRow(props: { job: ExportJob; busy: boolean; onRetry: (job: ExportJob) => void; showOwner?: boolean }) {
  const { job } = props;
  return (
    <div className="export-history-row">
      <div className="export-history-row-main">
        <div>
          <strong>{job.filename || `${job.format.toUpperCase()} 생성 중`}</strong>
          <div className="export-history-meta">
            <StatusBadge status={job.status} label={EXPORT_JOB_LABELS[job.status] ?? job.status} />
            <span className="export-format-badge">{job.format.toUpperCase()}</span>
            {props.showOwner && <span>{EXPORT_OWNER_LABELS[job.owner_type] ?? job.owner_type}</span>}
            <span>{formatDateTime(job.completed_at || job.started_at || job.created_at)}</span>
            <span>{formatBytes(job.size_bytes)}</span>
          </div>
          {job.error_message && <small className="ui-error-text">{job.error_message}</small>}
        </div>
        <div className="export-history-actions">
          {job.status === "completed" && (
            <Button size="sm" icon={<Download size={14} />} onClick={() => openExportJobDownload(job.id)}>
              다운로드
            </Button>
          )}
          {job.status === "failed" && (
            <Button
              size="sm"
              icon={<RefreshCcw size={14} />}
              loading={props.busy}
              onClick={() => props.onRetry(job)}
            >
              재시도
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export function useExportJobRetry() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busyJobId, setBusyJobId] = useState<string | null>(null);
  const retry = async (job: ExportJob) => {
    setBusyJobId(job.id);
    try {
      await retryAndDownloadExportJob(job.id);
      await queryClient.invalidateQueries({ queryKey: exportJobKeys.all });
    } catch (exc) {
      toast.show(toFriendlyError(exc) || "Export 재시도에 실패했습니다.", { tone: "danger" });
    } finally {
      setBusyJobId(null);
    }
  };
  return { busyJobId, retry };
}

/** 한 owner(배치·run)의 최근 export 이력. */
export function ExportJobHistory(props: {
  ownerType: ExportJobOwnerType;
  ownerId: string;
  limit?: number;
  compact?: boolean;
}) {
  const limit = props.limit ?? 5;
  const query = useExportJobs({ ownerType: props.ownerType, ownerId: props.ownerId, limit });
  const { busyJobId, retry } = useExportJobRetry();
  const jobs = query.data ?? [];

  return (
    <div className={`export-history-panel ${props.compact ? "compact" : ""}`}>
      <div className="export-history-head">
        <strong>
          <History size={15} /> 최근 export
        </strong>
        <Button
          size="sm"
          icon={query.isFetching ? <Loader2 size={14} className="spin" /> : <RefreshCcw size={14} />}
          disabled={query.isFetching}
          onClick={() => void query.refetch()}
        >
          갱신
        </Button>
      </div>
      {query.error && (
        <small className="ui-error-text">{toFriendlyError(query.error) || "Export 이력을 불러오지 못했습니다."}</small>
      )}
      <div className="export-history-list">
        {jobs.length ? (
          jobs.map((job) => (
            <ExportJobRow key={job.id} job={job} busy={busyJobId === job.id} onRetry={(item) => void retry(item)} />
          ))
        ) : (
          <span className="export-history-empty">최근 export 없음</span>
        )}
      </div>
    </div>
  );
}
