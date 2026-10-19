// 분류·필수항목 공용 BatchModule 셸의 공개 API.
export { ModuleWorkspace } from "./ModuleWorkspace";
export type { ModuleWorkspaceProps } from "./ModuleWorkspace";
export { batchCanDiscard, batchCanResume, batchIsActive } from "./batchRules";
export { moduleKeys } from "./api";
export { batchItemLabel } from "./model";
export { BatchItemRail } from "./BatchItemRail";
export type { BatchRailItem } from "./BatchItemRail";
export type {
  DefinitionEditorProps,
  ModuleActionContext,
  ModuleBatch,
  ModuleBatchItem,
  ModuleDefinition,
  ModuleDocument,
  ModuleJob,
  ModuleKind,
  ModuleKindConfig,
  ModuleResultRecord,
  NoticeTone,
  ResultPanelProps,
  SchemaRegion
} from "./types";
