// 결과 창 오른쪽: 선택한 문서(또는 페이지)의 결과.
// 레이아웃 규칙(docs/ux/module-unification-spec.md B-4):
// - 세로 스크롤은 이 패널 하나만 갖는다. 섹션·표는 자기 높이만큼 자라고, 표는 가로로만 스크롤한다.
// - 위쪽 요약은 촘촘한 key/value 격자, 회전 보정은 한 줄 요약 + 작은 썸네일 줄.
// - 결과 섹션은 접고 펴는 카드(헤더: 상태 배지 + 개수). 결과가 있으면 펼침, 없으면 한 줄.
// - 위쪽 고정 칩으로 섹션 사이를 이동한다.
// 부모가 선택 항목마다 key를 바꿔 접힘 상태를 초기화한다.
import { useCallback, useState } from "react";
import { documentPageImageUrl, documentPageThumbnailUrl } from "../../../api/client";
import { PageLink, ResultTable, StatusBadge } from "../../../components/ui";
import { formatConfidence } from "../../../lib/format";
import {
  rotationCacheBuster,
  rotationItemStatusLabel,
  rotationPageBadge,
  rotationPageNeedsReview
} from "../../rotation";
import {
  inspectorKieRows,
  inspectorRequiredRows,
  kieRowTone,
  kieSectionMeta,
  requiredRowTone,
  requiredSectionMeta,
  type InspectorKieRow,
  type InspectorRequiredRow
} from "../model/inspectorRows";
import { formatDurationMs } from "../model/runRules";
import {
  formatWorkflowValue,
  workflowItemLabel,
  workflowRotationNodeResults,
  workflowTableNodeResults
} from "../model/resultFilters";
import type { WorkflowItemResult, WorkflowRotationNodeResult, WorkflowRunItem } from "../types";
import { EvidenceText, InspectorSection } from "./InspectorSection";
import { WorkflowTableNodeResultView } from "./WorkflowTablePreview";

type SectionKey = "kie" | "required" | "table" | "classification" | "rotation";

const SECTION_ID_PREFIX = "wf-result-section-";

export function WorkflowItemInspector({ item }: { item: WorkflowRunItem | null }) {
  const [openState, setOpenState] = useState<Partial<Record<SectionKey, boolean>>>({});
  const toggle = useCallback((key: SectionKey, fallback: boolean) => {
    setOpenState((state) => ({ ...state, [key]: !(state[key] ?? fallback) }));
  }, []);

  if (!item) {
    return (
      <aside className="workflow-item-detail" aria-label="문서 결과">
        <p className="wf-result-muted">결과 문서를 선택하세요.</p>
      </aside>
    );
  }

  const result: WorkflowItemResult = item.result ?? {};
  const kieRows = inspectorKieRows(result);
  const requiredRows = inspectorRequiredRows(result);
  const rotationResults = workflowRotationNodeResults(result.node_results);
  const tableResults = workflowTableNodeResults(result.node_results);
  const classification = result.classification;
  const classificationOnly =
    result.branch_path &&
    !kieRows.length &&
    !requiredRows.length &&
    !tableResults.length &&
    item.status !== "running" &&
    item.status !== "queued";

  const sections: { key: SectionKey; title: string; hasResult: boolean; chip: string }[] = [
    { key: "kie", title: "KIE 결과", hasResult: kieRows.length > 0, chip: `KIE ${kieRows.length}` },
    { key: "required", title: "필수 항목", hasResult: requiredRows.length > 0, chip: `필수 ${requiredRows.length}` },
    { key: "table", title: "표 추출", hasResult: tableResults.length > 0, chip: "표" },
    { key: "classification", title: "분류", hasResult: Boolean(classification), chip: "분류" },
    { key: "rotation", title: "회전 보정", hasResult: rotationResults.length > 0, chip: "회전" }
  ];
  const isOpen = (key: SectionKey, hasResult: boolean) => openState[key] ?? hasResult;
  const jumpTo = (key: SectionKey) => {
    setOpenState((state) => ({ ...state, [key]: true }));
    requestAnimationFrame(() =>
      document.getElementById(`${SECTION_ID_PREFIX}${key}`)?.scrollIntoView({ block: "start" })
    );
  };
  const navSections = sections.filter((section) => section.hasResult);

  const renderSection = (key: SectionKey) => {
    const section = sections.find((entry) => entry.key === key)!;
    const common = {
      id: `${SECTION_ID_PREFIX}${key}`,
      title: section.title,
      open: isOpen(key, section.hasResult),
      onToggle: () => toggle(key, section.hasResult)
    };
    if (key === "kie") {
      if (!kieRows.length) return <InspectorSection key={key} {...common} emptyText="표시할 KIE 결과가 없습니다." />;
      const review = kieRows.some((row) => kieRowTone(row));
      return (
        <InspectorSection
          key={key}
          {...common}
          badge={<StatusBadge status={review ? "needs_review" : "completed"} />}
          meta={kieSectionMeta(kieRows)}
        >
          <KieTable rows={kieRows} />
        </InspectorSection>
      );
    }
    if (key === "required") {
      if (!requiredRows.length)
        return <InspectorSection key={key} {...common} emptyText="표시할 필수항목 결과가 없습니다." />;
      return (
        <InspectorSection
          key={key}
          {...common}
          badge={result.required_overall_status ? <StatusBadge status={result.required_overall_status} /> : undefined}
          meta={requiredSectionMeta(requiredRows)}
        >
          <RequiredTable rows={requiredRows} />
        </InspectorSection>
      );
    }
    if (key === "table") {
      if (!tableResults.length) return <InspectorSection key={key} {...common} emptyText="표 추출 결과가 없습니다." />;
      const tableCount = tableResults.reduce((sum, [, table]) => sum + (table.tables?.length ?? 0), 0);
      const reviewCells = tableResults.reduce(
        (sum, [, table]) => sum + (table.tables ?? []).reduce((acc, entry) => acc + entry.review_cells, 0),
        0
      );
      const violations = tableResults.reduce(
        (sum, [, table]) => sum + (table.tables ?? []).reduce((acc, entry) => acc + entry.violations, 0),
        0
      );
      const status = tableResults.some(([, table]) => table.status === "failed")
        ? "failed"
        : tableResults.some(([, table]) => table.status === "needs_review")
          ? "needs_review"
          : (tableResults[0][1].status ?? null);
      return (
        <InspectorSection
          key={key}
          {...common}
          badge={<StatusBadge status={status} />}
          meta={[
            `표 ${tableCount.toLocaleString()}개`,
            reviewCells ? `검토 칸 ${reviewCells.toLocaleString()}` : "",
            violations ? `위반 ${violations.toLocaleString()}` : ""
          ]
            .filter(Boolean)
            .join(" · ")}
        >
          {tableResults.map(([nodeId, table]) => (
            <WorkflowTableNodeResultView key={nodeId} nodeId={nodeId} table={table} />
          ))}
        </InspectorSection>
      );
    }
    if (key === "classification") {
      if (!classification) return <InspectorSection key={key} {...common} emptyText="분류 결과가 없습니다." />;
      return (
        <InspectorSection
          key={key}
          {...common}
          badge={<StatusBadge status={classification.status ?? null} />}
          meta={[classification.class_name, formatConfidenceOrEmpty(classification.confidence)]
            .filter(Boolean)
            .join(" · ")}
        >
          <dl className="wf-kv-list">
            <dt>클래스</dt>
            <dd>{classification.class_name || "-"}</dd>
            <dt>신뢰도</dt>
            <dd>{formatConfidence(classification.confidence)}</dd>
            <dt>Branch</dt>
            <dd>{result.branch_path || "-"}</dd>
            <dt>판단 근거</dt>
            <dd>
              <EvidenceText text={classification.reason ?? ""} />
            </dd>
            {classification.evidence?.length ? (
              <>
                <dt>단서</dt>
                <dd className="wf-chip-list">
                  {classification.evidence.map((word) => (
                    <span key={word}>{word}</span>
                  ))}
                </dd>
              </>
            ) : null}
          </dl>
        </InspectorSection>
      );
    }
    if (!rotationResults.length)
      return <InspectorSection key={key} {...common} emptyText="회전 보정 결과가 없습니다." />;
    const corrected = rotationResults.reduce((sum, [, rotation]) => sum + (rotation.corrected_page_count ?? 0), 0);
    const reviewPages = rotationResults.reduce(
      (sum, [, rotation]) => sum + (rotation.pages ?? []).filter(rotationPageNeedsReview).length,
      0
    );
    return (
      <InspectorSection
        key={key}
        {...common}
        badge={
          <StatusBadge
            status={rotationResults[0][1].status ?? null}
            label={rotationItemStatusLabel(rotationResults[0][1].status)}
          />
        }
        meta={[`${corrected.toLocaleString()}페이지 보정`, reviewPages ? `검토 ${reviewPages.toLocaleString()}` : ""]
          .filter(Boolean)
          .join(" · ")}
      >
        {rotationResults.map(([nodeId, rotation]) => (
          <RotationStrip key={nodeId} documentId={item.document_id} rotation={rotation} />
        ))}
      </InspectorSection>
    );
  };

  return (
    <aside className="workflow-item-detail" aria-label="문서 결과">
      <header className="wf-docres-head">
        <div className="wf-docres-title">
          <p className="eyebrow">Document</p>
          <h3 title={workflowItemLabel(item)}>{workflowItemLabel(item)}</h3>
          <StatusBadge status={item.status} subject="document" />
        </div>
        {navSections.length > 1 && (
          <nav className="wf-docres-nav" aria-label="결과 섹션 이동">
            {navSections.map((section) => (
              <button key={section.key} type="button" onClick={() => jumpTo(section.key)}>
                {section.chip}
              </button>
            ))}
          </nav>
        )}
      </header>
      <dl className="wf-docres-summary" aria-label="문서 요약">
        <div>
          <dt>분류</dt>
          <dd>{classification?.class_name || classification?.status || "-"}</dd>
        </div>
        <div>
          <dt>Branch</dt>
          <dd title={result.branch_path ?? undefined}>{result.branch_path || "-"}</dd>
        </div>
        <div>
          <dt>현재 모듈</dt>
          <dd>{item.status === "queued" ? "대기 중" : result.current_node_label || "-"}</dd>
        </div>
        <div>
          <dt>필수항목</dt>
          <dd>{result.required_overall_status ? <StatusBadge status={result.required_overall_status} /> : "-"}</dd>
        </div>
        <div>
          <dt>업로드</dt>
          <dd>{formatDurationMs(item.upload_duration_ms)}</dd>
        </div>
        <div>
          <dt>추론</dt>
          <dd>{formatDurationMs(item.inference_duration_ms)}</dd>
        </div>
      </dl>
      {classificationOnly && <p className="wf-docres-note">이 문서는 후속 route가 없어 분류 결과만 export됩니다.</p>}
      {item.status === "running" && (
        <p className="wf-docres-note" data-tone="info">
          모듈 처리 결과를 기다리는 중입니다.
        </p>
      )}
      {item.error_message && <div className="module-error">{item.error_message}</div>}
      {sections.map((section) => renderSection(section.key))}
    </aside>
  );
}

function formatConfidenceOrEmpty(value: number | null | undefined) {
  const text = formatConfidence(value);
  return text === "-" ? "" : text;
}

function KieTable({ rows }: { rows: InspectorKieRow[] }) {
  return (
    <ResultTable
      label="KIE 결과"
      className="wf-docres-result-table"
      rows={rows}
      rowKey={(row) => row.key}
      rowTone={kieRowTone}
      columns={[
        {
          key: "field",
          header: "필드",
          width: "26%",
          render: (row) => <span className="ui-result-key">{row.key}</span>
        },
        {
          key: "value",
          header: "값",
          width: "28%",
          render: (row) => <span className="ui-result-value">{formatWorkflowValue(row.value)}</span>
        },
        {
          key: "confidence",
          header: "신뢰도",
          width: "62px",
          render: (row) => <span className="wf-confidence">{formatConfidence(row.confidence)}</span>
        },
        {
          key: "evidence",
          header: "근거",
          render: (row) => (
            <div className="ui-result-evidence">
              <EvidenceText text={row.evidence} />
              {row.warnings.length ? <small className="warn-text">{row.warnings.join(", ")}</small> : null}
            </div>
          )
        }
      ]}
    />
  );
}

function RequiredTable({ rows }: { rows: InspectorRequiredRow[] }) {
  return (
    <ResultTable
      label="필수 항목 결과"
      className="wf-docres-result-table"
      rows={rows}
      rowKey={(row, index) => `${row.key}_${index}`}
      rowTone={requiredRowTone}
      columns={[
        {
          key: "item",
          header: "항목",
          width: "28%",
          render: (row) => (
            <span className="ui-result-key">
              {row.key}
              {row.required && <small>필수</small>}
            </span>
          )
        },
        {
          key: "status",
          header: "상태",
          width: "84px",
          render: (row) => <StatusBadge status={row.status} subject="field" />
        },
        {
          key: "confidence",
          header: "신뢰도",
          width: "62px",
          render: (row) => <span className="wf-confidence">{formatConfidence(row.confidence)}</span>
        },
        { key: "evidence", header: "근거", render: (row) => <EvidenceText text={row.evidence} /> },
        { key: "page", header: "쪽", width: "44px", render: (row) => <PageLink page={row.page} /> }
      ]}
    />
  );
}

/** 회전 보정: 한 줄 요약 + 작은 썸네일 줄(누르면 원본). 검토가 필요한 페이지는 노란 테두리. */
function RotationStrip({ documentId, rotation }: { documentId: string; rotation: WorkflowRotationNodeResult }) {
  const pages = [...(rotation.pages ?? [])].sort((a, b) => a.page_number - b.page_number);
  return (
    <div className="wf-rotation-strip-block">
      {rotation.error_message && <div className="module-error">{rotation.error_message}</div>}
      {pages.length > 0 && (
        <ul className="wf-rotation-strip" aria-label="회전 보정 페이지">
          {pages.map((page) => {
            const badge = rotationPageBadge(page);
            const cacheBuster = rotationCacheBuster(page);
            return (
              <li
                key={page.page_number}
                data-tone={badge.statusTone}
                title={`${badge.detail} · 신뢰도 ${formatConfidence(page.confidence)}`}
              >
                <a
                  href={documentPageImageUrl(documentId, page.page_number, cacheBuster)}
                  target="_blank"
                  rel="noreferrer"
                >
                  <img
                    src={documentPageThumbnailUrl(documentId, page.page_number, 96, cacheBuster)}
                    alt={`${page.page_number}페이지`}
                    loading="lazy"
                  />
                </a>
                <span>
                  {page.page_number}p · {badge.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
