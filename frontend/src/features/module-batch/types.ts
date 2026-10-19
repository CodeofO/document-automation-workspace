// 분류·필수항목 공용 "BatchModule" 셸의 타입.
// 모듈별 차이(엔드포인트, 정의 편집기, 결과 패널, 헤더 액션)는 ModuleKindConfig로 주입한다.
// 셸은 classifier/required-check 기능을 import하지 않는다(import-x/no-cycle).
import type { ComponentType } from "react";
import type { Schemas } from "../../api/client";
import type { ExportJobOwnerType } from "../export-jobs";

export type ModuleKind = "classifier" | "required-checker";

/** 저장된 정의(분류기·체크리스트)의 공통 모양. */
export type ModuleDefinition = { id: string; name: string; updated_at: string };

export type SchemaRegion = Schemas["SchemaRegion"];

export type ModuleDocument = Schemas["DocumentRead"];

/**
 * 배치 항목. 백엔드가 페이지 단위 처리로 바뀌면 page_number가 붙는다(없거나 null이면 문서 전체).
 */
export type ModuleBatchItem = Schemas["ClassificationBatchItemRead"] & { page_number?: number | null };

/** 분류 배치와 필수항목 배치는 정의 id 필드 이름만 다르다. */
export type ModuleBatch = Omit<Schemas["ClassificationBatchRead"], "classifier_id" | "items"> & {
  classifier_id?: string;
  checklist_id?: string;
  items: ModuleBatchItem[];
};

/** 결과 레코드. validated/corrected output은 모듈별 TOutput. */
export type ModuleResultRecord<TOutput> = {
  id: string;
  job_id: string;
  validated_output: TOutput;
  corrected_output: TOutput | null;
  reviewed: boolean;
};

export type ModuleJob<TOutput> = {
  job_id: string;
  document_id: string;
  status: string;
  error_message: string | null;
  result_id: string | null;
  result?: ModuleResultRecord<TOutput> | null;
  page_number?: number | null;
};

export type ModuleEndpoints = {
  /** 정의 목록·생성 (예: /api/document-classifiers) */
  definitions: string;
  /** 배치 (예: /api/classification-batches) */
  batches: string;
  /** 단건 job (예: /api/classification-jobs) */
  jobs: string;
  /** 결과 수정 (예: /api/classification-results) */
  results: string;
  /** job·배치 생성 바디에서 정의 id를 담는 필드 */
  definitionField: "classifier_id" | "checklist_id";
};

export type NoticeTone = "info" | "success" | "warning" | "danger";
export type Notice = { tone: NoticeTone; text: string };

export type DefinitionEditorProps<TDraft> = {
  draft: TDraft;
  onDraft: (draft: TDraft) => void;
  showRegions: boolean;
  onShowRegions: (show: boolean) => void;
  /** 영역 지정(RegionPicker)에 쓸 현재 문서(페이지 이미지). 없으면 영역 그리기를 막는다. */
  document: ModuleDocument | null;
};

/**
 * 결과 카드 본문. 수정은 onChange로 올리고, 저장은 셸의 [수정 저장]이 한다(spec B-4: 명시적 저장).
 * output은 저장 전 수정값이 있으면 그 값이다.
 */
export type ResultPanelProps<TDraft, TOutput> = {
  job: ModuleJob<TOutput> | null;
  draft: TDraft;
  output: TOutput | null;
  onChange: (output: TOutput) => void;
  /** 결과 표의 페이지 링크 → 뷰어 이동 */
  onGoToPage: (page: number) => void;
};

/** 정의 카드 헤더의 모듈 전용 액션(예: 필수항목 AI 추천)이 받는 컨텍스트. */
export type ModuleActionContext<TDraft> = {
  draft: TDraft;
  document: ModuleDocument | null;
  busy: boolean;
  /** busy 표시·알림 초기화·오류 표시를 대신 해 준다. */
  runTask: (label: string, task: () => Promise<void>) => Promise<void>;
  /** 저장되지 않은 새 초안으로 바꾼다(활성 정의 선택 해제). */
  replaceDraft: (draft: TDraft) => void;
  setShowRegions: (show: boolean) => void;
  notify: (text: string, tone?: NoticeTone) => void;
};

export type ModuleKindConfig<TDef extends ModuleDefinition, TDraft extends ModuleDefinition, TOutput> = {
  kind: ModuleKind;
  title: string;
  /** 페이지 헤더 설명 한 줄 */
  description: string;
  /** "분류 설정" / "체크리스트" */
  configLabel: string;
  /** 정의 목록 Drawer eyebrow */
  libraryLabel: string;
  /** 단건 실행 완료 문구 */
  resultMessage: string;
  exportOwnerType: Extract<ExportJobOwnerType, "classification_batch" | "required_field_check_batch">;
  endpoints: ModuleEndpoints;
  defaultDraft: () => TDraft;
  toDraft: (definition: TDef) => TDraft;
  /** 저장 바디. 입력이 잘못되면 Error를 던진다. */
  toPayload: (draft: TDraft) => unknown;
  summarize: (definition: TDef) => string;
  /** 단건 결과 CSV 행(단건 Export). */
  exportRows: (output: TOutput) => Record<string, unknown>[];
  regionsOf?: (draft: TDraft) => SchemaRegion[];
  DefinitionEditor: ComponentType<DefinitionEditorProps<TDraft>>;
  ResultPanel: ComponentType<ResultPanelProps<TDraft, TOutput>>;
  HeaderActions?: ComponentType<ModuleActionContext<TDraft>>;
};

/** 화면에서 정의 하나를 편집하는 상태. configId가 null이면 저장 전 초안. */
export type DraftState<TDraft> = { configId: string | null; draft: TDraft; dirty: boolean };
