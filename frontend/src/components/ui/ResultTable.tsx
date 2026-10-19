import type { ReactNode } from "react";

export type ResultColumn<T> = {
  key: string;
  header: ReactNode;
  width?: string;
  render: (row: T, index: number) => ReactNode;
};

/**
 * 결과 검수 표(spec B-4): 항목 · 값/상태(편집) · 신뢰도 · 근거 · 페이지(링크) · 검수.
 * KIE·분류·필수항목이 같은 표를 쓴다.
 */
export function ResultTable<T>(props: {
  label: string;
  columns: ResultColumn<T>[];
  rows: T[];
  rowKey: (row: T, index: number) => string;
  rowTone?: (row: T) => string | undefined;
  emptyText?: ReactNode;
  className?: string;
}) {
  return (
    <div className={["ui-result-table-wrap", props.className ?? ""].filter(Boolean).join(" ")}>
      <table className="ui-result-table" aria-label={props.label}>
        <colgroup>
          {props.columns.map((column) => (
            <col key={column.key} style={column.width ? { width: column.width } : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {props.columns.map((column) => (
              <th key={column.key} scope="col">
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {props.rows.length ? (
            props.rows.map((row, index) => (
              <tr key={props.rowKey(row, index)} data-tone={props.rowTone?.(row)}>
                {props.columns.map((column) => (
                  <td key={column.key}>{column.render(row, index)}</td>
                ))}
              </tr>
            ))
          ) : (
            <tr>
              <td className="ui-result-empty" colSpan={props.columns.length}>
                {props.emptyText ?? "표시할 항목이 없습니다."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 결과 표의 페이지 열: 누르면 뷰어가 그 페이지로 간다. */
export function PageLink(props: { page: number | null | undefined; onGoToPage?: (page: number) => void }) {
  if (!props.page) return <span className="muted">–</span>;
  const page = props.page;
  if (!props.onGoToPage) return <span>p.{page}</span>;
  return (
    <button type="button" className="ui-page-link" title={`${page}페이지 보기`} onClick={() => props.onGoToPage?.(page)}>
      p.{page}
    </button>
  );
}

/** 결과 카드 상단 요약: 상태 · 주 값 · 신뢰도/부가 정보. */
export function ResultSummary(props: { status: ReactNode; primary?: ReactNode; secondary?: ReactNode; source?: ReactNode }) {
  return (
    <div className="ui-result-summary">
      <div className="ui-result-summary-main">
        {props.status}
        {props.primary !== undefined && <strong>{props.primary}</strong>}
        {props.secondary !== undefined && <span>{props.secondary}</span>}
      </div>
      {props.source && <small>{props.source}</small>}
    </div>
  );
}
