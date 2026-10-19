"""Server-side normalization and validation of extracted tables (design §4, API doc §5).

The model only reports what it sees (``raw``) and how sure it is (``conf``) per cell, in column
order. Everything else happens here, as pure functions over plain dicts:

* cell conversion by column type (number/date/time/choice/checkbox/text), ``?`` detection;
* ditto marks (〃 …) filled from the data row above;
* blank rows (skip/keep), ``row_index`` vs ``source_line``;
* cells-length mismatches are flagged, never repaired;
* rules (``row_formula``, ``unique``, ``row_count``) and the row/table status.

The output is a ``TableResult`` dict (shape: ``app.table_schemas.TableResult``).
"""

import math
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from typing import Any

from app.domain.table_formula import evaluate, parse_formula
from app.domain.table_spec import ColumnSpec, TableRegion, TableSpec

# A cell below this confidence makes its row ``needs_review``.
LOW_CONFIDENCE_THRESHOLD = 0.6
# Screens colour cells below this (yellow) and exports list them as review cells (part 2); informational here.
REVIEW_CONFIDENCE_THRESHOLD = 0.8

DITTO_MARKS = frozenset({"〃", '"', "″", "′′", "”", "“", "''", "ゝ", "ゞ", "々", "同上", "상동", "〃〃"})
UNCERTAIN_MARKS = ("?", "？")
REVIEW_CELL_FLAGS = frozenset(
    {
        "type_mismatch",
        "choice_mismatch",
        "uncertain_chars",
        "low_confidence",
        "ditto_unresolved",
        "checkbox_unknown_option",
        "unaligned",
    }
)
_UNCHECKED_MARKS = frozenset({"0", "false", "no", "n", "off", "미표시"})


# --- crop math ------------------------------------------------------------------------------


def _clamp01(value: float) -> float:
    return min(1.0, max(0.0, value))


def padded_region(region: TableRegion, padding: float) -> dict[str, float]:
    """``region`` grown by ``padding`` (page ratio) on every side and clamped to the page."""
    left = _clamp01(region.x - padding)
    top = _clamp01(region.y - padding)
    right = _clamp01(region.x + region.width + padding)
    bottom = _clamp01(region.y + region.height + padding)
    return {
        "x": round(left, 6),
        "y": round(top, 6),
        "width": round(right - left, 6),
        "height": round(bottom - top, 6),
        "padding": padding,
    }


def ratio_box_to_pixels(box: dict[str, float], width: int, height: int) -> tuple[int, int, int, int]:
    """Pixel ``(left, top, right, bottom)`` of a ratio box on a ``width`` × ``height`` image (never empty)."""
    # Rounded before floor/ceil so float noise (0.15 + 0.4 → 0.55000000000000004) does not add a pixel.
    left = min(width - 1, max(0, math.floor(round(box["x"] * width, 6))))
    top = min(height - 1, max(0, math.floor(round(box["y"] * height, 6))))
    right = max(left + 1, min(width, math.ceil(round((box["x"] + box["width"]) * width, 6))))
    bottom = max(top + 1, min(height, math.ceil(round((box["y"] + box["height"]) * height, 6))))
    return left, top, right, bottom


def downscaled_size(width: int, height: int, long_edge: int = 1024) -> tuple[int, int]:
    longest = max(width, height)
    if longest <= long_edge:
        return width, height
    scale = long_edge / longest
    return max(1, round(width * scale)), max(1, round(height * scale))


# --- cell parsing ---------------------------------------------------------------------------


def _nfkc(text: str) -> str:
    return unicodedata.normalize("NFKC", text)


def _fold(text: str) -> str:
    return _nfkc(text).strip().casefold()


def is_ditto(text: str) -> bool:
    stripped = text.strip()
    return stripped in DITTO_MARKS or _nfkc(stripped) in DITTO_MARKS


def has_uncertain_chars(text: str) -> bool:
    return any(mark in text for mark in UNCERTAIN_MARKS)


def _number(int_part: str, frac_part: str | None) -> int | float:
    if frac_part is None or frac_part == "":
        return int(int_part or "0")
    return float(f"{int_part or '0'}.{frac_part}")


def _parse_with_separators(body: str, thousands: str, decimal: str) -> tuple[int | float, list[str]] | None:
    if body.count(decimal) > 1:
        return None
    int_part, _, frac_part = body.partition(decimal)
    has_decimal = decimal in body
    flags: list[str] = []
    if thousands in int_part:
        if not re.fullmatch(rf"\d{{1,3}}(?:{re.escape(thousands)}\d{{3}})+", int_part):
            return None
        int_part = int_part.replace(thousands, "")
        flags.append("thousands_separator")
    if int_part and not int_part.isdigit():
        return None
    if has_decimal and frac_part and not frac_part.isdigit():
        return None
    if not int_part and not frac_part:
        return None
    return _number(int_part, frac_part if has_decimal else None), flags


def parse_number(text: str, number_format: str = "auto") -> tuple[int | float | None, list[str]]:
    """Best numeric reading of ``text`` → ``(value, flags)``; ``(None, ["type_mismatch"])`` when not a number.

    ``auto`` rule (the raw text is always kept by the caller):

    * both ``.`` and ``,``: the one that appears last is the decimal mark (``1,234.5`` / ``1.234,5``);
    * only ``,``: ``1,234`` / ``12,345,678`` are thousands groups; any other single comma is a
      decimal comma (``21,5`` → 21.5, flag ``ambiguous_separator``);
    * only ``.``, several: ``1.234.567`` is thousands groups (flag ``thousands_separator``);
    * only ``.``, one: a decimal point. When exactly three digits follow and the integer part is
      not ``0`` (``21.696``), it could be a thousands dot → value 21.696 with flag
      ``ambiguous_separator``. Columns that use thousands dots set ``number_format="dot_thousands"``.
    """
    s = _nfkc(text).strip().replace("−", "-")
    s = re.sub(r"\s+", "", s)
    sign = 1
    if s[:1] in {"+", "-"}:
        sign = -1 if s[0] == "-" else 1
        s = s[1:]
    if not s or not re.fullmatch(r"[\d.,]+", s) or not any(char.isdigit() for char in s):
        return None, ["type_mismatch"]

    parsed: tuple[int | float, list[str]] | None
    if number_format == "dot_decimal":
        parsed = _parse_with_separators(s, ",", ".")
    elif number_format == "dot_thousands":
        parsed = _parse_with_separators(s, ".", ",")
    elif "." in s and "," in s:
        decimal = "." if s.rfind(".") > s.rfind(",") else ","
        parsed = _parse_with_separators(s, "," if decimal == "." else ".", decimal)
    elif "," in s:
        if re.fullmatch(r"\d{1,3}(?:,\d{3})+", s):
            parsed = _parse_with_separators(s, ",", ".")
        elif s.count(",") == 1:
            parsed = _parse_with_separators(s, ".", ",")
            if parsed:
                parsed = (parsed[0], [*parsed[1], "ambiguous_separator"])
        else:
            parsed = None
    elif s.count(".") > 1:
        parsed = _parse_with_separators(s, ".", ",") if re.fullmatch(r"\d{1,3}(?:\.\d{3})+", s) else None
    else:
        parsed = _parse_with_separators(s, ",", ".")
        if parsed and re.fullmatch(r"[1-9]\d{0,2}\.\d{3}", s):
            parsed = (parsed[0], [*parsed[1], "ambiguous_separator"])
    if parsed is None:
        return None, ["type_mismatch"]
    value, flags = parsed
    return sign * value, flags


def _valid_date(year: int, month: int, day: int) -> bool:
    try:
        date(year, month, day)
    except ValueError:
        return False
    return True


def parse_date(text: str) -> tuple[str | None, list[str]]:
    """ISO ``YYYY-MM-DD`` (or ``MM-DD`` + ``partial_date`` without a year)."""
    s = _nfkc(text).strip()
    s = re.sub(r"\s*(년|월)\s*", "-", s)
    s = re.sub(r"\s*일\s*$", "", s)
    s = re.sub(r"\s*[./]\s*", "-", s)
    s = re.sub(r"\s*-\s*", "-", s).strip("-").strip()
    match = re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", s) or re.fullmatch(r"(\d{4})(\d{2})(\d{2})", s)
    if match:
        year, month, day = (int(part) for part in match.groups())
        return (f"{year:04d}-{month:02d}-{day:02d}", []) if _valid_date(year, month, day) else (None, ["type_mismatch"])
    match = re.fullmatch(r"(\d{2})-(\d{1,2})-(\d{1,2})", s)
    if match:
        year, month, day = 2000 + int(match.group(1)), int(match.group(2)), int(match.group(3))
        return (f"{year:04d}-{month:02d}-{day:02d}", []) if _valid_date(year, month, day) else (None, ["type_mismatch"])
    match = re.fullmatch(r"(\d{1,2})-(\d{1,2})", s)
    if match:
        month, day = int(match.group(1)), int(match.group(2))
        return (f"{month:02d}-{day:02d}", ["partial_date"]) if _valid_date(2000, month, day) else (None, ["type_mismatch"])
    return None, ["type_mismatch"]


def parse_time(text: str) -> tuple[str | None, list[str]]:
    """``HH:MM`` or ``HH:MM:SS``."""
    s = _nfkc(text).strip()
    s = re.sub(r"\s*시\s*", ":", s)
    s = re.sub(r"\s*분\s*", ":", s)
    s = re.sub(r"\s*초\s*$", "", s).strip().rstrip(":")
    second: int | None = None
    if match := re.fullmatch(r"(\d{1,2})(?::(\d{1,2})|\.(\d{2}))(?::(\d{2}))?", s):
        hour, minute = int(match.group(1)), int(match.group(2) or match.group(3))
        second = int(match.group(4)) if match.group(4) is not None else None
    elif match := re.fullmatch(r"(\d{2})(\d{2})", s):
        hour, minute = int(match.group(1)), int(match.group(2))
    elif match := re.fullmatch(r"\d{1,2}", s):
        hour, minute = int(s), 0
    else:
        return None, ["type_mismatch"]
    if minute >= 60 or (second is not None and second >= 60) or hour > 24 or (hour == 24 and (minute or second)):
        return None, ["type_mismatch"]
    if second is None:
        return f"{hour:02d}:{minute:02d}", []
    return f"{hour:02d}:{minute:02d}:{second:02d}", []


def parse_choice(text: str, column: ColumnSpec) -> tuple[Any, list[str]]:
    folded = _fold(text)
    for choice in column.choices:
        if _fold(choice) == folded:
            return choice, ["choice_matched"]
    if column.choice_allow_number:
        value, flags = parse_number(text, column.number_format)
        if value is not None:
            return value, [*flags, "number_in_choice"]
    return None, ["choice_mismatch"]


def parse_checkbox(text: str, column: ColumnSpec) -> tuple[list[str], list[str]]:
    marked: list[str] = []
    for token in re.split(r"[,;/\s]+", _nfkc(text).strip()):
        if not token:
            continue
        name, separator, mark = token.partition(":") if ":" in token else token.partition("=")
        if separator and mark.strip().casefold() in _UNCHECKED_MARKS:
            continue
        name = name.strip()
        if name:
            marked.append(name)
    flags = ["checkbox"]
    if not column.checkbox_options:
        return list(dict.fromkeys(marked)), flags
    options = {_fold(option): option for option in column.checkbox_options}
    found = {options[_fold(name)] for name in marked if _fold(name) in options}
    if any(_fold(name) not in options for name in marked):
        flags.append("checkbox_unknown_option")
    return [option for option in column.checkbox_options if option in found], flags


def normalize_cell(column: ColumnSpec, raw: str | None, confidence: float | None) -> dict[str, Any]:
    """One cell without row context (ditto marks are resolved by ``build_table_result``)."""
    flags: list[str] = []
    text = raw.strip() if isinstance(raw, str) else ""
    if not text:
        value: Any = [] if column.type == "checkbox" else None
        flags.append("empty")
        if column.type == "checkbox":
            flags.append("checkbox")
    elif has_uncertain_chars(text):
        flags.append("uncertain_chars")
        value = text if column.type == "text" else None
    elif column.type == "number":
        value, type_flags = parse_number(text, column.number_format)
        flags.extend(type_flags)
    elif column.type == "date":
        value, type_flags = parse_date(text)
        flags.extend(type_flags)
    elif column.type == "time":
        value, type_flags = parse_time(text)
        flags.extend(type_flags)
    elif column.type == "choice":
        value, type_flags = parse_choice(text, column)
        flags.extend(type_flags)
    elif column.type == "checkbox":
        value, type_flags = parse_checkbox(text, column)
        flags.extend(type_flags)
    else:
        value = text
    if confidence is not None and confidence < LOW_CONFIDENCE_THRESHOLD:
        flags.append("low_confidence")
    return {"value": value, "raw": raw, "confidence": confidence, "flags": flags}


# --- model output → raw rows ----------------------------------------------------------------


@dataclass
class RawCell:
    raw: str | None
    conf: float | None = None
    corrected: bool = False


@dataclass
class RawRow:
    row_id: str
    source_line: int | None
    y_center: float | None
    cells: list[RawCell]  # exactly one per column, in column order
    extra_cells: list[RawCell] = field(default_factory=list)
    length_mismatch: tuple[int, int] | None = None  # (cells returned, columns expected)
    added: bool = False
    edited: bool = False


def coerce_raw(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return ", ".join(str(item) for item in value if item is not None)
    return str(value)


def _coerce_conf(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or math.isnan(value):
        return None
    if 1 < value <= 100:
        value = value / 100
    return _clamp01(float(value))


def _raw_cell(value: Any) -> RawCell:
    if isinstance(value, dict):
        return RawCell(coerce_raw(value.get("raw", value.get("value"))), _coerce_conf(value.get("conf", value.get("confidence"))))
    return RawCell(coerce_raw(value))


def _optional_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def _optional_ratio(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or math.isnan(value):
        return None
    return round(_clamp01(float(value)), 4)


@dataclass
class ParsedModelTable:
    rows: list[RawRow]
    headers_seen: list[str]
    notes: str | None
    warnings: list[str]


def parse_model_output(table: TableSpec, output: Any) -> ParsedModelTable:
    """Turn ``{"rows": [{source_line, y_center, cells: [...]}], "headers_seen": [...], "notes": ...}`` into raw rows.

    ``cells`` must be a list with one entry per column. Any other length is kept as-is and
    marked (``length_mismatch``): cells map by position only, extra cells are kept aside.
    """
    warnings: list[str] = []
    if not isinstance(output, dict):
        return ParsedModelTable([], [], None, ["Model output is not a JSON object"])
    column_keys = table.column_keys
    expected = len(column_keys)
    rows_value = output.get("rows")
    if rows_value is None:
        rows_value = []
    if not isinstance(rows_value, list):
        warnings.append("Model output 'rows' is not a list")
        rows_value = []
    rows: list[RawRow] = []
    for position, item in enumerate(rows_value, start=1):
        if not isinstance(item, dict):
            item = {"cells": item}
        cells_value = item.get("cells")
        mismatch: tuple[int, int] | None = None
        extra: list[RawCell] = []
        if isinstance(cells_value, dict) and set(cells_value) <= set(column_keys):
            # Keyed by column: unambiguous, so it is aligned by key rather than by position.
            cells = [_raw_cell(cells_value.get(key)) for key in column_keys]
        else:
            values = cells_value if isinstance(cells_value, list) else ([] if cells_value is None else [cells_value])
            raw_cells = [_raw_cell(value) for value in values]
            if len(raw_cells) != expected:
                mismatch = (len(raw_cells), expected)
            cells = raw_cells[:expected] + [RawCell(None) for _ in range(expected - len(raw_cells))]
            extra = raw_cells[expected:]
        rows.append(
            RawRow(
                row_id=f"r{position}",
                source_line=_optional_int(item.get("source_line")) or position,
                y_center=_optional_ratio(item.get("y_center")),
                cells=cells,
                extra_cells=extra,
                length_mismatch=mismatch,
            )
        )
    headers = output.get("headers_seen")
    headers_seen = [str(header).strip() for header in headers if str(header).strip()] if isinstance(headers, list) else []
    notes = output.get("notes")
    return ParsedModelTable(rows, headers_seen, notes.strip() or None if isinstance(notes, str) else None, warnings)


def raw_rows_from_result(table_result: dict[str, Any], table: TableSpec) -> list[RawRow]:
    """Rebuild raw rows from a stored TableResult (re-validation after a reviewer's edits)."""
    rows: list[RawRow] = []
    for row in table_result.get("rows") or []:
        cells_by_key = row.get("cells") or {}
        cells = []
        for column in table.columns:
            cell = cells_by_key.get(column.key) or {}
            cells.append(RawCell(cell.get("raw"), cell.get("confidence"), "corrected" in (cell.get("flags") or [])))
        flags = row.get("flags") or []
        mismatch = None
        if "cells_length_mismatch" in flags:
            got = next(
                (violation.get("got") for violation in row.get("violations") or [] if violation.get("rule") == "cells_length_mismatch"), None
            )
            mismatch = (int(got) if isinstance(got, int) else -1, len(table.columns))
        rows.append(
            RawRow(
                row_id=str(row.get("row_id")),
                source_line=row.get("source_line"),
                y_center=row.get("y_center"),
                cells=cells,
                extra_cells=[RawCell(cell.get("raw"), cell.get("confidence")) for cell in row.get("extra_cells") or []],
                length_mismatch=mismatch,
                added="added" in flags,
                edited="edited" in flags,
            )
        )
    return rows


# --- table build & validation ---------------------------------------------------------------


def _norm_header(text: str) -> str:
    return re.sub(r"[\s()\[\]{}·:._\-/]+", "", _fold(text))


def compute_header_match(table: TableSpec, headers_seen: list[str]) -> dict[str, Any] | None:
    """Columns whose key or header_path appears among the headers the model saw (best effort)."""
    seen = [(header, _norm_header(header)) for header in headers_seen if _norm_header(header)]
    if not seen:
        return None
    used: set[int] = set()
    missing: list[str] = []
    matched = 0
    for column in table.columns:
        candidates = {_norm_header(column.key), *(_norm_header(part) for part in column.header_path)} - {""}
        hits = [
            index
            for index, (_, normalized) in enumerate(seen)
            if any(normalized == candidate or (len(candidate) >= 2 and len(normalized) >= 2 and (candidate in normalized or normalized in candidate)) for candidate in candidates)
        ]
        if hits:
            matched += 1
            used.update(hits)
        else:
            missing.append(column.key)
    extra = [header for index, (header, _) in enumerate(seen) if index not in used]
    return {"matched": matched, "missing": missing, "extra": extra}


def _is_blank(row: RawRow) -> bool:
    return all(not (cell.raw or "").strip() for cell in [*row.cells, *row.extra_cells])


def _numeric(cell: dict[str, Any]) -> float | None:
    value = cell.get("value")
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str) and value.strip():
        parsed, _ = parse_number(value)
        return float(parsed) if parsed is not None else None
    return None


def _hashable(value: Any) -> Any:
    if isinstance(value, list):
        return tuple(value)
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value


def _apply_rules(table: TableSpec, data_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    for rule in table.rules:
        if rule.kind == "row_formula" and rule.expression:
            formula = parse_formula(rule.expression)
            names = sorted(formula.names())
            evaluated = 0
            violations = 0
            for row in data_rows:
                values = {name: _numeric(row["cells"].get(name, {})) for name in names}
                left, right = evaluate(formula.left, values), evaluate(formula.right, values)
                if left is None or right is None:
                    continue
                evaluated += 1
                if abs(left - right) > rule.tolerance + 1e-9:
                    violations += 1
                    row["violations"].append(
                        {
                            "rule": "row_formula",
                            "message": rule.message or f"{rule.expression} ({_fmt(left)} ≠ {_fmt(right)})",
                            "columns": names,
                        }
                    )
            checks.append(
                {
                    "rule": "row_formula",
                    "status": "failed" if violations else ("ok" if evaluated else "skipped"),
                    "expression": rule.expression,
                    "columns": names,
                    "violation_count": violations,
                    "message": None if evaluated else "No row had every operand",
                }
            )
        elif rule.kind == "unique":
            groups: dict[Any, list[dict[str, Any]]] = {}
            for row in data_rows:
                values = [row["cells"].get(column, {}).get("value") for column in rule.columns]
                if any(value is None or value == "" or value == [] for value in values):
                    continue
                groups.setdefault(tuple(_hashable(value) for value in values), []).append(row)
            violations = 0
            for duplicates in groups.values():
                if len(duplicates) < 2:
                    continue
                lines = ", ".join(str(row["row_index"]) for row in duplicates)
                for row in duplicates:
                    violations += 1
                    row["violations"].append(
                        {
                            "rule": "unique",
                            "message": rule.message or f"Duplicate {' + '.join(rule.columns)} (rows {lines})",
                            "columns": list(rule.columns),
                        }
                    )
            checks.append({"rule": "unique", "status": "failed" if violations else "ok", "columns": list(rule.columns), "violation_count": violations})
    return checks


def _row_count_check(table: TableSpec, count: int) -> dict[str, Any]:
    mode, expected = table.row_count.mode, table.row_count.value
    if mode == "unknown" or expected is None:
        return {"rule": "row_count", "status": "skipped", "actual": count}
    failed = count != expected if mode == "exact" else count > expected
    message = None
    if failed:
        message = f"Expected {'exactly' if mode == 'exact' else 'at most'} {expected} row(s), found {count}"
    return {"rule": "row_count", "status": "failed" if failed else "ok", "expected": expected, "actual": count, "message": message}


def _fmt(value: float) -> str:
    return f"{value:g}"


def build_table_result(
    table: TableSpec,
    raw_rows: list[RawRow],
    *,
    region_used: dict[str, Any] | None = None,
    header_match: dict[str, Any] | None = None,
    model_notes: str | None = None,
    warnings: list[str] | None = None,
) -> dict[str, Any]:
    """Normalize, validate and summarize one table (a ``TableResult`` dict)."""
    columns = table.columns
    table_warnings = list(warnings or [])
    rows: list[dict[str, Any]] = []
    data_rows: list[dict[str, Any]] = []
    previous: dict[str, dict[str, Any]] | None = None
    for raw_row in raw_rows:
        blank = _is_blank(raw_row) and not raw_row.length_mismatch
        if blank and table.blank_rows == "skip" and not raw_row.added:
            continue
        cells: dict[str, dict[str, Any]] = {}
        for column, raw_cell in zip(columns, raw_row.cells, strict=True):
            confidence = 1.0 if raw_cell.corrected else raw_cell.conf
            text = raw_cell.raw.strip() if isinstance(raw_cell.raw, str) else ""
            if text and is_ditto(text) and column.ditto == "fill_from_above":
                above = previous.get(column.key) if previous else None
                if above and "empty" not in above["flags"] and above.get("value") not in (None, []):
                    confidences = [value for value in (confidence, above.get("confidence")) if value is not None]
                    cell_confidence = min(confidences) if confidences else None
                    flags = ["ditto_resolved"]
                    if cell_confidence is not None and cell_confidence < LOW_CONFIDENCE_THRESHOLD:
                        flags.append("low_confidence")
                    cell = {"value": above["value"], "raw": raw_cell.raw, "confidence": cell_confidence, "flags": flags}
                else:
                    cell = {"value": None, "raw": raw_cell.raw, "confidence": confidence, "flags": ["ditto_unresolved"]}
            elif text and is_ditto(text):
                cell = {"value": text, "raw": raw_cell.raw, "confidence": confidence, "flags": ["ditto"]}
            else:
                cell = normalize_cell(column, raw_cell.raw, confidence)
            if raw_cell.corrected:
                cell["flags"] = [flag for flag in cell["flags"] if flag != "low_confidence"] + ["corrected"]
            if raw_row.length_mismatch and not raw_row.edited:
                cell["flags"].append("unaligned")
            cells[column.key] = cell
        row_flags: list[str] = []
        violations: list[dict[str, Any]] = []
        if blank:
            row_flags.append("blank")
        if raw_row.length_mismatch and not raw_row.edited:
            got, expected = raw_row.length_mismatch
            row_flags.append("cells_length_mismatch")
            table_warnings.append(f"Row at line {raw_row.source_line}: model returned {got} cell(s) for {expected} column(s)")
            violations.append(
                {
                    "rule": "cells_length_mismatch",
                    "message": f"Model returned {got} cell(s) for {expected} column(s); cells are matched by position only",
                    "columns": [],
                    "got": got,
                }
            )
        if raw_row.added:
            row_flags.append("added")
        if raw_row.edited:
            row_flags.append("edited")
        row = {
            "row_id": raw_row.row_id,
            "row_index": None,
            "source_line": raw_row.source_line,
            "y_center": raw_row.y_center,
            "status": "ok",
            "flags": row_flags,
            "cells": cells,
            "extra_cells": [{"value": None, "raw": cell.raw, "confidence": cell.conf, "flags": ["extra"]} for cell in raw_row.extra_cells],
            "violations": violations,
        }
        rows.append(row)
        if blank:
            continue
        row["row_index"] = len(data_rows) + 1
        for column in columns:
            if column.required and "empty" in cells[column.key]["flags"]:
                violations.append({"rule": "required", "message": f"'{column.key}' is required", "columns": [column.key]})
        data_rows.append(row)
        previous = cells

    table_checks = [_row_count_check(table, len(data_rows)), *_apply_rules(table, data_rows)]
    for row in rows:
        review = bool(row["violations"]) or any(REVIEW_CELL_FLAGS.intersection(cell["flags"]) for cell in row["cells"].values())
        row["status"] = "needs_review" if review else "ok"
    if not data_rows:
        table_warnings.append("No rows were extracted")
    needs_review = (
        any(row["status"] != "ok" for row in rows)
        or any(check["status"] == "failed" for check in table_checks)
        or not data_rows
        or bool(table_warnings)
    )
    return {
        "table_key": table.key,
        "table_name": table.name,
        "status": "needs_review" if needs_review else "ok",
        "row_count": len(data_rows),
        "expected_rows": {"mode": table.row_count.mode, "value": table.row_count.value},
        "columns": table.column_keys,
        "header_match": header_match,
        "region_used": region_used,
        "rows": rows,
        "table_checks": table_checks,
        "warnings": table_warnings,
        "model_notes": model_notes,
        "error": None,
    }


def failed_table_result(table: TableSpec, error: str, region_used: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "table_key": table.key,
        "table_name": table.name,
        "status": "failed",
        "row_count": 0,
        "expected_rows": {"mode": table.row_count.mode, "value": table.row_count.value},
        "columns": table.column_keys,
        "header_match": None,
        "region_used": region_used,
        "rows": [],
        "table_checks": [],
        "warnings": [error],
        "model_notes": None,
        "error": error,
    }


def table_result_from_model(table: TableSpec, output: Any, region_used: dict[str, Any] | None) -> dict[str, Any]:
    parsed = parse_model_output(table, output)
    return build_table_result(
        table,
        parsed.rows,
        region_used=region_used,
        header_match=compute_header_match(table, parsed.headers_seen),
        model_notes=parsed.notes,
        warnings=parsed.warnings,
    )


def revalidate_table_result(table: TableSpec, table_result: dict[str, Any], raw_rows: list[RawRow] | None = None) -> dict[str, Any]:
    """Re-run normalization and validation over a (corrected) TableResult, keeping its metadata."""
    if table_result.get("status") == "failed" and not (raw_rows or table_result.get("rows")):
        return table_result
    rebuilt = build_table_result(
        table,
        raw_rows if raw_rows is not None else raw_rows_from_result(table_result, table),
        region_used=table_result.get("region_used"),
        header_match=table_result.get("header_match"),
        model_notes=table_result.get("model_notes"),
        warnings=[warning for warning in table_result.get("warnings") or [] if warning != "No rows were extracted" and not warning.startswith("Row at line ")],
    )
    return rebuilt


def table_warnings(tables: list[dict[str, Any]]) -> list[str]:
    """Flat ``"table_key: message"`` list of table warnings and failed checks (``validation_warnings``)."""
    messages: list[str] = []
    for table in tables:
        key = table.get("table_key")
        messages.extend(f"{key}: {warning}" for warning in table.get("warnings") or [])
        messages.extend(f"{key}: {check['message']}" for check in table.get("table_checks") or [] if check.get("status") == "failed" and check.get("message"))
    return messages


def job_status_for_tables(tables: list[dict[str, Any]]) -> str:
    """``failed`` when every table failed, ``needs_review`` when any is not ok, else ``completed``."""
    if tables and all(table.get("status") == "failed" for table in tables):
        return "failed"
    if any(table.get("status") != "ok" for table in tables):
        return "needs_review"
    return "completed"
