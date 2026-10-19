// 필수 항목 확인 결과 카드: 전체 상태 + 항목 표(상태 수정 · 신뢰도 · 근거 · 페이지 링크) + 필터.
import { useState } from "react";
import {
  EmptyState,
  FilterChips,
  InlineAlert,
  PageLink,
  ResultSummary,
  ResultTable,
  StatusBadge
} from "../../components/ui";
import { formatConfidence } from "../../lib/format";
import type { ResultPanelProps } from "../module-batch";
import { withItemStatus } from "./model";
import type { RequiredFieldChecklist, RequiredFieldItemStatus, RequiredFieldOutput, RequiredFieldOutputItem } from "./types";

const ITEM_STATUS_OPTIONS: { value: RequiredFieldItemStatus; label: string }[] = [
  { value: "present", label: "있음" },
  { value: "missing", label: "누락" },
  { value: "uncertain", label: "확인 필요" },
  { value: "not_applicable", label: "해당 없음" }
];

type ItemFilter = "all" | "review" | "missing";

function needsReview(item: RequiredFieldOutputItem) {
  return item.status === "uncertain";
}

export function RequiredFieldResultPanel({
  job,
  output,
  onChange,
  onGoToPage
}: ResultPanelProps<RequiredFieldChecklist, RequiredFieldOutput>) {
  const [filter, setFilter] = useState<ItemFilter>("all");
  if (!job) return <EmptyState compact title="아직 결과가 없습니다.">문서를 고르고 실행하면 항목별 확인 결과가 여기에 표시됩니다.</EmptyState>;
  if (job.error_message) return <InlineAlert tone="danger">{job.error_message}</InlineAlert>;
  if (!output) {
    return (
      <EmptyState compact title={<StatusBadge status={job.status} />}>
        처리가 끝나면 결과가 표시됩니다.
      </EmptyState>
    );
  }
  const indexed = output.items.map((item, index) => ({ item, index }));
  const reviewCount = output.items.filter(needsReview).length;
  const missingCount = output.items.filter((item) => item.status === "missing").length;
  const rows = indexed.filter(({ item }) =>
    filter === "review" ? needsReview(item) : filter === "missing" ? item.status === "missing" : true
  );
  const presentCount = output.items.filter((item) => item.status === "present").length;
  return (
    <div className="module-result-stack">
      <ResultSummary
        status={<StatusBadge status={output.overall_status} />}
        primary={`${presentCount.toLocaleString()} / ${output.items.length.toLocaleString()} 있음`}
        secondary={missingCount ? `누락 ${missingCount}` : undefined}
      />
      <FilterChips
        label="결과 필터"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "all", label: "전체", count: output.items.length },
          { value: "review", label: "검토 필요", count: reviewCount },
          { value: "missing", label: "누락", count: missingCount }
        ]}
      />
      <ResultTable
        label="필수 항목 결과"
        rows={rows}
        rowKey={({ item, index }) => `${item.item_name}_${index}`}
        rowTone={({ item }) => (needsReview(item) ? "warning" : item.status === "missing" && item.required ? "danger" : undefined)}
        columns={[
          {
            key: "item",
            header: "항목",
            width: "24%",
            render: ({ item }) => (
              <span className="ui-result-key">
                {item.item_name}
                {item.required && <small>필수</small>}
              </span>
            )
          },
          {
            key: "status",
            header: "상태",
            width: "110px",
            render: ({ item, index }) => (
              <select
                aria-label={`${item.item_name} 상태`}
                data-tone-status={item.status}
                value={item.status}
                onChange={(event) => onChange(withItemStatus(output, index, event.target.value as RequiredFieldItemStatus))}
              >
                {ITEM_STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            )
          },
          { key: "confidence", header: "신뢰도", width: "64px", render: ({ item }) => formatConfidence(item.confidence) },
          { key: "evidence", header: "근거", render: ({ item }) => item.evidence ?? <span className="muted">–</span> },
          {
            key: "page",
            header: "페이지",
            width: "60px",
            render: ({ item }) => <PageLink page={item.page ?? output.page_number ?? job.page_number} onGoToPage={onGoToPage} />
          }
        ]}
        emptyText="조건에 맞는 항목이 없습니다."
      />
    </div>
  );
}
