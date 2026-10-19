// 저장·실행 전에 노드에 묶인 에셋 초안(classifier·schema·checklist)을 서버에 저장하고,
// 노드 config를 저장된 id로 바꾼다. 화면 상태는 건드리지 않고 결과만 돌려준다.
import { saveChecklist, saveClassifier, saveSchema } from "../api";
import { checklistDraftPayload, classifierDraftPayload, schemaDraftPayload } from "../model/drafts";
import { syncBranchKeys, updateWorkflowNodeConfig } from "../model/graph";
import type {
  ChecklistSummary,
  ClassifierSummary,
  SchemaSummary,
  WorkflowChecklistDraft,
  WorkflowClassifierDraft,
  WorkflowNode,
  WorkflowSchemaDraft
} from "../types";

export type DraftAssets = {
  classifierDraftsByNodeId: Record<string, WorkflowClassifierDraft>;
  schemaDraftsByNodeId: Record<string, WorkflowSchemaDraft>;
  checklistDraftsByNodeId: Record<string, WorkflowChecklistDraft>;
};

export type MaterializedDraftAssets = DraftAssets & {
  nodes: WorkflowNode[];
  savedClassifiers: ClassifierSummary[];
  savedSchemas: SchemaSummary[];
  savedChecklists: ChecklistSummary[];
};

export async function materializeDraftAssets(
  currentNodes: WorkflowNode[],
  drafts: DraftAssets,
  classifiers: ClassifierSummary[]
): Promise<MaterializedDraftAssets> {
  let nodes = currentNodes;
  const classifierDraftsByNodeId = { ...drafts.classifierDraftsByNodeId };
  const schemaDraftsByNodeId = { ...drafts.schemaDraftsByNodeId };
  const checklistDraftsByNodeId = { ...drafts.checklistDraftsByNodeId };
  const savedClassifiers: ClassifierSummary[] = [];
  const savedSchemas: SchemaSummary[] = [];
  const savedChecklists: ChecklistSummary[] = [];

  for (const node of currentNodes) {
    const config = node.data.config ?? {};
    if (node.data.kind === "classifier") {
      const draft = classifierDraftsByNodeId[node.id];
      if (!draft) continue;
      const saved = await saveClassifier(config.classifier_id ?? "", classifierDraftPayload(draft));
      savedClassifiers.push(saved);
      delete classifierDraftsByNodeId[node.id];
      nodes = updateWorkflowNodeConfig(nodes, node.id, "classifier_id", saved.id);
      nodes = syncBranchKeys(nodes, saved.id, [saved, ...classifiers.filter((classifier) => classifier.id !== saved.id)]);
    }
    if (node.data.kind === "kie") {
      const draft = schemaDraftsByNodeId[node.id];
      if (!draft) continue;
      const saved = await saveSchema(config.schema_id ?? "", schemaDraftPayload(draft));
      savedSchemas.push(saved);
      delete schemaDraftsByNodeId[node.id];
      nodes = updateWorkflowNodeConfig(nodes, node.id, "schema_id", saved.id);
    }
    if (node.data.kind === "required-checker") {
      const draft = checklistDraftsByNodeId[node.id];
      if (!draft) continue;
      const saved = await saveChecklist(config.checklist_id ?? "", checklistDraftPayload(draft));
      savedChecklists.push(saved);
      delete checklistDraftsByNodeId[node.id];
      nodes = updateWorkflowNodeConfig(nodes, node.id, "checklist_id", saved.id);
    }
  }

  return {
    nodes,
    classifierDraftsByNodeId,
    schemaDraftsByNodeId,
    checklistDraftsByNodeId,
    savedClassifiers,
    savedSchemas,
    savedChecklists
  };
}
