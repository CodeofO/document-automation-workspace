import { RotateCw } from "lucide-react";
import type { AuditEvent } from "../../../api/types";
import {
  Button,
  Dialog,
  EmptyState,
  FilterChips,
  PageLink,
  ProgressBar,
  ResultSummary,
  ResultTable,
  StatusBadge
} from "../../../components/ui";
import { formatConfidence, formatDate } from "../../../lib/format";
import type { KieReview } from "../hooks/useKieReview";
import {
  REVIEW_FILTER_CHIPS,
  aiReviewClassName,
  aiReviewLabel,
  aiReviewTitle,
  formatFieldWarning,
  matchesReviewFilter,
  reviewFilterLabel
} from "../model/review";
import { stringifyValue } from "../model/schema";
import type { FieldDefinition, SchemaField, SchemaRecommendation } from "../types";

/**
 * 검수 카드 본문(spec B-4): 요약 · 필터 칩 · 결과 표(필드 · 값 · 신뢰도 · 근거 · 페이지 · 검수).
 * 저장·Export 버튼은 카드 하단(셸)에 있다.
 */
export function ReviewPanel(props: {
  fields: FieldDefinition[];
  review: KieReview;
  onRetryExtraction: () => void;
  onGoToPage: (page: number) => void;
}) {
  const { review } = props;
  if (!review.result) {
    return <EmptyState compact title="아직 추출 결과가 없습니다.">문서를 열고 실행하면 필드별 값과 근거가 여기에 표시됩니다.</EmptyState>;
  }
  const result = review.result;
  const counts = Object.fromEntries(
    REVIEW_FILTER_CHIPS.map((filter) => [
      filter,
      props.fields.filter((field) =>
        matchesReviewFilter(filter, field.key_name, review.values[field.key_name], review.editedKeys, review.reviewedFields)
      ).length
    ])
  );
  const chips = REVIEW_FILTER_CHIPS.filter(
    (filter) => ["all", "needs_review", "changed", "warning"].includes(filter) || counts[filter] > 0
  ).map((filter) => ({ value: filter, label: reviewFilterLabel(filter), count: counts[filter] }));
  const visibleFields = props.fields.filter((field) =>
    matchesReviewFilter(review.filter, field.key_name, review.values[field.key_name], review.editedKeys, review.reviewedFields)
  );
  const reviewedCount = props.fields.filter((field) => review.reviewedFields.includes(field.key_name)).length;

  return (
    <div className="module-result-stack kie-review">
      <ResultSummary
        status={<StatusBadge status={result.validated_output.status} />}
        primary={`${reviewedCount} / ${props.fields.length}개 검수됨`}
        secondary={
          <Button size="sm" variant="ghost" icon={<RotateCw size={14} />} onClick={props.onRetryExtraction}>
            다시 추출
          </Button>
        }
      />
      <ProgressBar value={props.fields.length ? reviewedCount / props.fields.length : 0} label="검수 진행률" />
      <FilterChips label="결과 필터" value={review.filter} onChange={review.setFilter} options={chips} />
      <ResultTable
        label="추출 결과"
        rows={visibleFields}
        rowKey={(field) => field.key_name}
        rowTone={(field) => {
          const value = review.values[field.key_name];
          return matchesReviewFilter("needs_review", field.key_name, value, review.editedKeys, review.reviewedFields)
            ? "warning"
            : undefined;
        }}
        emptyText="조건에 맞는 필드가 없습니다."
        columns={[
          {
            key: "field",
            header: "필드",
            width: "18%",
            render: (field) => (
              <span className="ui-result-key mono">
                {field.key_name}
                {review.editedKeys.includes(field.key_name) && <small className="ui-edited-mark">수정됨</small>}
              </span>
            )
          },
          {
            key: "value",
            header: "값",
            width: "30%",
            render: (field) => {
              const value = review.values[field.key_name];
              const original = result.validated_output.values[field.key_name];
              return (
                <div className="ui-result-value">
                  <input
                    aria-label={`${field.key_name} 값`}
                    value={stringifyValue(value?.value)}
                    onChange={(event) => review.updateEdit(field.key_name, event.target.value, props.fields)}
                  />
                  {review.editedKeys.includes(field.key_name) && <small>원본: {stringifyValue(original?.value)}</small>}
                </div>
              );
            }
          },
          {
            key: "confidence",
            header: "신뢰도",
            width: "64px",
            render: (field) => formatConfidence(review.values[field.key_name]?.confidence)
          },
          {
            key: "evidence",
            header: "근거",
            render: (field) => {
              const value = review.values[field.key_name];
              return (
                <div className="ui-result-evidence">
                  <span>{value?.evidence || <span className="muted">–</span>}</span>
                  {value?.warnings?.length ? (
                    <small className="warn-text">{value.warnings.map(formatFieldWarning).join(", ")}</small>
                  ) : null}
                  {value?.ai_review?.enabled && (
                    <small className={aiReviewClassName(value)} title={aiReviewTitle(value)}>
                      AI 검수: {aiReviewLabel(value)}
                    </small>
                  )}
                </div>
              );
            }
          },
          {
            key: "page",
            header: "페이지",
            width: "56px",
            render: (field) => <PageLink page={review.values[field.key_name]?.page} onGoToPage={props.onGoToPage} />
          },
          {
            key: "reviewed",
            header: "검수",
            width: "48px",
            render: (field) => (
              <input
                type="checkbox"
                aria-label={`${field.key_name} 검수 완료`}
                checked={review.reviewedFields.includes(field.key_name)}
                onChange={() => review.toggleReviewed(field.key_name)}
              />
            )
          }
        ]}
      />
      <details className="ui-advanced">
        <summary>감사 로그 · 원본 모델 출력</summary>
        <AuditList events={review.auditEvents} />
        <pre className="ui-code-block">{JSON.stringify(result.raw_model_output, null, 2)}</pre>
      </details>
    </div>
  );
}

function AuditList({ events }: { events: AuditEvent[] }) {
  if (!events.length) return <p className="ui-field-note">로드된 감사 로그가 없습니다.</p>;
  return (
    <ul className="ui-history-list">
      {events.map((event) => (
        <li key={event.id} className="ui-history-row static">
          <span>
            <strong>{event.action}</strong>
            <small>
              {event.message || event.entity_type} · {formatDate(event.created_at)}
            </small>
          </span>
        </li>
      ))}
    </ul>
  );
}

export function RecommendationDiffDialog(props: {
  currentFields: SchemaField[];
  recommendation: SchemaRecommendation;
  onApply: () => void;
  onCancel: () => void;
}) {
  const currentKeys = new Set(props.currentFields.map((field) => field.key_name).filter(Boolean));
  const nextKeys = new Set(props.recommendation.fields.map((field) => field.key_name));
  const added = props.recommendation.fields.filter((field) => !currentKeys.has(field.key_name));
  const removed = props.currentFields.filter((field) => field.key_name && !nextKeys.has(field.key_name));
  const changed = props.recommendation.fields.filter((field) => {
    const current = props.currentFields.find((item) => item.key_name === field.key_name);
    return current && (current.description !== field.description || current.output_format !== field.output_format);
  });

  return (
    <Dialog
      open
      eyebrow="AI 추천"
      title="추천 schema를 적용할까요?"
      onClose={props.onCancel}
      footer={
        <>
          <Button size="sm" onClick={props.onCancel}>
            취소
          </Button>
          <Button size="sm" variant="primary" onClick={props.onApply}>
            추천 적용
          </Button>
        </>
      }
    >
      <p className="ui-dialog-message">{props.recommendation.reasoning || "AI가 현재 문서 기준의 schema 초안을 만들었습니다."}</p>
      <div className="diff-grid">
        <DiffList title="추가" items={added.map((field) => field.key_name)} />
        <DiffList title="변경" items={changed.map((field) => field.key_name)} />
        <DiffList title="제거" items={removed.map((field) => field.key_name)} />
      </div>
    </Dialog>
  );
}

function DiffList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="diff-list">
      <strong>{title}</strong>
      {items.length ? items.map((item) => <span key={item}>{item}</span>) : <span className="muted">없음</span>}
    </div>
  );
}
