// 결과의 표 탭(양식 안 표 스키마마다 하나) + 선택한 표의 요약·경고·결과 격자.
import type { CSSProperties } from "react";
import { CountBadge, InlineAlert } from "../../../components/ui";
import { regionColorVar } from "../model/regions";
import { displayRows, tableStats, type PendingEdits } from "../model/results";
import type { TableResult } from "../types";
import { TableResultGrid } from "./TableResultGrid";

function expectedText(table: TableResult) {
  const { mode, value } = table.expected_rows;
  if (mode === "exact" && value) return ` / 정확히 ${value}행`;
  if (mode === "max" && value) return ` / 최대 ${value}행`;
  return "";
}

export function TableResultTabs(props: {
  tables: TableResult[];
  /** 표 key → 양식 안 순서(색 배정) */
  orderOf: (tableKey: string) => number;
  activeKey: string | null;
  onActiveKey: (tableKey: string) => void;
  pending: PendingEdits | null;
  selectedRowId: string | null;
  onSelectRow: (rowId: string | null) => void;
  editable: boolean;
  onEditCell?: (tableKey: string, rowId: string, column: string, value: string, original: string) => void;
  onAddRow?: (tableKey: string, afterRowId: string | null) => void;
  onToggleDelete?: (tableKey: string, rowId: string) => void;
}) {
  const active = props.tables.find((table) => table.table_key === props.activeKey) ?? props.tables[0];
  if (!active) return null;
  const stats = tableStats(active);
  const failedChecks = active.table_checks.filter((check) => check.status === "failed");

  return (
    <div className="table-result-tabs">
      <div className="table-tablist" role="tablist" aria-label="표">
        {props.tables.map((table) => {
          const tableStatsValue = tableStats(table);
          const selected = table.table_key === active.table_key;
          return (
            <button
              key={table.table_key}
              type="button"
              role="tab"
              aria-selected={selected}
              className={selected ? "active" : ""}
              style={{ "--region-color": regionColorVar(props.orderOf(table.table_key)) } as CSSProperties}
              onClick={() => props.onActiveKey(table.table_key)}
            >
              <span className="table-region-swatch" aria-hidden />
              {table.table_name}
              <CountBadge
                count={tableStatsValue.reviewCells + tableStatsValue.violations}
                tone="warning"
                label={`검토 ${tableStatsValue.reviewCells} · 위반 ${tableStatsValue.violations}`}
              />
            </button>
          );
        })}
      </div>
      <div className="table-result-summary" role="tabpanel" aria-label={`${active.table_name} 결과`}>
        <span>
          <strong>{active.row_count.toLocaleString()}행</strong>
          {expectedText(active)}
        </span>
        <span data-tone={stats.reviewCells ? "warning" : undefined}>검토 칸 {stats.reviewCells.toLocaleString()}</span>
        <span data-tone={stats.violations ? "danger" : undefined}>위반 행 {stats.violations.toLocaleString()}</span>
        {stats.modifiedCells > 0 && <span data-tone="info">수정 {stats.modifiedCells.toLocaleString()}칸</span>}
        {active.header_match && active.header_match.missing.length > 0 && (
          <span data-tone="warning" title={active.header_match.missing.join(", ")}>
            머리글 없음 {active.header_match.missing.length}
          </span>
        )}
      </div>
      {(failedChecks.length > 0 || active.warnings.length > 0) && (
        <InlineAlert tone="warning">
          <ul className="table-warning-list">
            {failedChecks.map((check, index) => (
              <li key={`check-${index}`}>{check.message ?? `${check.rule} 검사 실패`}</li>
            ))}
            {active.warnings.map((warning, index) => (
              <li key={`warning-${index}`}>{warning}</li>
            ))}
          </ul>
        </InlineAlert>
      )}
      <TableResultGrid
        table={active}
        rows={displayRows(active, props.pending)}
        originalRows={active.rows}
        selectedRowId={props.selectedRowId}
        onSelectRow={props.onSelectRow}
        editable={props.editable}
        onEditCell={(rowId, column, value, original) =>
          props.onEditCell?.(active.table_key, rowId, column, value, original)
        }
        onAddRow={(afterRowId) => props.onAddRow?.(active.table_key, afterRowId)}
        onToggleDelete={(rowId) => props.onToggleDelete?.(active.table_key, rowId)}
      />
    </div>
  );
}
