// 노드별 에셋 초안(classifier·schema·checklist). Builder 상위에 두고 Drawer·Inspector·노드 배지가 함께 쓴다.
// 초안은 워크플로우 저장·실행 때 materializeDraftAssets로 서버 에셋이 된다.
import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { DraftUpdater } from "../assets/AssetEditorShell";
import {
  checklistSummaryToDraft,
  classifierSummaryToDraft,
  emptyWorkflowChecklistDraft,
  emptyWorkflowClassifierDraft,
  emptyWorkflowSchemaDraft,
  normalizeClassifierDraft,
  schemaSummaryToDraft
} from "../model/drafts";
import { syncBranchKeysFromClassNames } from "../model/graph";
import type { WorkflowDraftMaps } from "../model/nodeAssets";
import type {
  WorkflowAssets,
  WorkflowChecklistDraft,
  WorkflowClassifierDraft,
  WorkflowDraft,
  WorkflowNode,
  WorkflowSchemaDraft
} from "../types";

function withoutKey<T>(record: Record<string, T>, key: string) {
  if (!(key in record)) return record;
  const next = { ...record };
  delete next[key];
  return next;
}

export function useAssetDrafts(
  initialDraft: WorkflowDraft | null,
  nodes: WorkflowNode[],
  setNodes: Dispatch<SetStateAction<WorkflowNode[]>>,
  assets: WorkflowAssets
) {
  const [classifierDraftsByNodeId, setClassifierDraftsByNodeId] = useState<Record<string, WorkflowClassifierDraft>>(
    () => initialDraft?.classifierDraftsByNodeId ?? {}
  );
  const [schemaDraftsByNodeId, setSchemaDraftsByNodeId] = useState<Record<string, WorkflowSchemaDraft>>(
    () => initialDraft?.schemaDraftsByNodeId ?? {}
  );
  const [checklistDraftsByNodeId, setChecklistDraftsByNodeId] = useState<Record<string, WorkflowChecklistDraft>>(
    () => initialDraft?.checklistDraftsByNodeId ?? {}
  );
  const drafts = useMemo<WorkflowDraftMaps>(
    () => ({ classifierDraftsByNodeId, schemaDraftsByNodeId, checklistDraftsByNodeId }),
    [classifierDraftsByNodeId, schemaDraftsByNodeId, checklistDraftsByNodeId]
  );

  const configValue = (nodeId: string, key: string) => nodes.find((node) => node.id === nodeId)?.data.config?.[key];

  function updateSchemaDraft(nodeId: string, updater: DraftUpdater<WorkflowSchemaDraft>) {
    const schemaId = configValue(nodeId, "schema_id");
    const baseDraft =
      schemaDraftsByNodeId[nodeId] ??
      schemaSummaryToDraft(assets.schemas.find((schema) => schema.id === schemaId)) ??
      emptyWorkflowSchemaDraft(nodeId);
    setSchemaDraftsByNodeId((current) => ({ ...current, [nodeId]: updater(baseDraft) }));
  }

  function updateClassifierDraft(nodeId: string, updater: DraftUpdater<WorkflowClassifierDraft>) {
    const classifierId = configValue(nodeId, "classifier_id");
    const baseDraft =
      classifierDraftsByNodeId[nodeId] ??
      classifierSummaryToDraft(assets.classifiers.find((classifier) => classifier.id === classifierId)) ??
      emptyWorkflowClassifierDraft(nodeId);
    const nextDraft = updater(baseDraft);
    setClassifierDraftsByNodeId((current) => ({ ...current, [nodeId]: nextDraft }));
    setNodes((current) =>
      syncBranchKeysFromClassNames(current, normalizeClassifierDraft(nextDraft).classes.map((item) => item.class_name))
    );
  }

  function updateChecklistDraft(nodeId: string, updater: DraftUpdater<WorkflowChecklistDraft>) {
    const checklistId = configValue(nodeId, "checklist_id");
    const baseDraft =
      checklistDraftsByNodeId[nodeId] ??
      checklistSummaryToDraft(assets.checklists.find((checklist) => checklist.id === checklistId)) ??
      emptyWorkflowChecklistDraft(nodeId);
    setChecklistDraftsByNodeId((current) => ({ ...current, [nodeId]: updater(baseDraft) }));
  }

  /**
   * 빈 초안으로 새 에셋을 시작한다. 저장된 에셋을 덮어쓰지 않도록 노드의 에셋 선택은 비운다
   * (materializeDraftAssets는 선택된 id가 있으면 그 에셋을 갱신한다).
   */
  function startNewDraft(node: WorkflowNode) {
    const clearConfig = (key: string) =>
      setNodes((current) =>
        current.map((item) =>
          item.id === node.id ? { ...item, data: { ...item.data, config: { ...(item.data.config ?? {}), [key]: "" } } } : item
        )
      );
    if (node.data.kind === "classifier") {
      clearConfig("classifier_id");
      updateClassifierDraft(node.id, () => emptyWorkflowClassifierDraft(node.id));
    } else if (node.data.kind === "kie") {
      clearConfig("schema_id");
      setSchemaDraftsByNodeId((current) => ({ ...current, [node.id]: emptyWorkflowSchemaDraft(node.id) }));
    } else if (node.data.kind === "required-checker") {
      clearConfig("checklist_id");
      setChecklistDraftsByNodeId((current) => ({ ...current, [node.id]: emptyWorkflowChecklistDraft(node.id) }));
    }
  }

  const discardDraft = useCallback((nodeId: string) => {
    setClassifierDraftsByNodeId((current) => withoutKey(current, nodeId));
    setSchemaDraftsByNodeId((current) => withoutKey(current, nodeId));
    setChecklistDraftsByNodeId((current) => withoutKey(current, nodeId));
  }, []);

  /** 노드가 지워지면 그 노드의 초안도 버린다. */
  const discardDraftsFor = useCallback((nodeIds: Iterable<string>) => {
    for (const nodeId of nodeIds) discardDraft(nodeId);
  }, [discardDraft]);

  const replaceAll = useCallback((next: Partial<WorkflowDraftMaps>) => {
    setClassifierDraftsByNodeId(next.classifierDraftsByNodeId ?? {});
    setSchemaDraftsByNodeId(next.schemaDraftsByNodeId ?? {});
    setChecklistDraftsByNodeId(next.checklistDraftsByNodeId ?? {});
  }, []);

  return {
    drafts,
    updateSchemaDraft,
    updateClassifierDraft,
    updateChecklistDraft,
    startNewDraft,
    discardDraft,
    discardDraftsFor,
    replaceAll
  };
}

export type AssetDraftsController = ReturnType<typeof useAssetDrafts>;
