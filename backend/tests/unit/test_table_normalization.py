"""Pure table extraction logic: definitions, cell normalization, rules, crop math (design §9)."""

import pytest
from pydantic import ValidationError

from app.domain.table_formula import FormulaError, evaluate, parse_formula
from app.domain.table_normalization import (
    RawCell,
    RawRow,
    build_table_result,
    compute_header_match,
    downscaled_size,
    job_status_for_tables,
    normalize_cell,
    padded_region,
    parse_checkbox,
    parse_date,
    parse_number,
    parse_time,
    ratio_box_to_pixels,
    table_result_from_model,
)
from app.domain.table_spec import ColumnSpec, TableRegion, TableSpec, TableTemplateDefinition, select_tables


def _table(**overrides) -> TableSpec:
    data = {
        "key": "injection_rows",
        "name": "주입 내역",
        "columns": [
            {"key": "품명"},
            {"key": "단중", "type": "number"},
            {"key": "실적", "type": "number"},
            {"key": "주입중량", "type": "number"},
        ],
    }
    data.update(overrides)
    return TableSpec.model_validate(data)


def _rows(*rows: list[str | None], conf: float = 0.9) -> list[RawRow]:
    return [RawRow(row_id=f"r{i}", source_line=i, y_center=None, cells=[RawCell(raw, conf) for raw in cells]) for i, cells in enumerate(rows, start=1)]


# --- definitions ----------------------------------------------------------------------------


def test_table_spec_rejects_duplicate_column_keys_and_empty_columns() -> None:
    with pytest.raises(ValidationError, match="unique"):
        _table(columns=[{"key": "a"}, {"key": "a"}])
    with pytest.raises(ValidationError):
        _table(columns=[])


def test_table_spec_validates_types_regions_row_count_and_rules() -> None:
    with pytest.raises(ValidationError):
        _table(columns=[{"key": "a", "type": "money"}])
    with pytest.raises(ValidationError, match="choice"):
        _table(columns=[{"key": "a", "type": "choice"}])
    with pytest.raises(ValidationError, match="inside the page"):
        _table(region={"x": 0.5, "y": 0.1, "width": 0.6, "height": 0.2})
    with pytest.raises(ValidationError, match="row_count.value"):
        _table(row_count={"mode": "max"})
    with pytest.raises(ValidationError, match="unknown column"):
        _table(rules=[{"kind": "row_formula", "expression": "주입중량 = 단중 * 없는칼럼"}])
    with pytest.raises(ValidationError, match="invalid"):
        _table(rules=[{"kind": "row_formula", "expression": "주입중량 == 단중"}])
    table = _table(rules=[{"kind": "unique", "columns": ["품명"]}])
    assert table.region_padding == 0.05
    assert table.blank_rows == "skip"
    assert table.columns[0].keep_raw is True and table.columns[0].ditto == "fill_from_above"
    assert table.row_count.mode == "unknown"


def test_template_definition_requires_unique_table_keys_and_selects_subsets() -> None:
    with pytest.raises(ValidationError, match="table keys"):
        TableTemplateDefinition(tables=[_table(), _table()])
    definition = TableTemplateDefinition(tables=[_table(), _table(key="lots", name="Lot")])
    assert [table.key for table in select_tables(definition, ["lots"])] == ["lots"]
    assert len(select_tables(definition, None)) == 2
    with pytest.raises(ValueError, match="Unknown table"):
        select_tables(definition, ["nope"])


# --- formula --------------------------------------------------------------------------------


def test_formula_parser_is_a_safe_arithmetic_evaluator() -> None:
    formula = parse_formula("주입중량 = 단중 * (실적 + 1) - [주입 수량] / 2")
    assert formula.names() == {"주입중량", "단중", "실적", "주입 수량"}
    assert evaluate(formula.right, {"단중": 2.0, "실적": 3.0, "주입 수량": 4.0}) == 6.0
    assert evaluate(formula.right, {"단중": 2.0, "실적": None, "주입 수량": 4.0}) is None
    assert evaluate(parse_formula("a = b / c").right, {"b": 1.0, "c": 0.0}) is None
    assert evaluate(parse_formula("a = -b").right, {"b": 2.0}) == -2.0
    for bad in ["a = __import__('os')", "a = b ** 2", "a = (b", "a b = c", "= b"]:
        with pytest.raises(FormulaError):
            parse_formula(bad)


# --- cells ----------------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("raw", "fmt", "value", "flags"),
    [
        ("1,234", "auto", 1234, ["thousands_separator"]),
        ("1,234.5", "auto", 1234.5, ["thousands_separator"]),
        ("1.234,5", "auto", 1234.5, ["thousands_separator"]),
        ("1.234.567", "auto", 1234567, ["thousands_separator"]),
        ("21.696", "auto", 21.696, ["ambiguous_separator"]),
        ("0.500", "auto", 0.5, []),
        ("3.5", "auto", 3.5, []),
        ("21,5", "auto", 21.5, ["ambiguous_separator"]),
        ("-12", "auto", -12, []),
        ("１２３", "auto", 123, []),
        ("21.696", "dot_thousands", 21696, ["thousands_separator"]),
        ("1.234,5", "dot_thousands", 1234.5, ["thousands_separator"]),
        ("1.234.567", "dot_decimal", None, ["type_mismatch"]),
        ("12kg", "auto", None, ["type_mismatch"]),
        ("1,23,4", "auto", None, ["type_mismatch"]),
    ],
)
def test_parse_number(raw: str, fmt: str, value, flags: list[str]) -> None:
    assert parse_number(raw, fmt) == (value, flags)


def test_number_cell_keeps_raw_thousands_dot() -> None:
    cell = normalize_cell(ColumnSpec(key="중량", type="number"), "21.696", 0.9)
    assert cell == {"value": 21.696, "raw": "21.696", "confidence": 0.9, "flags": ["ambiguous_separator"]}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("2026-10-19", ("2026-10-19", [])),
        ("2026.10.19.", ("2026-10-19", [])),
        ("2026. 10. 9", ("2026-10-09", [])),
        ("26/10/19", ("2026-10-19", [])),
        ("2026년 10월 19일", ("2026-10-19", [])),
        ("20261019", ("2026-10-19", [])),
        ("10/19", ("10-19", ["partial_date"])),
        ("6월 17일", ("06-17", ["partial_date"])),
        ("2026-02-30", (None, ["type_mismatch"])),
        ("어제", (None, ["type_mismatch"])),
    ],
)
def test_parse_date(raw: str, expected) -> None:
    assert parse_date(raw) == expected


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("8:30", "08:30"),
        ("08:30:15", "08:30:15"),
        ("14.05", "14:05"),
        ("1405", "14:05"),
        ("8시 30분", "08:30"),
        ("8시", "08:00"),
        ("24:00", "24:00"),
        ("25:00", None),
        ("8:75", None),
    ],
)
def test_parse_time(raw: str, expected) -> None:
    assert parse_time(raw)[0] == expected


def test_choice_and_checkbox_cells() -> None:
    choice = ColumnSpec(key="잔량", type="choice", choices=["완"], choice_allow_number=True)
    assert normalize_cell(choice, "완", 0.9)["flags"] == ["choice_matched"]
    assert normalize_cell(choice, "12", 0.9)["value"] == 12
    assert "number_in_choice" in normalize_cell(choice, "12", 0.9)["flags"]
    mismatch = normalize_cell(choice, "만", 0.9)
    assert mismatch["value"] is None and mismatch["flags"] == ["choice_mismatch"]

    checkbox = ColumnSpec(key="레들", type="checkbox", checkbox_options=["A1", "A2", "A3", "B4"])
    assert parse_checkbox("A3, a1:1, A2:0", checkbox) == (["A1", "A3"], ["checkbox"])
    assert parse_checkbox("A1 Z9", checkbox) == (["A1"], ["checkbox", "checkbox_unknown_option"])
    empty = normalize_cell(checkbox, None, 0.8)
    assert empty["value"] == [] and empty["flags"] == ["empty", "checkbox"]


def test_uncertain_empty_and_low_confidence_cells() -> None:
    text = normalize_cell(ColumnSpec(key="관리번호"), "26C2?6", 0.9)
    assert text["value"] == "26C2?6" and text["flags"] == ["uncertain_chars"]
    number = normalize_cell(ColumnSpec(key="n", type="number"), "1?.5", 0.9)
    assert number["value"] is None and number["flags"] == ["uncertain_chars"]
    assert normalize_cell(ColumnSpec(key="n"), "  ", 0.9)["flags"] == ["empty"]
    assert normalize_cell(ColumnSpec(key="n"), "abc", 0.5)["flags"] == ["low_confidence"]


# --- rows and tables ------------------------------------------------------------------------


def test_ditto_marks_fill_from_the_data_row_above() -> None:
    table = _table()
    result = build_table_result(table, _rows(["MBS", "2", "3", "6"], ["〃", "″", "3", "6"], ['"', "〃", "4", "8"]))
    rows = result["rows"]
    assert [row["cells"]["품명"]["value"] for row in rows] == ["MBS", "MBS", "MBS"]
    assert rows[1]["cells"]["품명"]["flags"] == ["ditto_resolved"]
    assert rows[1]["cells"]["품명"]["raw"] == "〃"
    assert rows[2]["cells"]["단중"]["value"] == 2
    assert result["status"] == "ok"

    keep = _table(columns=[{"key": "품명", "ditto": "keep"}])
    kept = build_table_result(keep, _rows(["MBS"], ["〃"]))
    assert kept["rows"][1]["cells"]["품명"] == {"value": "〃", "raw": "〃", "confidence": 0.9, "flags": ["ditto"]}

    unresolved = build_table_result(_table(columns=[{"key": "품명"}]), _rows(["〃"]))
    assert unresolved["rows"][0]["cells"]["품명"]["flags"] == ["ditto_unresolved"]
    assert unresolved["rows"][0]["status"] == "needs_review"


def test_blank_rows_skip_or_keep_and_row_index_vs_source_line() -> None:
    raw = _rows(["A", "1", "1", "1"], [None, None, "", None], ["B", "2", "2", "4"])
    skipped = build_table_result(_table(), raw)
    assert [(row["row_index"], row["source_line"]) for row in skipped["rows"]] == [(1, 1), (2, 3)]
    assert skipped["row_count"] == 2

    kept = build_table_result(_table(blank_rows="keep"), raw)
    assert [(row["row_index"], row["source_line"], row["flags"]) for row in kept["rows"]] == [(1, 1, []), (None, 2, ["blank"]), (2, 3, [])]
    assert kept["row_count"] == 2 and kept["status"] == "ok"


def test_required_rules_and_row_count() -> None:
    table = _table(
        columns=[
            {"key": "품명", "required": True},
            {"key": "단중", "type": "number"},
            {"key": "실적", "type": "number"},
            {"key": "주입중량", "type": "number"},
        ],
        rules=[
            {"kind": "row_formula", "expression": "주입중량 = 단중 * 실적", "tolerance": 0.01},
            {"kind": "unique", "columns": ["품명"]},
        ],
        row_count={"mode": "max", "value": 2},
    )
    result = build_table_result(table, _rows(["A", "2", "3", "6"], ["A", "2", "3", "7"], [None, "1", "1", "1"], ["B", "x", "1", "1"]))
    rows = result["rows"]
    assert [row["status"] for row in rows] == ["needs_review"] * 4
    assert [violation["rule"] for violation in rows[0]["violations"]] == ["unique"]
    assert {violation["rule"] for violation in rows[1]["violations"]} == {"row_formula", "unique"}
    assert [violation["rule"] for violation in rows[2]["violations"]] == ["required"]
    assert rows[3]["cells"]["단중"]["flags"] == ["type_mismatch"]
    checks = {check["rule"]: check for check in result["table_checks"]}
    assert checks["row_count"] == {"rule": "row_count", "status": "failed", "expected": 2, "actual": 4, "message": "Expected at most 2 row(s), found 4"}
    assert checks["row_formula"]["violation_count"] == 1
    assert checks["unique"]["violation_count"] == 2
    assert result["status"] == "needs_review"

    exact = build_table_result(_table(row_count={"mode": "exact", "value": 1}), _rows(["A", "1", "1", "1"]))
    assert exact["table_checks"][0]["status"] == "ok" and exact["status"] == "ok"


def test_low_confidence_cell_marks_row_for_review() -> None:
    result = build_table_result(_table(), _rows(["A", "1", "1", "1"], conf=0.55))
    assert result["rows"][0]["status"] == "needs_review"
    assert "low_confidence" in result["rows"][0]["cells"]["품명"]["flags"]


def test_cells_length_mismatch_is_flagged_not_repaired() -> None:
    table = _table()
    output = {
        "headers_seen": ["품명", "단중", "실적", "주입중량"],
        "rows": [
            {"source_line": 1, "y_center": 0.1, "cells": [{"raw": "A", "conf": 0.9}, {"raw": "2", "conf": 0.9}, {"raw": "3", "conf": 0.9}, {"raw": "6", "conf": 0.9}]},
            {"source_line": 2, "y_center": 0.3, "cells": [{"raw": "B", "conf": 0.9}, {"raw": "2", "conf": 0.9}, {"raw": "3", "conf": 0.9}]},
            {"source_line": 3, "y_center": 0.5, "cells": [{"raw": c, "conf": 0.9} for c in ["C", "1", "1", "1", "extra"]]},
        ],
        "notes": None,
    }
    result = table_result_from_model(table, output, None)
    first, short, long = result["rows"]
    assert first["status"] == "ok"
    assert short["status"] == "needs_review" and short["flags"] == ["cells_length_mismatch"]
    assert short["violations"][0]["rule"] == "cells_length_mismatch"
    assert short["cells"]["주입중량"]["raw"] is None and "unaligned" in short["cells"]["품명"]["flags"]
    assert long["extra_cells"][0]["raw"] == "extra"
    assert result["status"] == "needs_review"
    assert any("model returned 3 cell(s) for 4 column(s)" in warning for warning in result["warnings"])
    assert result["header_match"] == {"matched": 4, "missing": [], "extra": []}


def test_header_match_and_job_status() -> None:
    table = _table(columns=[{"key": "품명", "header_path": ["제품", "품명"]}, {"key": "Lot No"}, {"key": "비고"}])
    assert compute_header_match(table, ["제품", "품 명", "LOT NO.", "합계"]) == {"matched": 2, "missing": ["비고"], "extra": ["합계"]}
    assert compute_header_match(table, []) is None
    assert job_status_for_tables([{"status": "ok"}, {"status": "ok"}]) == "completed"
    assert job_status_for_tables([{"status": "ok"}, {"status": "failed"}]) == "needs_review"
    assert job_status_for_tables([{"status": "failed"}]) == "failed"
    empty = build_table_result(_table(), [])
    assert empty["status"] == "needs_review" and "No rows were extracted" in empty["warnings"]


# --- crop math ------------------------------------------------------------------------------


def test_padded_region_is_clamped_to_the_page() -> None:
    region = TableRegion(x=0.02, y=0.5, width=0.9, height=0.48)
    assert padded_region(region, 0.05) == {"x": 0.0, "y": 0.45, "width": 0.97, "height": 0.55, "padding": 0.05}
    assert padded_region(TableRegion(x=0.2, y=0.2, width=0.2, height=0.2), 0.0) == {"x": 0.2, "y": 0.2, "width": 0.2, "height": 0.2, "padding": 0.0}


def test_ratio_box_to_pixels_follows_the_rotated_page_size() -> None:
    box = padded_region(TableRegion(x=0.1, y=0.2, width=0.5, height=0.3), 0.05)
    assert ratio_box_to_pixels(box, 1000, 2000) == (50, 300, 650, 1100)
    # The same ratios on the page after a 90° rotation (width/height swapped) cover the rotated image.
    assert ratio_box_to_pixels(box, 2000, 1000) == (100, 150, 1300, 550)
    tiny = ratio_box_to_pixels({"x": 1.0, "y": 1.0, "width": 0.0, "height": 0.0}, 100, 100)
    assert tiny == (99, 99, 100, 100)


def test_downscaled_size_keeps_aspect_ratio() -> None:
    assert downscaled_size(2480, 3508) == (724, 1024)
    assert downscaled_size(800, 600) == (800, 600)
