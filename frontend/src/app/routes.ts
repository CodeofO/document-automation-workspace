// 화면 경로. 기능 코드는 문자열 대신 이 상수를 쓴다.

export const ROUTES = {
  home: "/",
  documents: "/documents",
  raw: "/raw",
  keyInfo: "/key-info",
  classifier: "/classifier",
  requiredCheck: "/required-check",
  rotation: "/rotation",
  tables: "/tables",
  tableTemplates: "/tables/templates",
  workflows: "/workflows",
  exports: "/exports"
} as const;

export function workflowPath(workflowId?: string | null): string {
  return workflowId ? `${ROUTES.workflows}/${encodeURIComponent(workflowId)}` : ROUTES.workflows;
}

/** 표 추출 검토 화면. ?batch= / ?job= / ?template= 중 필요한 것만 붙인다. */
export function tablesPath(params: { batch?: string | null; job?: string | null; template?: string | null } = {}): string {
  const search = new URLSearchParams();
  if (params.batch) search.set("batch", params.batch);
  if (params.job) search.set("job", params.job);
  if (params.template) search.set("template", params.template);
  const query = search.toString();
  return query ? `${ROUTES.tables}?${query}` : ROUTES.tables;
}

/** 표 양식 편집기. id가 없으면 새 양식. */
export function tableTemplatePath(templateId?: string | null): string {
  return templateId ? `${ROUTES.tableTemplates}/${encodeURIComponent(templateId)}` : ROUTES.tableTemplates;
}

export function workflowRunPath(runId: string): string {
  return `/workflow-runs/${encodeURIComponent(runId)}`;
}

/** 보관함에서 "선택 문서로 실행"할 수 있는 대상 모듈. */
export type ModuleTarget = "raw" | "key-info" | "classifier" | "required-checker" | "rotation" | "table" | "workflow";

export const MODULE_TARGET_PATHS: Record<ModuleTarget, string> = {
  raw: ROUTES.raw,
  "key-info": ROUTES.keyInfo,
  classifier: ROUTES.classifier,
  "required-checker": ROUTES.requiredCheck,
  rotation: ROUTES.rotation,
  table: ROUTES.tables,
  workflow: ROUTES.workflows
};

const LEGACY_HASH_PATHS: Record<string, string> = {
  home: ROUTES.home,
  documents: ROUTES.documents,
  raw: ROUTES.raw,
  "key-info": ROUTES.keyInfo,
  classifier: ROUTES.classifier,
  "required-checker": ROUTES.requiredCheck,
  rotation: ROUTES.rotation,
  workflow: ROUTES.workflows,
  exports: ROUTES.exports
};

/**
 * 예전 해시 라우트(#key-info, #workflow-result:<id>)를 새 경로로 바꾼다. 해당 없으면 null.
 * 북마크를 살리기 위한 일회성 리다이렉트에 쓴다.
 */
export function pathFromLegacyHash(hash: string): string | null {
  const value = hash.replace(/^#/, "");
  if (!value) return null;
  if (value.startsWith("workflow-result:")) {
    const runId = decodeURIComponent(value.slice("workflow-result:".length));
    return runId ? workflowRunPath(runId) : ROUTES.workflows;
  }
  return LEGACY_HASH_PATHS[value] ?? null;
}
