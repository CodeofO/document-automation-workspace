import type { Schemas } from "../../api/client";

export type RequiredFieldChecklist = Schemas["RequiredFieldChecklistRead"];
export type RequiredFieldItem = Schemas["RequiredFieldItem"];
export type ChecklistRecommendation = Schemas["RequiredFieldChecklistRecommendationRead"];

export type RequiredFieldItemStatus = "present" | "missing" | "uncertain" | "not_applicable";
export type RequiredOverallStatus = "complete" | "incomplete" | "needs_review";

export type RequiredFieldOutputItem = {
  item_name: string;
  status: RequiredFieldItemStatus;
  required: boolean;
  evidence_type: string;
  confidence: number | null;
  evidence: string | null;
  page: number | null;
};

export type RequiredFieldOutput = {
  document_id: string;
  checklist_id: string;
  overall_status: RequiredOverallStatus;
  items: RequiredFieldOutputItem[];
  page_number?: number | null;
};
