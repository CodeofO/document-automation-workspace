import type { Schemas } from "../../api/client";
import type { ModuleJob } from "../module-batch";

export type DocumentClassifier = Schemas["DocumentClassifierRead"];

/** 편집용 클래스 후보. signals_text는 textarea 원문(줄바꿈 구분)으로, 저장 때 signals로 바뀐다. */
export type ClassCandidateDraft = {
  class_name: string;
  description: string;
  signals: string[];
  signals_text?: string;
};

export type ClassifierDraft = Omit<DocumentClassifier, "classes"> & { classes: ClassCandidateDraft[] };

export type ClassificationOutput = {
  document_id: string;
  classifier_id: string;
  status: "classified" | "unknown";
  class_name: string | null;
  confidence: number | null;
  reason: string;
  evidence: string[];
  page_number?: number | null;
};

export type ClassificationJob = ModuleJob<ClassificationOutput>;
