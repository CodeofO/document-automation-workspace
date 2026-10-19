// 표 추출(Table Extraction) API 타입. 기준: docs/table-extraction-api.md, 생성 타입(src/api/schema.d.ts, `npm run gen:api`).
// 서버(pydantic)는 기본값이 있는 필드도 응답에 항상 담는다. 생성 타입은 그런 필드를 optional로 두므로,
// 화면에서는 Filled<>로 "응답에 항상 있는" 모양으로 좁혀 쓴다. 편집기 초안도 같은 모양(모든 필드 채움)이고,
// 그대로 요청 바디(생성 타입)에 넣을 수 있다(아래 컴파일 검사).
import type { Schemas } from "../../api/client";

/** optional 필드를 모두 채운 모양(값은 null일 수 있음). */
type Filled<T> = { [K in keyof T]-?: Exclude<T[K], undefined> };

export type TableColumnType = Schemas["ColumnSpec"]["type"];
export const TABLE_COLUMN_TYPES: TableColumnType[] = ["text", "number", "date", "time", "choice", "checkbox"];

export type TableRegion = Schemas["TableRegion"];
export type RowCountMode = Schemas["RowCountSpec"]["mode"];
export type RowCountSpec = Filled<Schemas["RowCountSpec"]>;
export type TableColumnSpec = Filled<Schemas["ColumnSpec"]>;
export type TableRuleKind = Schemas["RuleSpec"]["kind"];
export type TableRuleSpec = Filled<Schemas["RuleSpec"]>;

export type TableSpec = Omit<Filled<Schemas["TableSpec"]>, "row_count" | "columns" | "rules"> & {
  row_count: RowCountSpec;
  columns: TableColumnSpec[];
  rules: TableRuleSpec[];
};

export type SampleRef = Schemas["SampleRef"];

export type TableTemplate = Omit<Schemas["TableTemplateRead"], "tables"> & { tables: TableSpec[] };

export type TableTemplatePayload = Omit<Schemas["TableTemplateCreate"], "pinned" | "tables" | "sample_refs"> & {
  tables: TableSpec[];
  sample_refs: SampleRef[];
  pinned?: boolean;
};

export type TableRecommendationRequest = Schemas["TableRecommendationRequest"];
export type TableRecommendation = Schemas["TableRecommendationRead"];

// ---- 결과 ----

export type TableCell = Filled<Schemas["TableCell"]>;
export type RowViolation = Filled<Schemas["RowViolation"]>;
export type TableRowStatus = Schemas["TableRow"]["status"];

export type TableRow = Omit<Filled<Schemas["TableRow"]>, "cells" | "extra_cells" | "violations"> & {
  cells: Record<string, TableCell>;
  extra_cells?: TableCell[];
  violations: RowViolation[];
};

export type RegionUsed = Schemas["RegionUsed"];
export type TableCheck = Schemas["TableCheck"];

export type TableResult = Omit<
  Filled<Schemas["TableResult"]>,
  "rows" | "expected_rows" | "header_match" | "model_notes" | "error"
> & {
  expected_rows: RowCountSpec;
  header_match: Filled<Schemas["HeaderMatch"]> | null;
  rows: TableRow[];
  model_notes?: string | null;
  error?: string | null;
};

export type TableEditLogEntry = Schemas["TableEditLogEntry"];

export type TableExtractionResult = Omit<
  Filled<Schemas["TableExtractionResultRead"]>,
  "tables" | "corrected_tables"
> & {
  tables: TableResult[];
  corrected_tables: TableResult[] | null;
};

export type TableExtractionJob = Omit<
  Filled<Schemas["TableExtractionJobRead"]>,
  "definition_snapshot" | "result" | "page_jobs"
> & {
  definition_snapshot: { tables: TableSpec[] };
  result: TableExtractionResult | null;
  page_jobs: Schemas["PageJobRef"][];
};

export type TableCellEdit = Schemas["TableCellEdit"];
export type TableRowAdd = Schemas["TableRowAdd"];
export type TableRowDelete = Schemas["TableRowDelete"];
export type TableExtractionResultPatch = Schemas["TableExtractionResultPatch"];

export type TableExtractionBatchItem = Filled<Schemas["TableExtractionBatchItemRead"]>;
export type TableExtractionBatch = Omit<Schemas["TableExtractionBatchRead"], "items"> & {
  items: TableExtractionBatchItem[];
};

// 편집기 초안이 그대로 요청 바디가 되는지 컴파일 때 확인한다(서버 계약이 바뀌면 여기서 깨진다).
type Assignable<T extends U, U> = T;
export type _SpecMatchesApi = Assignable<TableSpec, Schemas["TableSpec"]>;
export type _PayloadMatchesApi = Assignable<TableTemplatePayload & { pinned: boolean }, Schemas["TableTemplateCreate"]>;

/** 워크플로우 run item의 node_results[nodeId] (kind "table"). 계약: docs/table-extraction-api.md §8. */
export type WorkflowTableNodeResult = {
  kind: "table";
  status?: "completed" | "needs_review" | "failed" | string;
  job_id?: string | null;
  result_id?: string | null;
  template_id?: string | null;
  template_version?: number | null;
  tables?: {
    key: string;
    name: string;
    status?: "ok" | "needs_review" | "failed";
    row_count: number;
    review_cells: number;
    violations: number;
  }[];
  error_message?: string | null;
};
