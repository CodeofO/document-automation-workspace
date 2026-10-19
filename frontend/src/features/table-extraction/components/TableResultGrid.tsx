// 표 하나의 결과 격자. 칸 색 = 신뢰도(< 0.8 노랑, < 0.6 빨강), 위반 행 표시, 수정 칸 표시.
// 칸을 누르면 CellPopover(원문·신뢰도·flags·수정), 행 번호를 누르면 행 선택(뷰어에 띠 표시).
import { AlertTriangle, ListPlus, Plus, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "../../../components/ui";
import { cellEditText, cellIsModified, cellTone, formatCellValue, type DisplayRow } from "../model/results";
import type { TableResult } from "../types";
import { CellPopover } from "./CellPopover";

type OpenCell = { rowId: string; column: string; anchor: DOMRect };

function rowLabel(display: DisplayRow, position: number) {
  if (display.state === "added") return "새 행";
  return display.row.row_index ? `${display.row.row_index}행` : `줄 ${display.row.source_line ?? position + 1}`;
}

export function TableResultGrid(props: {
  table: TableResult;
  rows: DisplayRow[];
  /** 서버 값(저장 전 수정 비교용) */
  originalRows: TableResult["rows"];
  selectedRowId: string | null;
  onSelectRow: (rowId: string | null) => void;
  editable: boolean;
  onEditCell?: (rowId: string, column: string, value: string, original: string) => void;
  onAddRow?: (afterRowId: string | null) => void;
  onToggleDelete?: (rowId: string) => void;
}) {
  const [open, setOpen] = useState<OpenCell | null>(null);
  const { table } = props;
  const openRow = open ? props.rows.find((item) => item.row.row_id === open.rowId) : null;
  const originalCell = open
    ? props.originalRows.find((row) => row.row_id === open.rowId)?.cells[open.column]
    : undefined;

  if (table.status === "failed") {
    return (
      <div className="table-result-failed" role="alert">
        <AlertTriangle size={16} /> 이 표를 읽지 못했습니다. {table.error ?? ""}
      </div>
    );
  }

  return (
    <div className="table-result-grid-block">
      <div className="table-result-grid-wrap">
        <table className="table-result-grid" aria-label={`${table.table_name} 결과`}>
          <thead>
            <tr>
              <th scope="col" className="table-row-head">
                #
              </th>
              {table.columns.map((column) => (
                <th key={column} scope="col">
                  {column}
                </th>
              ))}
              {props.editable && (
                <th scope="col" className="table-row-actions">
                  <span className="visually-hidden">행 작업</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {props.rows.length ? (
              props.rows.map((display, position) => {
                const { row } = display;
                const selected = row.row_id === props.selectedRowId;
                const violated = row.violations.length > 0;
                const label = rowLabel(display, position);
                return (
                  <tr
                    key={row.row_id}
                    data-state={display.state}
                    data-status={row.status}
                    data-violation={violated || undefined}
                    data-selected={selected || undefined}
                    data-blank={row.flags.includes("blank") || undefined}
                  >
                    <th scope="row" className="table-row-head">
                      <button
                        type="button"
                        className="table-row-select"
                        aria-pressed={selected}
                        title={
                          violated
                            ? row.violations.map((violation) => violation.message).join("\n")
                            : "이 행을 원본에서 보기"
                        }
                        onClick={() => props.onSelectRow(selected ? null : row.row_id)}
                      >
                        {violated && <AlertTriangle size={12} aria-label="규칙 위반" />}
                        {display.state === "added" ? "+" : (row.row_index ?? "·")}
                      </button>
                    </th>
                    {table.columns.map((column) => {
                      const cell = row.cells[column];
                      const pending = display.pendingColumns.has(column);
                      const modified = !pending && cellIsModified(cell);
                      const text = formatCellValue(cell);
                      const showRaw = !text && cell?.raw;
                      return (
                        <td
                          key={column}
                          data-tone={pending ? undefined : (cellTone(cell) ?? undefined)}
                          data-modified={modified || undefined}
                          data-pending={pending || undefined}
                        >
                          <button
                            type="button"
                            className="table-cell-button"
                            aria-label={`${label} ${column}: ${text || cell?.raw || "빈 칸"}${modified ? " (수정됨)" : ""}${pending ? " (저장 전)" : ""}`}
                            disabled={display.state === "deleted"}
                            onClick={(event) => {
                              props.onSelectRow(row.row_id);
                              setOpen({
                                rowId: row.row_id,
                                column,
                                anchor: event.currentTarget.getBoundingClientRect()
                              });
                            }}
                          >
                            {showRaw ? <span className="table-cell-raw">{cell?.raw}</span> : text}
                          </button>
                        </td>
                      );
                    })}
                    {props.editable && (
                      <td className="table-row-actions">
                        {display.state === "deleted" ? (
                          <IconButton
                            size="sm"
                            variant="ghost"
                            label={`${label} 삭제 취소`}
                            onClick={() => props.onToggleDelete?.(row.row_id)}
                          >
                            <Undo2 size={14} />
                          </IconButton>
                        ) : (
                          <>
                            <IconButton
                              size="sm"
                              variant="ghost"
                              label={`${label} 아래에 행 추가`}
                              onClick={() => props.onAddRow?.(row.row_id)}
                            >
                              <ListPlus size={14} />
                            </IconButton>
                            <IconButton
                              size="sm"
                              variant="danger-ghost"
                              label={`${label} 삭제`}
                              onClick={() => props.onToggleDelete?.(row.row_id)}
                            >
                              <Trash2 size={14} />
                            </IconButton>
                          </>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })
            ) : (
              <tr>
                <td className="table-result-empty" colSpan={table.columns.length + (props.editable ? 2 : 1)}>
                  읽은 행이 없습니다.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {props.editable && (
        <div className="table-result-grid-footer">
          <Button size="sm" icon={<Plus size={14} />} onClick={() => props.onAddRow?.(null)}>
            행 추가
          </Button>
        </div>
      )}
      {open && openRow && (
        <CellPopover
          key={`${open.rowId}-${open.column}`}
          anchor={open.anchor}
          column={open.column}
          rowLabel={rowLabel(openRow, props.rows.indexOf(openRow))}
          cell={openRow.row.cells[open.column]}
          originalText={cellEditText(originalCell)}
          editable={props.editable && openRow.state !== "deleted"}
          onApply={(value) => {
            props.onEditCell?.(open.rowId, open.column, value, cellEditText(originalCell));
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  );
}
