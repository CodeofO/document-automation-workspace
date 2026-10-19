"""Prompt and structured output for table extraction (one model call per TableSpec).

The model only transcribes: per row it returns the cells in column order (``raw`` text exactly
as written + ``conf``). Types, ditto marks, rules and statuses are handled by the server
(``app.domain.table_normalization``), which keeps the response format simple enough for the
local raw-JSON VLM path as well.
"""

from typing import Any

from app.domain.table_spec import ColumnSpec, TableSpec

TABLE_SYSTEM_PROMPT = """You are a careful transcription engine for tables in scanned business forms (ledgers, logs, test reports).
You copy what is written in a table row by row, cell by cell. You never invent rows or values.
Handwriting rules:
- Transcribe every cell exactly as written. Keep digits, decimal points, commas, units and letters as they appear; do not convert, round or reformat.
- Ditto marks (〃, ", ″, ゝ and similar) are written as the mark itself; do not replace them with the value above.
- When a value was crossed out and corrected, return only the final (corrected) value.
- For characters you cannot read, write ? for each unreadable character instead of guessing.
- An empty cell is {"raw": null, "conf": <how sure you are that it is empty>}.
Return data that matches the requested structured output schema."""


def _column_line(index: int, column: ColumnSpec) -> str:
    parts = [f"{index}. {column.key}"]
    if column.header_path:
        parts.append(f"header: {' > '.join(column.header_path)}")
    if column.description:
        parts.append(f"hint: {column.description}")
    if column.type == "number":
        parts.append("contains a number (copy separators exactly as written)")
    elif column.type == "date":
        parts.append("contains a date (copy as written)")
    elif column.type == "time":
        parts.append("contains a time of day (copy as written)")
    elif column.type == "choice":
        allowed = ", ".join(f'"{choice}"' for choice in column.choices)
        suffix = " or a number" if column.choice_allow_number else ""
        parts.append(f"one of {allowed}{suffix}" if allowed else "a number")
    elif column.type == "checkbox":
        if column.checkbox_options:
            parts.append(
                "a group of check boxes " + ", ".join(column.checkbox_options) + "; write the names of the marked boxes separated by commas"
            )
        else:
            parts.append("check boxes; write the names of the marked boxes separated by commas")
    return " | ".join(parts)


def build_table_prompt(table: TableSpec, *, has_region_crop: bool) -> str:
    lines = [f'Table: "{table.name}" (key {table.key}).']
    if table.description:
        lines.append(f"About this table: {table.description}")
    if has_region_crop:
        lines.append(
            "The first image is a crop of the page around this table (with a small margin); read the table from it. "
            "The second image is the whole page, downscaled, only for orientation."
        )
    else:
        lines.append("The image is the whole page; find this table on it using the description and the column headers.")
    lines.append(f"Columns, in this exact order ({len(table.columns)} cells per row):")
    lines.extend(_column_line(index, column) for index, column in enumerate(table.columns, start=1))
    if table.row_unit_hint:
        lines.append(f"One row is: {table.row_unit_hint}")
    if table.end_hint:
        lines.append(f"Where the table ends: {table.end_hint}. Do not return totals, notes or anything after that point as rows.")
    else:
        lines.append("Do not return header rows, total/sum rows or notes as data rows.")
    if table.blank_rows == "keep":
        lines.append("Return empty ruled lines between data rows as rows whose cells are all null.")
    else:
        lines.append("Skip completely empty lines, but still count them in source_line.")
    if table.row_count.mode == "exact":
        lines.append(f"The table has exactly {table.row_count.value} data rows.")
    elif table.row_count.mode == "max":
        lines.append(f"The table has at most {table.row_count.value} rows; many of them may be empty.")
    lines.extend(
        [
            "For every row return:",
            "- source_line: the 1-based line number of the row inside the table body (empty lines included);",
            "- y_center: the vertical centre of the row as a fraction (0-1) of the first image's height;",
            f"- cells: exactly {len(table.columns)} objects in the column order above, each {{\"raw\": text or null, \"conf\": 0-1}}.",
            "Also return headers_seen (the column header texts you can read, left to right) and notes (anything unusual, or null).",
        ]
    )
    return "\n".join(lines)


def _nullable(json_type: str) -> dict[str, Any]:
    return {"type": [json_type, "null"]}


def table_output_schema(table: TableSpec, *, enforce_length: bool = True) -> dict[str, Any]:
    """Plain JSON schema ``{"headers_seen": [str], "rows": [{source_line, y_center, cells: [Cell × N]}], "notes": str|null}``.

    ``cells`` carries ``minItems = maxItems = len(columns)`` as *guidance* for providers that honour
    it (OpenAI strict json_schema, Gemini ``response_json_schema``, the local raw-JSON prompt).
    The schema is deliberately a dict, not a pydantic model: the response is parsed as a plain
    dict and never validated against the length, so a row with too few/many cells reaches the
    server-side normalization, which flags it (``cells_length_mismatch``) instead of failing the
    whole table. ``enforce_length=False`` drops the two keywords for providers that reject them.
    """
    count = len(table.columns)
    cells: dict[str, Any] = {
        "type": "array",
        "description": f"Exactly {count} cells, in column order.",
        "items": {
            "type": "object",
            "additionalProperties": False,
            "required": ["raw", "conf"],
            "properties": {"raw": _nullable("string"), "conf": _nullable("number")},
        },
    }
    if enforce_length:
        cells["minItems"] = count
        cells["maxItems"] = count
    row = {
        "type": "object",
        "additionalProperties": False,
        "required": ["source_line", "y_center", "cells"],
        "properties": {"source_line": _nullable("integer"), "y_center": _nullable("number"), "cells": cells},
    }
    return {
        "title": "TableExtraction",
        "description": f"Rows of the table '{table.key}' transcribed cell by cell.",
        "type": "object",
        "additionalProperties": False,
        "required": ["headers_seen", "rows", "notes"],
        "properties": {
            "headers_seen": {"type": "array", "items": {"type": "string"}},
            "rows": {"type": "array", "items": row},
            "notes": _nullable("string"),
        },
    }


def strip_length_keywords(schema: Any) -> Any:
    """A copy of ``schema`` without ``minItems``/``maxItems`` (fallback for providers that reject them)."""
    if isinstance(schema, dict):
        return {key: strip_length_keywords(value) for key, value in schema.items() if key not in {"minItems", "maxItems"}}
    if isinstance(schema, list):
        return [strip_length_keywords(value) for value in schema]
    return schema


# --- AI column draft (POST /api/table-templates/recommendations) ----------------------------

TABLE_RECOMMENDATION_PROMPT = """You are a table schema design assistant for scanned business forms (ledgers, logs, test reports).
Look at one table and describe its structure so a user can configure row-by-row extraction.
Read the column headers exactly as printed, in the document's language and left-to-right order.
For multi-level headers, header_path lists the header texts from the top level down to the column (at most 4 levels).
Column keys are short, unique labels in the document's language (usually the lowest header text).
Choose each column type from: text, number, date, time, choice, checkbox.
Use choice only when a column holds one of a few fixed words (list them in choices); use checkbox for a group of tick boxes (list their names in checkbox_options).
Do not invent columns that are not visible. Do not transcribe data rows."""


def build_table_recommendation_prompt(*, table_description: str | None, has_region_crop: bool) -> str:
    lines: list[str] = []
    if has_region_crop:
        lines.append(
            "The first image is a crop of the page around the table (with a small margin). "
            "The second image is the whole page, downscaled, only for orientation."
        )
    else:
        lines.append("The image is the whole page. Describe the main repeating-row table on it.")
    if table_description:
        lines.append(f"The user describes the table as: {table_description}")
    lines.extend(
        [
            "Return:",
            "- name: a short display name for the table; key: a short identifier (letters, digits, underscores);",
            "- description: what one row means;",
            "- columns: every column left to right with key, header_path, type, description (a reading hint, or empty), choices, checkbox_options;",
            "- end_hint: where the data rows end (e.g. the line above a totals row), or null;",
            "- row_unit_hint: what one row is, or null;",
            "- row_count_guess: how many ruled data lines the table has (including empty ones), or null;",
            "- reasoning: one or two sentences.",
        ]
    )
    return "\n".join(lines)


def table_recommendation_output_schema() -> dict[str, Any]:
    """Plain JSON schema; the response is sanitized into a ``TableSpec`` by the application layer."""
    strings = {"type": "array", "items": {"type": "string"}}
    column = {
        "type": "object",
        "additionalProperties": False,
        "required": ["key", "header_path", "type", "description", "choices", "checkbox_options"],
        "properties": {
            "key": {"type": "string"},
            "header_path": strings,
            "type": {"type": "string", "enum": ["text", "number", "date", "time", "choice", "checkbox"]},
            "description": _nullable("string"),
            "choices": strings,
            "checkbox_options": strings,
        },
    }
    return {
        "title": "TableSchemaRecommendation",
        "description": "Structure of one repeating-row table.",
        "type": "object",
        "additionalProperties": False,
        "required": ["name", "key", "description", "columns", "end_hint", "row_unit_hint", "row_count_guess", "reasoning"],
        "properties": {
            "name": {"type": "string"},
            "key": {"type": "string"},
            "description": _nullable("string"),
            "columns": {"type": "array", "items": column},
            "end_hint": _nullable("string"),
            "row_unit_hint": _nullable("string"),
            "row_count_guess": _nullable("integer"),
            "reasoning": _nullable("string"),
        },
    }
