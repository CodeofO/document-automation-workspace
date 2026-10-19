// 분류 모듈을 BatchModule 셸에 연결하는 설정.
import type { ModuleKindConfig } from "../module-batch";
import { ClassificationResultPanel } from "./ClassificationResultPanel";
import { ClassifierConfigEditor } from "./ClassifierConfigEditor";
import { defaultClassifier, normalizeClassifier, summarizeClassifier, toClassifierPayload } from "./model";
import type { ClassificationOutput, ClassifierDraft, DocumentClassifier } from "./types";

export const classifierModule: ModuleKindConfig<DocumentClassifier, ClassifierDraft, ClassificationOutput> = {
  kind: "classifier",
  title: "문서 분류",
  description: "정의한 문서 클래스 중 하나 또는 미분류로 페이지마다 분류합니다.",
  configLabel: "분류 설정",
  libraryLabel: "분류 설정 목록",
  resultMessage: "분류 결과가 생성되었습니다.",
  exportOwnerType: "classification_batch",
  endpoints: {
    definitions: "/api/document-classifiers",
    batches: "/api/classification-batches",
    jobs: "/api/classification-jobs",
    results: "/api/classification-results",
    definitionField: "classifier_id"
  },
  defaultDraft: defaultClassifier,
  toDraft: normalizeClassifier,
  toPayload: toClassifierPayload,
  summarize: summarizeClassifier,
  exportRows: (output) => [
    {
      status: output.status,
      class_name: output.class_name,
      confidence: output.confidence,
      reason: output.reason,
      evidence: output.evidence.join("; ")
    }
  ],
  DefinitionEditor: ClassifierConfigEditor,
  ResultPanel: ClassificationResultPanel
};
