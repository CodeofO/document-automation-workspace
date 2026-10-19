// 분류 결과 카드: 요약(상태·클래스·신뢰도) + 결과 표(클래스 수정·근거·페이지).
import { EmptyState, InlineAlert, PageLink, ResultSummary, ResultTable, StatusBadge } from "../../components/ui";
import { formatConfidence } from "../../lib/format";
import type { ResultPanelProps } from "../module-batch";
import type { ClassificationOutput, ClassifierDraft } from "./types";

export function ClassificationResultPanel({
  job,
  draft,
  output,
  onChange,
  onGoToPage
}: ResultPanelProps<ClassifierDraft, ClassificationOutput>) {
  if (!job) return <EmptyState compact title="아직 결과가 없습니다.">문서를 고르고 실행하면 분류 결과가 여기에 표시됩니다.</EmptyState>;
  if (job.error_message) return <InlineAlert tone="danger">{job.error_message}</InlineAlert>;
  if (!output) {
    return (
      <EmptyState compact title={<StatusBadge status={job.status} />}>
        처리가 끝나면 결과가 표시됩니다.
      </EmptyState>
    );
  }
  const classNames = draft.classes.map((item) => item.class_name).filter((name) => name.trim());
  if (output.class_name && !classNames.includes(output.class_name)) classNames.unshift(output.class_name);
  const page = output.page_number ?? job.page_number ?? null;
  return (
    <div className="module-result-stack">
      <ResultSummary
        status={<StatusBadge status={output.status} />}
        primary={output.class_name ?? "미분류"}
        secondary={`신뢰도 ${formatConfidence(output.confidence)}`}
      />
      <ResultTable
        label="분류 결과"
        rows={[output]}
        rowKey={() => "classification"}
        columns={[
          {
            key: "class",
            header: "문서 클래스",
            width: "30%",
            render: (row) => (
              <select
                aria-label="문서 클래스 수정"
                value={row.class_name ?? ""}
                onChange={(event) =>
                  onChange({ ...row, status: event.target.value ? "classified" : "unknown", class_name: event.target.value || null })
                }
              >
                <option value="">미분류</option>
                {classNames.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            )
          },
          { key: "confidence", header: "신뢰도", width: "70px", render: (row) => formatConfidence(row.confidence) },
          {
            key: "reason",
            header: "근거",
            render: (row) => (
              <div className="ui-result-evidence">
                <span>{row.reason}</span>
                {row.evidence.length > 0 && <small>{row.evidence.join(", ")}</small>}
              </div>
            )
          },
          { key: "page", header: "페이지", width: "64px", render: () => <PageLink page={page} onGoToPage={onGoToPage} /> }
        ]}
      />
    </div>
  );
}
