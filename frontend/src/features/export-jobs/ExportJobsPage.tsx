import { FileDown, Loader2, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { toFriendlyError } from "../../api/client";
import { Button, Card, EmptyState, InlineAlert, ModulePage, PageHeader } from "../../components/ui";
import type { ExportJobOwnerType, ExportJobStatus } from "./api";
import { ExportJobRow, useExportJobRetry, useExportJobs } from "./ExportJobHistory";

const OWNER_OPTIONS: { value: "" | ExportJobOwnerType; label: string }[] = [
  { value: "", label: "전체" },
  { value: "workflow_run", label: "워크플로우" },
  { value: "batch", label: "핵심 정보 추출" },
  { value: "classification_batch", label: "문서 분류" },
  { value: "required_field_check_batch", label: "필수 항목 확인" },
  { value: "table_extraction_batch", label: "표 추출" }
];

/** 전체 export 이력 화면 (/exports). */
export function ExportJobsPage() {
  const [ownerType, setOwnerType] = useState<"" | ExportJobOwnerType>("");
  const [status, setStatus] = useState<"" | ExportJobStatus>("");
  const query = useExportJobs({ ownerType: ownerType || undefined, status: status || undefined, limit: 100 });
  const { busyJobId, retry } = useExportJobRetry();
  const jobs = query.data ?? [];

  return (
    <ModulePage
      module="exports"
      scroll
      header={
        <PageHeader
          eyebrow="Export"
          title="Export 이력"
          description="배치와 워크플로우 결과에서 만든 CSV, JSON, XLSX 파일을 다시 내려받습니다."
          actions={
            <>
              <select aria-label="대상" value={ownerType} onChange={(event) => setOwnerType(event.target.value as typeof ownerType)}>
                {OWNER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select aria-label="상태" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
                <option value="">전체 상태</option>
                <option value="queued">대기</option>
                <option value="running">생성 중</option>
                <option value="completed">완료</option>
                <option value="failed">실패</option>
              </select>
              <Button
                icon={query.isFetching ? <Loader2 size={16} className="spin" /> : <RefreshCcw size={16} />}
                disabled={query.isFetching}
                onClick={() => void query.refetch()}
              >
                갱신
              </Button>
            </>
          }
        />
      }
      alerts={query.error ? <InlineAlert tone="danger">{toFriendlyError(query.error)}</InlineAlert> : null}
    >
      <Card className="export-jobs-card" eyebrow="파일" title={`${jobs.length.toLocaleString()}개`} headingLevel={3}>
        {jobs.length ? (
          <div className="export-history-list">
            {jobs.map((job) => (
              <ExportJobRow key={job.id} job={job} showOwner busy={busyJobId === job.id} onRetry={(item) => void retry(item)} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<FileDown size={28} />} title="아직 export 기록이 없습니다.">
            배치나 워크플로우 결과 화면의 Export 메뉴로 파일을 만들 수 있습니다.
          </EmptyState>
        )}
      </Card>
    </ModulePage>
  );
}
