import { describe, expect, it } from "vitest";
import type { TableCell, TableResult } from "../types";
import {
  addPendingRow,
  buildResultPatch,
  cellNeedsReview,
  cellTone,
  confidenceTone,
  displayRows,
  effectiveTables,
  emptyPending,
  formatCellValue,
  pendingIsEmpty,
  resultHasViolations,
  setPendingCell,
  tableStats,
  togglePendingDelete
} from "./results";

const cell = (patch: Partial<TableCell> = {}): TableCell => ({
  value: "x",
  raw: "x",
  confidence: 0.95,
  flags: [],
  ...patch
});

function table(): TableResult {
  return {
    table_key: "t1",
    table_name: "주입 내역",
    status: "needs_review",
    row_count: 2,
    expected_rows: { mode: "unknown", value: null },
    columns: ["a", "b"],
    header_match: null,
    region_used: null,
    rows: [
      {
        row_id: "r1",
        row_index: 1,
        source_line: 1,
        y_center: 0.2,
        status: "ok",
        flags: [],
        cells: { a: cell(), b: cell({ confidence: 0.7 }) },
        violations: []
      },
      {
        row_id: "r2",
        row_index: 2,
        source_line: 2,
        y_center: 0.6,
        status: "needs_review",
        flags: [],
        cells: { a: cell({ confidence: 0.5 }), b: cell({ flags: ["corrected"], confidence: 1 }) },
        violations: [{ rule: "row_formula", message: "x", columns: [] }]
      }
    ],
    table_checks: [],
    warnings: []
  };
}

describe("신뢰도 색", () => {
  it("< 0.6 빨강, < 0.8 노랑, 그 외·없음은 null", () => {
    expect(confidenceTone(0.59)).toBe("danger");
    expect(confidenceTone(0.6)).toBe("warning");
    expect(confidenceTone(0.79)).toBe("warning");
    expect(confidenceTone(0.8)).toBeNull();
    expect(confidenceTone(null)).toBeNull();
  });

  it("사람이 고친 칸은 색을 빼고, 검토 flag는 신뢰도가 높아도 노랑", () => {
    expect(cellTone(cell({ confidence: 0.3, flags: ["corrected"] }))).toBeNull();
    expect(cellTone(cell({ confidence: 0.99, flags: ["type_mismatch"] }))).toBe("warning");
    expect(cellTone(cell({ confidence: 0.99, flags: ["ditto_resolved"] }))).toBeNull();
    expect(cellNeedsReview(cell({ confidence: 0.7 }))).toBe(true);
  });

  it("값 표시: 배열은 쉼표, null은 빈 문자열", () => {
    expect(formatCellValue(cell({ value: ["A1", "A3"] }))).toBe("A1, A3");
    expect(formatCellValue(cell({ value: 21.696 }))).toBe("21.696");
    expect(formatCellValue(cell({ value: null }))).toBe("");
  });

  it("표 통계와 위반 여부, 수정본 우선", () => {
    expect(tableStats(table())).toEqual({ rows: 2, reviewCells: 2, violations: 1, modifiedCells: 1 });
    const corrected = { ...table(), rows: [] };
    expect(effectiveTables({ tables: [table()], corrected_tables: [corrected] })[0].rows).toEqual([]);
    expect(resultHasViolations({ tables: [table()], corrected_tables: null })).toBe(true);
  });
});

describe("저장 전 수정 → PATCH 바디", () => {
  it("칸 수정은 row_id로, 원래 값으로 돌리면 지운다", () => {
    let pending = setPendingCell(emptyPending("res1"), "t1", "r1", "a", "새 값", "x");
    expect(buildResultPatch(pending)).toEqual({
      edits: [{ table_key: "t1", row_id: "r1", column: "a", value: "새 값" }]
    });
    pending = setPendingCell(pending, "t1", "r1", "a", "x", "x");
    expect(pendingIsEmpty(pending)).toBe(true);
    expect(buildResultPatch(pending, { reviewed: true })).toEqual({ reviewed: true });
  });

  it("행 추가(기준 행 뒤·끝)와 삭제, 삭제한 행의 수정·기준은 빠진다", () => {
    let pending = emptyPending("res1");
    pending = addPendingRow(pending, "t1", "r1");
    pending = addPendingRow(pending, "t1", null);
    const [afterR1, atEnd] = pending.added;
    pending = setPendingCell(pending, "t1", afterR1.tempId, "a", "추가");
    pending = setPendingCell(pending, "t1", "r2", "b", "고침", "x");
    pending = togglePendingDelete(pending, "t1", "r2");
    expect(buildResultPatch(pending)).toEqual({
      add_rows: [
        { table_key: "t1", after_row_id: "r1", cells: { a: "추가" } },
        { table_key: "t1", cells: {} }
      ],
      delete_rows: [{ table_key: "t1", row_id: "r2" }]
    });
    // 기준 행을 지우면 끝에 붙인다.
    pending = togglePendingDelete(pending, "t1", "r1");
    expect(buildResultPatch(pending).add_rows?.[0]).toEqual({ table_key: "t1", cells: { a: "추가" } });
    // 추가한 행 삭제는 바로 뺀다, 삭제는 다시 누르면 취소.
    pending = togglePendingDelete(pending, "t1", atEnd.tempId);
    pending = togglePendingDelete(pending, "t1", "r1");
    expect(pending.added).toHaveLength(1);
    expect(pending.deleted).toEqual([{ table_key: "t1", row_id: "r2" }]);
  });

  it("추가한 행 뒤에 또 추가하면 같은 서버 기준 행 뒤로 보낸다", () => {
    let pending = addPendingRow(emptyPending("res1"), "t1", "r1");
    pending = addPendingRow(pending, "t1", pending.added[0].tempId);
    expect(pending.added.map((row) => row.after_row_id)).toEqual(["r1", "r1"]);
  });

  it("화면 행: 수정 칸 표시, 삭제 예정, 추가 행 위치", () => {
    let pending = setPendingCell(emptyPending("res1"), "t1", "r1", "a", "새", "x");
    pending = addPendingRow(pending, "t1", "r1");
    pending = togglePendingDelete(pending, "t1", "r2");
    const rows = displayRows(table(), pending);
    expect(rows.map((row) => row.state)).toEqual(["normal", "added", "deleted"]);
    expect(rows[0].pendingColumns.has("a")).toBe(true);
    expect(rows[0].row.cells.a.value).toBe("새");
    expect(rows[0].row.cells.a.raw).toBe("x");
  });
});
