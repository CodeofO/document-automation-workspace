// 표 추출 결과 규칙: 칸 색(신뢰도), 검토 칸·위반 집계, 저장 전 수정(pending)과 PATCH 바디.
import type { TableCell, TableExtractionResult, TableExtractionResultPatch, TableResult, TableRow } from "../types";

/** 화면 색 기준(설계 §7): < 0.8 노랑, < 0.6 빨강. */
export const REVIEW_CONFIDENCE_THRESHOLD = 0.8;
export const LOW_CONFIDENCE_THRESHOLD = 0.6;

/** 행을 검토 대상으로 만드는 칸 flag(API "Cell flags"). */
export const REVIEW_CELL_FLAGS = new Set([
  "ditto_unresolved",
  "uncertain_chars",
  "low_confidence",
  "type_mismatch",
  "choice_mismatch",
  "checkbox_unknown_option",
  "unaligned"
]);

export const CELL_FLAG_LABELS: Record<string, string> = {
  empty: "빈 칸",
  ditto_resolved: "〃 → 위 값",
  ditto: "〃 유지",
  ditto_unresolved: "〃 위 값 없음",
  uncertain_chars: "판독 불확실(?)",
  low_confidence: "낮은 신뢰도",
  type_mismatch: "형식 변환 실패",
  choice_matched: "허용 값 일치",
  choice_mismatch: "허용 값 아님",
  checkbox: "체크박스",
  checkbox_unknown_option: "목록에 없는 칸",
  number_in_choice: "숫자 허용",
  ambiguous_separator: "구분자 모호",
  thousands_separator: "천 단위 구분자",
  partial_date: "연도 없는 날짜",
  unaligned: "칸 위치 불확실",
  corrected: "사람이 수정"
};

export type ConfidenceTone = "danger" | "warning";

/** 신뢰도 색. 0.8 이상이거나 없으면 null. */
export function confidenceTone(confidence: number | null | undefined): ConfidenceTone | null {
  if (confidence === null || confidence === undefined || !Number.isFinite(confidence)) return null;
  if (confidence < LOW_CONFIDENCE_THRESHOLD) return "danger";
  if (confidence < REVIEW_CONFIDENCE_THRESHOLD) return "warning";
  return null;
}

export function cellIsModified(cell: Pick<TableCell, "flags"> | undefined): boolean {
  return Boolean(cell?.flags.includes("corrected"));
}

/** 칸 색: 사람이 고친 칸은 색을 빼고, 그 외에는 신뢰도 → 검토 flag 순으로 본다. */
export function cellTone(cell: TableCell | undefined): ConfidenceTone | null {
  if (!cell || cellIsModified(cell)) return null;
  const tone = confidenceTone(cell.confidence);
  if (tone) return tone;
  return cell.flags.some((flag) => REVIEW_CELL_FLAGS.has(flag)) ? "warning" : null;
}

/** export 검토 칸 기준과 같다: 신뢰도 < 0.8 이거나 검토 flag가 있는 칸(사람이 고친 칸 제외). */
export function cellNeedsReview(cell: TableCell | undefined): boolean {
  return cellTone(cell) !== null;
}

export function formatCellValue(cell: Pick<TableCell, "value" | "raw"> | undefined): string {
  if (!cell) return "";
  const value = cell.value;
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** 편집 입력의 시작 값: 값이 있으면 값, 변환에 실패했으면 원문. */
export function cellEditText(cell: Pick<TableCell, "value" | "raw"> | undefined): string {
  const formatted = formatCellValue(cell);
  return formatted || (cell?.raw ?? "");
}

/** 사람 수정본이 있으면 그것(화면·export 규칙). */
export function effectiveTables(
  result: Pick<TableExtractionResult, "tables" | "corrected_tables"> | null | undefined
): TableResult[] {
  if (!result) return [];
  return result.corrected_tables ?? result.tables;
}

export type TableStats = { rows: number; reviewCells: number; violations: number; modifiedCells: number };

export function tableStats(table: TableResult): TableStats {
  let reviewCells = 0;
  let modifiedCells = 0;
  let violations = 0;
  for (const row of table.rows) {
    if (row.violations.length) violations += 1;
    for (const cell of Object.values(row.cells)) {
      if (cellIsModified(cell)) modifiedCells += 1;
      else if (cellNeedsReview(cell)) reviewCells += 1;
    }
  }
  return { rows: table.row_count, reviewCells, violations, modifiedCells };
}

export function resultStats(tables: TableResult[]): TableStats {
  return tables.map(tableStats).reduce(
    (sum, stats) => ({
      rows: sum.rows + stats.rows,
      reviewCells: sum.reviewCells + stats.reviewCells,
      violations: sum.violations + stats.violations,
      modifiedCells: sum.modifiedCells + stats.modifiedCells
    }),
    { rows: 0, reviewCells: 0, violations: 0, modifiedCells: 0 }
  );
}

// ---- 저장 전 수정(pending) ----

/** 화면에서 추가한 행의 임시 id. 서버 id(r1, a1)와 겹치지 않는다. */
export const NEW_ROW_PREFIX = "new:";

export type PendingAddedRow = {
  tempId: string;
  table_key: string;
  after_row_id: string | null;
  cells: Record<string, string>;
};

export type PendingEdits = {
  /** 이 수정이 속한 결과 id(다른 결과로 옮기면 버린다). */
  resultId: string;
  /** cellKey(table, row, column) → 사람이 입력한 텍스트 */
  edits: Record<string, string>;
  added: PendingAddedRow[];
  deleted: { table_key: string; row_id: string }[];
};

export function emptyPending(resultId: string): PendingEdits {
  return { resultId, edits: {}, added: [], deleted: [] };
}

const SEP = "\u0000";

export function cellKey(tableKey: string, rowId: string, column: string): string {
  return [tableKey, rowId, column].join(SEP);
}

function splitCellKey(key: string): [string, string, string] {
  const [tableKey, rowId, column] = key.split(SEP);
  return [tableKey, rowId, column];
}

export function pendingIsEmpty(pending: PendingEdits | null | undefined): boolean {
  return !pending || (!Object.keys(pending.edits).length && !pending.added.length && !pending.deleted.length);
}

export function pendingChangeCount(pending: PendingEdits | null | undefined): number {
  if (!pending) return 0;
  return Object.keys(pending.edits).length + pending.added.length + pending.deleted.length;
}

function isDeleted(pending: PendingEdits, tableKey: string, rowId: string) {
  return pending.deleted.some((item) => item.table_key === tableKey && item.row_id === rowId);
}

/** 칸 값을 바꾼다. 원래 값과 같아지면 수정을 지운다. 추가한 행이면 그 행의 칸을 바꾼다. */
export function setPendingCell(
  pending: PendingEdits,
  tableKey: string,
  rowId: string,
  column: string,
  value: string,
  original?: string
): PendingEdits {
  if (rowId.startsWith(NEW_ROW_PREFIX)) {
    return {
      ...pending,
      added: pending.added.map((row) =>
        row.tempId === rowId && row.table_key === tableKey ? { ...row, cells: { ...row.cells, [column]: value } } : row
      )
    };
  }
  const key = cellKey(tableKey, rowId, column);
  const edits = { ...pending.edits };
  if (original !== undefined && value === original) delete edits[key];
  else edits[key] = value;
  return { ...pending, edits };
}

let tempCounter = 0;

/** afterRowId 뒤(없으면 표 끝)에 빈 행을 넣는다. */
export function addPendingRow(pending: PendingEdits, tableKey: string, afterRowId: string | null): PendingEdits {
  tempCounter += 1;
  const tempId = `${NEW_ROW_PREFIX}${Date.now().toString(36)}-${tempCounter}`;
  // 화면에서 추가한 행 뒤에 또 추가하면, 서버에는 그 행이 아직 없으니 같은 기준 행 뒤로 보낸다.
  const anchor = afterRowId?.startsWith(NEW_ROW_PREFIX)
    ? (pending.added.find((row) => row.tempId === afterRowId)?.after_row_id ?? null)
    : afterRowId;
  return { ...pending, added: [...pending.added, { tempId, table_key: tableKey, after_row_id: anchor, cells: {} }] };
}

/** 행 삭제(다시 누르면 취소). 화면에서 추가한 행은 바로 뺀다. */
export function togglePendingDelete(pending: PendingEdits, tableKey: string, rowId: string): PendingEdits {
  if (rowId.startsWith(NEW_ROW_PREFIX)) {
    return { ...pending, added: pending.added.filter((row) => row.tempId !== rowId) };
  }
  if (isDeleted(pending, tableKey, rowId)) {
    return {
      ...pending,
      deleted: pending.deleted.filter((item) => !(item.table_key === tableKey && item.row_id === rowId))
    };
  }
  return { ...pending, deleted: [...pending.deleted, { table_key: tableKey, row_id: rowId }] };
}

/**
 * PATCH /api/table-extraction-results/{id} 바디. 행 참조는 PATCH 이전 상태(row_id)다.
 * - 삭제할 행의 칸 수정은 보내지 않는다.
 * - 추가 행의 기준 행이 삭제되면 표 끝에 붙인다(서버는 edits → delete → add 순서로 적용).
 */
export function buildResultPatch(
  pending: PendingEdits,
  options: { reviewed?: boolean } = {}
): TableExtractionResultPatch {
  const edits = Object.entries(pending.edits)
    .map(([key, value]) => {
      const [table_key, row_id, column] = splitCellKey(key);
      return { table_key, row_id, column, value };
    })
    .filter((edit) => !isDeleted(pending, edit.table_key, edit.row_id));
  const add_rows = pending.added.map((row) => {
    const anchorDeleted = row.after_row_id !== null && isDeleted(pending, row.table_key, row.after_row_id);
    const cells = Object.fromEntries(Object.entries(row.cells).filter(([, value]) => value.trim() !== ""));
    return row.after_row_id && !anchorDeleted
      ? { table_key: row.table_key, after_row_id: row.after_row_id, cells }
      : { table_key: row.table_key, cells };
  });
  const delete_rows = pending.deleted.map((item) => ({ table_key: item.table_key, row_id: item.row_id }));
  const patch: TableExtractionResultPatch = {};
  if (edits.length) patch.edits = edits;
  if (add_rows.length) patch.add_rows = add_rows;
  if (delete_rows.length) patch.delete_rows = delete_rows;
  if (options.reviewed !== undefined) patch.reviewed = options.reviewed;
  return patch;
}

export type DisplayRowState = "normal" | "deleted" | "added";

export type DisplayRow = {
  row: TableRow;
  state: DisplayRowState;
  /** 저장 전 수정이 있는 칼럼 */
  pendingColumns: Set<string>;
};

function pendingCell(value: string): TableCell {
  return { value: value === "" ? null : value, raw: value === "" ? null : value, confidence: null, flags: ["pending"] };
}

/** 표에 저장 전 수정을 겹쳐 화면에 그릴 행 목록을 만든다(삭제 예정 행은 남겨 두고 표시만 한다). */
export function displayRows(table: TableResult, pending: PendingEdits | null): DisplayRow[] {
  if (!pending) return table.rows.map((row) => ({ row, state: "normal", pendingColumns: new Set() }));
  const toDisplay = (row: PendingAddedRow): DisplayRow => ({
    row: {
      row_id: row.tempId,
      row_index: null,
      source_line: null,
      y_center: null,
      status: "ok",
      flags: ["added"],
      cells: Object.fromEntries(table.columns.map((column) => [column, pendingCell(row.cells[column] ?? "")])),
      violations: []
    },
    state: "added",
    pendingColumns: new Set(Object.keys(row.cells))
  });
  const tableAdded = pending.added.filter((row) => row.table_key === table.table_key);
  const knownIds = new Set(table.rows.map((row) => row.row_id));
  const result: DisplayRow[] = [];
  for (const row of table.rows) {
    const pendingColumns = new Set<string>();
    const cells = { ...row.cells };
    for (const column of table.columns) {
      const value = pending.edits[cellKey(table.table_key, row.row_id, column)];
      if (value !== undefined) {
        pendingColumns.add(column);
        cells[column] = { ...pendingCell(value), raw: row.cells[column]?.raw ?? null };
      }
    }
    result.push({
      row: { ...row, cells },
      state: isDeleted(pending, table.table_key, row.row_id) ? "deleted" : "normal",
      pendingColumns
    });
    result.push(...tableAdded.filter((added) => added.after_row_id === row.row_id).map(toDisplay));
  }
  // 기준 행이 없거나(표 끝) 모르는 행이면 끝에 붙인다.
  result.push(
    ...tableAdded.filter((added) => added.after_row_id === null || !knownIds.has(added.after_row_id)).map(toDisplay)
  );
  return result;
}

// ---- 페이지(배치 항목) 필터 ----

export type PageFilter = "all" | "review" | "violation";

/** 결과에 위반 행이 하나라도 있으면 true. */
export function resultHasViolations(
  result: Pick<TableExtractionResult, "tables" | "corrected_tables"> | null | undefined
): boolean {
  return effectiveTables(result).some((table) => table.rows.some((row) => row.violations.length > 0));
}
