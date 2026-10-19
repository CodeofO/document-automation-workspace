// 표 양식(TableTemplate) 편집 규칙. React·fetch에 의존하지 않는다(테스트 대상).
import type { Schemas } from "../../../api/client";
import type {
  SampleRef,
  TableColumnSpec,
  TableColumnType,
  TableRuleSpec,
  TableSpec,
  TableTemplate,
  TableTemplatePayload
} from "../types";

export const MAX_SAMPLES = 3;
export const MAX_TABLES = 20;
export const DEFAULT_REGION_PADDING = 0.05;

export const COLUMN_TYPE_LABELS: Record<TableColumnType, string> = {
  text: "텍스트",
  number: "숫자",
  date: "날짜",
  time: "시각",
  choice: "선택",
  checkbox: "체크박스"
};

/** 편집기 초안. 저장 전 양식도 같은 모양이다(id 없음). */
export type TemplateDraft = {
  name: string;
  description: string;
  tables: TableSpec[];
  sample_refs: SampleRef[];
};

export function newColumn(key = ""): TableColumnSpec {
  return {
    key,
    header_path: [],
    description: null,
    type: "text",
    choices: [],
    choice_allow_number: false,
    checkbox_options: [],
    number_format: "auto",
    keep_raw: true,
    ditto: "fill_from_above",
    required: false
  };
}

export function newRule(kind: TableRuleSpec["kind"]): TableRuleSpec {
  return { kind, expression: kind === "row_formula" ? "" : null, tolerance: 0.01, columns: [], message: null };
}

/** 양식 안에서 쓰지 않은 표 key(table_1, table_2 …). */
export function nextTableKey(tables: Pick<TableSpec, "key">[]): string {
  const used = new Set(tables.map((table) => table.key));
  let index = tables.length + 1;
  while (used.has(`table_${index}`)) index += 1;
  return `table_${index}`;
}

export function nextColumnKey(columns: Pick<TableColumnSpec, "key">[]): string {
  const used = new Set(columns.map((column) => column.key));
  let index = columns.length + 1;
  while (used.has(`칼럼${index}`)) index += 1;
  return `칼럼${index}`;
}

/** 새 표 스키마. 칼럼 1개(칼럼1)로 시작해 바로 저장할 수 있게 한다(서버는 칼럼 ≥1을 요구). */
export function newTableSpec(tables: Pick<TableSpec, "key">[]): TableSpec {
  const key = nextTableKey(tables);
  return {
    key,
    name: `표 ${tables.length + 1}`,
    description: null,
    region: null,
    region_padding: DEFAULT_REGION_PADDING,
    end_hint: null,
    row_count: { mode: "unknown", value: null },
    blank_rows: "skip",
    row_unit_hint: null,
    columns: [newColumn("칼럼1")],
    rules: []
  };
}

/** 이름이 겹치지 않는 새 양식 이름("새 표 양식", "새 표 양식 2" …). 서버는 이름 중복을 409로 거절한다. */
export function uniqueTemplateName(existing: string[], base = "새 표 양식"): string {
  const used = new Set(existing.map((name) => name.trim()));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
}

export function emptyTemplateDraft(existingNames: string[] = []): TemplateDraft {
  return { name: uniqueTemplateName(existingNames), description: "", tables: [], sample_refs: [] };
}

export function templateToDraft(template: TableTemplate): TemplateDraft {
  return {
    name: template.name,
    description: template.description ?? "",
    tables: template.tables.map(normalizeSpecFromServer),
    sample_refs: template.sample_refs.slice(0, MAX_SAMPLES)
  };
}

/** 서버가 일부 필드를 빼고 줄 때도 편집기가 같은 모양을 쓰게 기본값을 채운다. */
export function normalizeSpecFromServer(spec: Schemas["TableSpec"]): TableSpec {
  return {
    key: spec.key,
    name: spec.name,
    description: spec.description ?? null,
    region: spec.region ?? null,
    region_padding: spec.region_padding ?? DEFAULT_REGION_PADDING,
    end_hint: spec.end_hint ?? null,
    row_count: { mode: spec.row_count?.mode ?? "unknown", value: spec.row_count?.value ?? null },
    blank_rows: spec.blank_rows ?? "skip",
    row_unit_hint: spec.row_unit_hint ?? null,
    columns: (spec.columns ?? []).map((column) => ({
      ...newColumn(column.key),
      ...column,
      header_path: column.header_path ?? [],
      description: column.description ?? null,
      choices: column.choices ?? [],
      checkbox_options: column.checkbox_options ?? []
    })),
    rules: (spec.rules ?? []).map((rule) => ({
      ...newRule(rule.kind),
      ...rule,
      expression: rule.expression ?? null,
      columns: rule.columns ?? [],
      message: rule.message ?? null
    }))
  };
}

// ---- 텍스트 입력 ↔ 목록 ----

/** 원본 머리글 경로 입력: "주입수량 › 실적" 또는 "주입수량, 실적" → ["주입수량", "실적"] (최대 4단). */
export function parseHeaderPath(text: string): string[] {
  return text
    .split(/[,›>]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function formatHeaderPath(path: string[]): string {
  return path.join(" › ");
}

/** 태그 입력 문자열(쉼표·줄바꿈 구분)을 중복 없는 목록으로. */
export function parseTags(text: string): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const part of text.split(/[,\n]/)) {
    const tag = part.trim();
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }
  return tags;
}

function blankToNull(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

/** 대괄호 key([주입 수량])와 맨 key를 뽑는다. 화면 검증용(서버가 최종 판정). */
export function formulaColumnNames(expression: string): string[] {
  const names: string[] = [];
  const bracket = /\[([^\]]+)\]/g;
  let stripped = expression;
  for (const match of expression.matchAll(bracket)) names.push(match[1].trim());
  stripped = stripped.replace(bracket, " ");
  for (const token of stripped.split(/[\s+\-*/()=]+/)) {
    if (token && !/^(\d+(\.\d+)?|\.\d+)$/.test(token)) names.push(token);
  }
  return names;
}

/** 표 하나를 저장할 수 없으면 그 이유(사람이 읽을 문장), 저장할 수 있으면 null. */
export function tableSpecError(spec: TableSpec): string | null {
  const label = spec.name.trim() || spec.key || "이름 없는 표";
  if (!spec.key.trim()) return `${label}: 표 key를 입력하세요.`;
  if (!spec.name.trim()) return `${spec.key}: 표 이름을 입력하세요.`;
  if (!spec.columns.length) return `${label}: 칼럼을 하나 이상 추가하세요.`;
  const keys = spec.columns.map((column) => column.key.trim());
  if (keys.some((key) => !key)) return `${label}: 칼럼 이름을 모두 입력하세요.`;
  const duplicate = keys.find((key, index) => keys.indexOf(key) !== index);
  if (duplicate) return `${label}: 칼럼 이름 "${duplicate}"이(가) 겹칩니다.`;
  for (const column of spec.columns) {
    if (column.type === "choice" && !column.choices.length && !column.choice_allow_number) {
      return `${label}: 선택 칼럼 "${column.key}"에 허용 값을 넣거나 숫자 허용을 켜세요.`;
    }
  }
  if ((spec.row_count.mode === "exact" || spec.row_count.mode === "max") && !spec.row_count.value) {
    return `${label}: 행 수를 입력하세요.`;
  }
  const known = new Set(keys);
  for (const rule of spec.rules) {
    if (rule.kind === "row_formula") {
      const expression = (rule.expression ?? "").trim();
      if (!expression) return `${label}: 계산 규칙의 식을 입력하세요.`;
      if ((expression.match(/=/g) ?? []).length !== 1)
        return `${label}: 계산 규칙에는 '='가 정확히 하나 있어야 합니다.`;
      const unknown = formulaColumnNames(expression).filter((name) => !known.has(name));
      if (unknown.length) return `${label}: 계산 규칙의 칼럼 "${unknown.join(", ")}"을(를) 찾을 수 없습니다.`;
    }
    if (rule.kind === "unique") {
      if (!rule.columns.length) return `${label}: 중복 금지 규칙의 칼럼을 고르세요.`;
      const unknown = rule.columns.filter((name) => !known.has(name));
      if (unknown.length) return `${label}: 중복 금지 규칙의 칼럼 "${unknown.join(", ")}"을(를) 찾을 수 없습니다.`;
    }
  }
  return null;
}

/** 초안 전체 검증. 첫 문제를 돌려준다. */
export function templateDraftError(draft: TemplateDraft): string | null {
  if (!draft.name.trim()) return "양식 이름을 입력하세요.";
  const keys = draft.tables.map((table) => table.key.trim());
  const duplicate = keys.find((key, index) => key && keys.indexOf(key) !== index);
  if (duplicate) return `표 key "${duplicate}"이(가) 겹칩니다.`;
  for (const table of draft.tables) {
    const error = tableSpecError(table);
    if (error) return error;
  }
  return null;
}

/** 서버로 보낼 정의(공백 정리, unknown 행 수는 value null). 검증은 templateDraftError로 먼저 한다. */
export function specToPayload(spec: TableSpec): TableSpec {
  return {
    ...spec,
    key: spec.key.trim(),
    name: spec.name.trim(),
    description: blankToNull(spec.description),
    end_hint: blankToNull(spec.end_hint),
    row_unit_hint: blankToNull(spec.row_unit_hint),
    row_count: spec.row_count.mode === "unknown" ? { mode: "unknown", value: null } : spec.row_count,
    columns: spec.columns.map((column) => ({
      ...column,
      key: column.key.trim(),
      description: blankToNull(column.description),
      header_path: column.header_path.map((part) => part.trim()).filter(Boolean),
      choices: column.type === "choice" ? column.choices : [],
      choice_allow_number: column.type === "choice" ? column.choice_allow_number : false,
      checkbox_options: column.type === "checkbox" ? column.checkbox_options : []
    })),
    rules: spec.rules.map((rule) => ({
      ...rule,
      expression: rule.kind === "row_formula" ? (rule.expression ?? "").trim() : null,
      columns: rule.kind === "unique" ? rule.columns : [],
      message: blankToNull(rule.message)
    }))
  };
}

export function draftToPayload(draft: TemplateDraft): TableTemplatePayload {
  return {
    name: draft.name.trim(),
    description: blankToNull(draft.description),
    tables: draft.tables.map(specToPayload),
    sample_refs: draft.sample_refs.slice(0, MAX_SAMPLES)
  };
}

/** 목록·Inspector 요약: "표 2개 · 칼럼 14개". */
export function templateSummary(template: Pick<TableTemplate, "tables">): string {
  const columnCount = template.tables.reduce((sum, table) => sum + table.columns.length, 0);
  return `표 ${template.tables.length.toLocaleString()}개 · 칼럼 ${columnCount.toLocaleString()}개`;
}

export function templateLabel(template: Pick<TableTemplate, "name" | "display_name">): string {
  return template.display_name || template.name;
}

/** 배열에서 index 항목을 delta(-1/+1)만큼 옮긴다. 범위를 벗어나면 그대로. */
export function moveItem<T>(items: T[], index: number, delta: number): T[] {
  const target = index + delta;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return items;
  const next = items.slice();
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);
  return next;
}

/** 칼럼 이름을 바꾸면 규칙이 가리키는 이름도 따라 바꾼다(unique 칼럼 목록, 계산식의 맨 이름·대괄호 이름). */
export function renameColumnInRules(rules: TableRuleSpec[], from: string, to: string): TableRuleSpec[] {
  if (!from || from === to) return rules;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const bare = new RegExp(`(^|[\\s+\\-*/()=])${escaped}(?=$|[\\s+\\-*/()=])`, "g");
  const needsBracket = /[\s+\-*/()=[\]]/.test(to);
  return rules.map((rule) => {
    if (rule.kind === "unique")
      return { ...rule, columns: rule.columns.map((column) => (column === from ? to : column)) };
    if (rule.kind === "row_formula" && rule.expression) {
      const replacement = needsBracket ? `[${to}]` : to;
      const expression = rule.expression
        .replaceAll(`[${from}]`, needsBracket ? `[${to}]` : to)
        .replace(bare, (_, lead: string) => `${lead}${replacement}`);
      return { ...rule, expression };
    }
    return rule;
  });
}
