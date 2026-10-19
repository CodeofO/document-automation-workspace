// 필수 항목 확인 모듈을 BatchModule 셸에 연결하는 설정.
import type { ModuleKindConfig } from "../module-batch";
import { ChecklistRecommendButton } from "./ChecklistRecommendButton";
import { defaultChecklist, normalizeChecklist, summarizeChecklist, toChecklistPayload } from "./model";
import { RequiredChecklistEditor } from "./RequiredChecklistEditor";
import { RequiredFieldResultPanel } from "./RequiredFieldResultPanel";
import type { RequiredFieldChecklist, RequiredFieldOutput } from "./types";

export const requiredCheckModule: ModuleKindConfig<RequiredFieldChecklist, RequiredFieldChecklist, RequiredFieldOutput> = {
  kind: "required-checker",
  title: "필수 항목 확인",
  description: "서명·날짜·체크박스처럼 빠지면 안 되는 항목이 페이지에 있는지 확인합니다.",
  configLabel: "체크리스트",
  libraryLabel: "체크리스트 목록",
  resultMessage: "필수 항목 확인 결과가 생성되었습니다.",
  exportOwnerType: "required_field_check_batch",
  endpoints: {
    definitions: "/api/required-field-checklists",
    batches: "/api/required-field-check-batches",
    jobs: "/api/required-field-check-jobs",
    results: "/api/required-field-check-results",
    definitionField: "checklist_id"
  },
  defaultDraft: defaultChecklist,
  toDraft: normalizeChecklist,
  toPayload: toChecklistPayload,
  summarize: summarizeChecklist,
  exportRows: (output) =>
    output.items.map((item) => ({
      overall_status: output.overall_status,
      item_name: item.item_name,
      status: item.status,
      required: item.required,
      evidence_type: item.evidence_type,
      confidence: item.confidence,
      evidence: item.evidence,
      page: item.page
    })),
  regionsOf: (draft) => draft.regions,
  DefinitionEditor: RequiredChecklistEditor,
  ResultPanel: RequiredFieldResultPanel,
  HeaderActions: ChecklistRecommendButton
};
