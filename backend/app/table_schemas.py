"""Request/response models of the table extraction API (docs/table-extraction-api.md)."""

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.domain.table_spec import TableRegion, TableSpec, TableTemplateDefinition
from app.schemas import DocumentSelectionRequest, PageJobRef

# --- templates ------------------------------------------------------------------------------


class SampleRef(BaseModel):
    document_id: str
    page_number: int = Field(default=1, ge=1)


class TableTemplateCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    display_name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    tables: list[TableSpec] = Field(default_factory=list)
    sample_refs: list[SampleRef] = Field(default_factory=list, max_length=10)
    pinned: bool = False

    @field_validator("name")
    @classmethod
    def _name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("name must not be blank")
        return value

    def definition(self) -> TableTemplateDefinition:
        return TableTemplateDefinition(tables=self.tables)


class TableTemplateUpdate(BaseModel):
    """Every field optional. ``current_version`` grows by one when ``tables`` changes."""

    name: str | None = Field(default=None, min_length=1, max_length=120)
    display_name: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    tables: list[TableSpec] | None = None
    sample_refs: list[SampleRef] | None = Field(default=None, max_length=10)
    pinned: bool | None = None


class TableTemplateRead(BaseModel):
    id: str
    name: str
    display_name: str | None
    description: str | None
    current_version: int
    tables: list[TableSpec]
    sample_refs: list[SampleRef]
    pinned: bool
    ephemeral: bool
    archived: bool
    created_at: datetime
    updated_at: datetime


class TableRecommendationRequest(BaseModel):
    document_id: str
    page_number: int = Field(default=1, ge=1)
    region: TableRegion | None = None
    table_description: str | None = Field(default=None, max_length=2000)


class TableRecommendationRead(BaseModel):
    table: TableSpec
    reasoning: str | None = None


# --- results (TableResult, design §4) -------------------------------------------------------

CellFlag = str  # see docs/table-extraction-api.md "Cell flags"


class TableCell(BaseModel):
    value: Any = None  # str | float | list[str] | None (null when conversion failed or the cell is empty)
    raw: str | None = None  # what the model read, verbatim
    confidence: float | None = None
    flags: list[CellFlag] = Field(default_factory=list)


class RowViolation(BaseModel):
    rule: str  # row_formula | unique | required | cells_length_mismatch
    message: str
    columns: list[str] = Field(default_factory=list)


class TableRow(BaseModel):
    row_id: str  # stable id inside the result ("r1".., rows added by a reviewer "a1"..)
    row_index: int | None  # 1-based data row number (blank rows excluded → null)
    source_line: int | None  # 1-based line on the form, blank lines included
    y_center: float | None = None  # vertical position inside the region used (0~1), best effort
    status: Literal["ok", "needs_review", "rejected"] = "ok"
    flags: list[str] = Field(default_factory=list)  # blank | cells_length_mismatch | added | edited
    cells: dict[str, TableCell]
    extra_cells: list[TableCell] = Field(default_factory=list)  # cells beyond the column count (length mismatch)
    violations: list[RowViolation] = Field(default_factory=list)


class HeaderMatch(BaseModel):
    matched: int
    missing: list[str] = Field(default_factory=list)
    extra: list[str] = Field(default_factory=list)


class RegionUsed(BaseModel):
    x: float
    y: float
    width: float
    height: float
    padding: float


class ExpectedRows(BaseModel):
    mode: Literal["exact", "max", "unknown"]
    value: int | None = None


class TableCheck(BaseModel):
    rule: str  # row_count | row_formula | unique
    status: Literal["ok", "failed", "skipped"]
    message: str | None = None
    expression: str | None = None
    columns: list[str] = Field(default_factory=list)
    expected: int | None = None
    actual: int | None = None
    violation_count: int = 0


class TableResult(BaseModel):
    table_key: str
    table_name: str
    status: Literal["ok", "needs_review", "failed"]
    row_count: int  # data rows (blank rows excluded)
    expected_rows: ExpectedRows
    columns: list[str]
    header_match: HeaderMatch | None = None
    region_used: RegionUsed | None = None  # null = the whole page was read
    rows: list[TableRow] = Field(default_factory=list)
    table_checks: list[TableCheck] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    model_notes: str | None = None
    error: str | None = None  # set when status == "failed" (this table's model call failed)


class TableEditLogEntry(BaseModel):
    at: datetime
    action: Literal["edit", "add_row", "delete_row", "reviewed"]
    table_key: str | None = None
    row_id: str | None = None
    row_index: int | None = None
    column: str | None = None
    before: Any = None
    after: Any = None


class TableExtractionResultRead(BaseModel):
    id: str
    job_id: str
    raw_model_output: dict[str, Any]
    tables: list[TableResult]
    corrected_tables: list[TableResult] | None = None
    edit_log: list[TableEditLogEntry] = Field(default_factory=list)
    reviewed: bool = False
    validation_warnings: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class TableCellEdit(BaseModel):
    table_key: str
    row_id: str | None = None  # preferred; or row_index
    row_index: int | None = Field(default=None, ge=1)
    column: str
    value: Any = None  # text as a person would type it; re-normalized with the column type


class TableRowAdd(BaseModel):
    table_key: str
    after_row_id: str | None = None  # insert after this row; both null → append
    after_row_index: int | None = Field(default=None, ge=0)  # 0 = insert at the top
    cells: dict[str, Any] = Field(default_factory=dict)


class TableRowDelete(BaseModel):
    table_key: str
    row_id: str | None = None
    row_index: int | None = Field(default=None, ge=1)


class TableExtractionResultPatch(BaseModel):
    edits: list[TableCellEdit] = Field(default_factory=list)
    add_rows: list[TableRowAdd] = Field(default_factory=list)
    delete_rows: list[TableRowDelete] = Field(default_factory=list)
    reviewed: bool | None = None


# --- jobs -----------------------------------------------------------------------------------


class TableExtractionJobCreate(BaseModel):
    document_id: str
    # Omitted: page 1 of a single-page document, or one job per page (response = page 1 job + ``page_jobs``).
    page_number: int | None = Field(default=None, ge=1)
    template_id: str
    table_keys: list[str] | None = None  # run only these tables (null = all)


class TableDraftDefinition(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    tables: list[TableSpec] = Field(min_length=1)

    def definition(self) -> TableTemplateDefinition:
        return TableTemplateDefinition(tables=self.tables)


class TableExtractionDraftJobCreate(BaseModel):
    document_id: str
    page_number: int | None = Field(default=None, ge=1)
    definition: TableDraftDefinition
    table_keys: list[str] | None = None


class TableExtractionJobRead(BaseModel):
    job_id: str
    document_id: str
    page_number: int | None = None
    template_id: str
    template_version: int
    table_keys: list[str] | None = None
    definition_snapshot: TableTemplateDefinition
    status: str
    error_message: str | None
    result_id: str | None
    result: TableExtractionResultRead | None = None
    created_at: datetime
    started_at: datetime | None
    completed_at: datetime | None
    page_jobs: list[PageJobRef] = Field(default_factory=list)


# --- batches --------------------------------------------------------------------------------


class TableExtractionBatchFromDocumentsRequest(DocumentSelectionRequest):
    template_id: str


class TableExtractionBatchItemRead(BaseModel):
    id: str
    document_id: str
    page_number: int | None = None
    job_id: str
    filename: str
    upload_index: int | None = None
    status: str
    result_id: str | None = None
    error_message: str | None = None
    created_at: datetime


class TableExtractionBatchRead(BaseModel):
    id: str
    template_id: str
    template_version: int = 1
    status: str
    total_count: int
    completed_count: int
    failed_count: int
    canceled_count: int
    uploaded_count: int = 0
    preprocessing_count: int = 0
    ready_count: int = 0
    queued_count: int = 0
    running_count: int = 0
    needs_review_count: int = 0
    progress_phase: str = "queued"
    progress: float
    items: list[TableExtractionBatchItemRead]
    created_at: datetime
    completed_at: datetime | None
