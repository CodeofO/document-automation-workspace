"""Table extraction definitions (docs/table-extraction-design.md §2).

A table template (``TableTemplate.definition_json``) is ``{"tables": [TableSpec, ...]}``. One
TableSpec describes one repeating-row table on a page: its columns (``ColumnSpec``), an
optional region and row rules (``RuleSpec``). These models are used both for request
validation and for reading stored definitions/snapshots back.
"""

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator, model_validator

from app.domain.table_formula import FormulaError, parse_formula

ColumnType = Literal["text", "number", "date", "time", "choice", "checkbox"]
COLUMN_TYPES: tuple[str, ...] = ("text", "number", "date", "time", "choice", "checkbox")

MAX_TABLES_PER_TEMPLATE = 20
MAX_COLUMNS_PER_TABLE = 60
_RATIO_EPSILON = 1e-6


def _strip(value: str | None) -> str | None:
    if value is None:
        return None
    stripped = value.strip()
    return stripped or None


class TableRegion(BaseModel):
    """Rectangle in page ratios (0~1, origin top-left) on the rotation-corrected page image."""

    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(gt=0, le=1)
    height: float = Field(gt=0, le=1)

    @model_validator(mode="after")
    def _inside_page(self) -> "TableRegion":
        if self.x + self.width > 1 + _RATIO_EPSILON or self.y + self.height > 1 + _RATIO_EPSILON:
            raise ValueError("region must lie inside the page (x + width <= 1, y + height <= 1)")
        return self


class RowCountSpec(BaseModel):
    mode: Literal["exact", "max", "unknown"] = "unknown"
    value: int | None = Field(default=None, ge=1, le=1000)

    @model_validator(mode="after")
    def _value_for_mode(self) -> "RowCountSpec":
        if self.mode in {"exact", "max"} and self.value is None:
            raise ValueError(f"row_count.value is required when mode is {self.mode}")
        if self.mode == "unknown":
            self.value = None
        return self


class ColumnSpec(BaseModel):
    key: str = Field(min_length=1, max_length=120)
    header_path: list[str] = Field(default_factory=list, max_length=4)
    description: str | None = Field(default=None, max_length=1000)
    type: ColumnType = "text"
    # ``choice``: allowed values. ``choice_allow_number`` additionally accepts a number (e.g. 잔량 = "완" or a number).
    choices: list[str] = Field(default_factory=list, max_length=100)
    choice_allow_number: bool = False
    # ``checkbox``: the boxes of the group; the value is the list of marked ones.
    checkbox_options: list[str] = Field(default_factory=list, max_length=100)
    # ``number``: how '.' and ',' are read. ``auto`` = see app.domain.table_normalization.parse_number.
    number_format: Literal["auto", "dot_decimal", "dot_thousands"] = "auto"
    # Keep the model's verbatim text next to the parsed value in exports (``raw`` is always stored in results).
    keep_raw: bool = True
    ditto: Literal["fill_from_above", "keep"] = "fill_from_above"
    required: bool = False

    @field_validator("key")
    @classmethod
    def _key(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("column key must not be blank")
        return value

    @field_validator("description")
    @classmethod
    def _description(cls, value: str | None) -> str | None:
        return _strip(value)

    @field_validator("header_path", "choices", "checkbox_options")
    @classmethod
    def _text_list(cls, values: list[str]) -> list[str]:
        return [value.strip() for value in values if value and value.strip()]

    @model_validator(mode="after")
    def _type_options(self) -> "ColumnSpec":
        if self.type == "choice" and not self.choices and not self.choice_allow_number:
            raise ValueError(f"column '{self.key}': a choice column needs at least one choice")
        if len(set(self.choices)) != len(self.choices):
            raise ValueError(f"column '{self.key}': choices must be unique")
        if len(set(self.checkbox_options)) != len(self.checkbox_options):
            raise ValueError(f"column '{self.key}': checkbox_options must be unique")
        return self


class RuleSpec(BaseModel):
    """Row validation rule.

    * ``row_formula``: ``expression`` like ``"주입중량 = 단중 * 실적"`` (one ``=``; ``+ - * /``, parentheses,
      numbers and column keys; a key containing spaces or operators is written ``[key]``).
      A row violates it when ``|left - right| > tolerance`` (absolute). Rows with a missing operand are skipped.
    * ``unique``: the combination of ``columns`` must not repeat across data rows.
    * ``row_count``: checks ``TableSpec.row_count`` (always evaluated; listing it is optional).
    """

    kind: Literal["row_formula", "unique", "row_count"]
    expression: str | None = Field(default=None, max_length=500)
    tolerance: float = Field(default=0.01, ge=0)
    columns: list[str] = Field(default_factory=list, max_length=20)
    message: str | None = Field(default=None, max_length=300)

    @model_validator(mode="after")
    def _params(self) -> "RuleSpec":
        if self.kind == "row_formula":
            if not self.expression or not self.expression.strip():
                raise ValueError("row_formula rule needs an expression")
            try:
                parse_formula(self.expression)
            except FormulaError as exc:
                raise ValueError(f"row_formula expression is invalid: {exc}") from exc
        if self.kind == "unique" and not self.columns:
            raise ValueError("unique rule needs at least one column")
        self.columns = [column.strip() for column in self.columns if column.strip()]
        return self

    def referenced_columns(self) -> set[str]:
        if self.kind == "row_formula" and self.expression:
            return parse_formula(self.expression).names()
        if self.kind == "unique":
            return set(self.columns)
        return set()


class TableSpec(BaseModel):
    key: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = Field(default=None, max_length=2000)
    region: TableRegion | None = None
    region_padding: float = Field(default=0.05, ge=0, le=0.5)
    end_hint: str | None = Field(default=None, max_length=500)
    row_count: RowCountSpec = Field(default_factory=RowCountSpec)
    blank_rows: Literal["skip", "keep"] = "skip"
    row_unit_hint: str | None = Field(default=None, max_length=500)
    columns: list[ColumnSpec] = Field(min_length=1, max_length=MAX_COLUMNS_PER_TABLE)
    rules: list[RuleSpec] = Field(default_factory=list, max_length=30)

    @field_validator("key", "name")
    @classmethod
    def _required_text(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("must not be blank")
        return value

    @field_validator("description", "end_hint", "row_unit_hint")
    @classmethod
    def _optional_text(cls, value: str | None) -> str | None:
        return _strip(value)

    @model_validator(mode="after")
    def _columns_and_rules(self) -> "TableSpec":
        keys = [column.key for column in self.columns]
        duplicates = sorted({key for key in keys if keys.count(key) > 1})
        if duplicates:
            raise ValueError(f"table '{self.key}': column keys must be unique ({', '.join(duplicates)})")
        known = set(keys)
        for rule in self.rules:
            missing = sorted(rule.referenced_columns() - known)
            if missing:
                raise ValueError(f"table '{self.key}': {rule.kind} rule references unknown column(s): {', '.join(missing)}")
        return self

    @property
    def column_keys(self) -> list[str]:
        return [column.key for column in self.columns]


class TableTemplateDefinition(BaseModel):
    """``TableTemplate.definition_json``. A saved template may have no tables yet (editor drafts)."""

    tables: list[TableSpec] = Field(default_factory=list, max_length=MAX_TABLES_PER_TEMPLATE)

    @model_validator(mode="after")
    def _unique_table_keys(self) -> "TableTemplateDefinition":
        keys = [table.key for table in self.tables]
        duplicates = sorted({key for key in keys if keys.count(key) > 1})
        if duplicates:
            raise ValueError(f"table keys must be unique within a template ({', '.join(duplicates)})")
        return self


def load_definition(data: Any) -> TableTemplateDefinition:
    """Parse stored ``definition_json`` / ``definition_snapshot`` (``None`` → no tables)."""
    if not data:
        return TableTemplateDefinition()
    return TableTemplateDefinition.model_validate(data)


def select_tables(definition: TableTemplateDefinition, table_keys: list[str] | None) -> list[TableSpec]:
    """The tables a job runs: all, or the listed subset in definition order. Unknown keys raise ``ValueError``."""
    if table_keys is None:
        return list(definition.tables)
    known = {table.key for table in definition.tables}
    unknown = [key for key in table_keys if key not in known]
    if unknown:
        raise ValueError(f"Unknown table key(s): {', '.join(unknown)}")
    wanted = set(table_keys)
    return [table for table in definition.tables if table.key in wanted]
