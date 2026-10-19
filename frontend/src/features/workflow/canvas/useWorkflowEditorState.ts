// 워크플로우 편집기 상태: 에셋 목록·그래프(노드·엣지)·선택·에셋 초안·Drawer·viewport.
// 규칙(docs/ux/workflow-inspector-spec.md)
// - 선택은 React Flow onSelectionChange 하나로만 바뀐다. 코드에서 선택을 바꿀 때도 nodes/edges의 selected만 고친다.
// - 선택은 편집이 아니다. Drawer는 openAssetDrawer로만 열린다.
// - fitView는 viewportRevision(불러오기·AI 초안 적용)에만 반응한다.
import { addEdge, applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange } from "@xyflow/react";
import { useCallback, useMemo, useState } from "react";
import { useTableTemplates } from "../../table-extraction";
import { createWorkflow, isWorkflowNotFoundError, updateWorkflow } from "../api";
import { normalizeChecklistDraft, normalizeSchemaDraft } from "../model/drafts";
import {
  branchKeyLabel,
  buildCanvasNodes,
  DEFAULT_WORKFLOW_NAME,
  defaultEdges,
  defaultNodes,
  duplicateWorkflowNode,
  nodePalette,
  normalizeWorkflowEdges,
  normalizeWorkflowNode,
  prependSaved,
  serializeDefinition,
  summarizeIssues,
  syncBranchKeys,
  upsertById,
  validateConnection,
  workflowIssues,
  workflowNode,
  workflowNodeHasAssetEditor
} from "../model/graph";
import { buildNodeViews } from "../model/nodeAssets";
import { sameSelection, selectionFromFlow, selectionNodeIds } from "../model/selection";
import type {
  WorkflowAiDraft,
  WorkflowAssets,
  WorkflowDefinition,
  WorkflowDraft,
  WorkflowEdge,
  WorkflowNode,
  WorkflowNodeKind,
  WorkflowSelection
} from "../types";
import { materializeDraftAssets } from "./materializeDraftAssets";
import { useAssetDrafts } from "./useAssetDrafts";

const EMPTY_ASSETS: WorkflowAssets = { workflows: [], schemas: [], classifiers: [], checklists: [], tableTemplates: [] };

export type EditorNotify = { success: (message: string) => void; error: (message: string) => void };

export function useWorkflowEditorState(initialDraft: WorkflowDraft | null, notify: EditorNotify) {
  const [loadedAssets, setAssets] = useState<WorkflowAssets>(EMPTY_ASSETS);
  // 표 양식은 다른 탭(양식 편집기)에서 자주 바뀌므로 목록 query(대기 주기 갱신)를 우선 쓴다.
  const tableTemplatesQuery = useTableTemplates();
  const assets = useMemo<WorkflowAssets>(
    () => (tableTemplatesQuery.data ? { ...loadedAssets, tableTemplates: tableTemplatesQuery.data } : loadedAssets),
    [loadedAssets, tableTemplatesQuery.data]
  );
  const [activeWorkflowId, setActiveWorkflowId] = useState(initialDraft?.activeWorkflowId ?? "");
  const [workflowName, setWorkflowName] = useState(initialDraft?.workflowName ?? DEFAULT_WORKFLOW_NAME);
  const [workflowDescription, setWorkflowDescription] = useState(initialDraft?.workflowDescription ?? "");
  const [nodes, setNodes] = useState<WorkflowNode[]>(() => initialDraft?.nodes ?? defaultNodes);
  const [edges, setEdges] = useState<WorkflowEdge[]>(() => normalizeWorkflowEdges(initialDraft?.edges ?? defaultEdges));
  const [selection, setSelection] = useState<WorkflowSelection>({ type: "none" });
  const [assetDrawerNodeId, setAssetDrawerNodeId] = useState<string | null>(null);
  const [viewportRevision, setViewportRevision] = useState(0);
  const assetDrafts = useAssetDrafts(initialDraft, nodes, setNodes, assets);
  const { drafts, replaceAll: replaceAllDrafts, discardDraftsFor } = assetDrafts;

  // --- 파생값 ---
  const issues = useMemo(
    () =>
      workflowIssues(nodes, edges, drafts.classifierDraftsByNodeId, drafts.schemaDraftsByNodeId, drafts.checklistDraftsByNodeId),
    [nodes, edges, drafts]
  );
  const validation = useMemo(() => summarizeIssues(issues), [issues]);
  const canvasNodes = useMemo(
    () => buildCanvasNodes(nodes, edges, buildNodeViews(nodes, assets, drafts, issues)),
    [nodes, edges, assets, drafts, issues]
  );
  const selectedNodeIds = selectionNodeIds(selection);
  const selectedNodes = useMemo(() => {
    const ids = new Set(selectedNodeIds);
    return nodes.filter((node) => ids.has(node.id));
  }, [nodes, selectedNodeIds]);
  const selectedEdge = selection.type === "edge" ? (edges.find((edge) => edge.id === selection.id) ?? null) : null;
  const assetDrawerNode = nodes.find((node) => node.id === assetDrawerNodeId) ?? null;

  // --- 선택 ---
  const onSelectionChange = useCallback((params: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }) => {
    const next = selectionFromFlow(params.nodes, params.edges);
    setSelection((current) => (sameSelection(current, next) ? current : next));
  }, []);

  /** 코드에서 선택을 바꾼다. React Flow가 바뀐 selected를 보고 onSelectionChange를 부른다. */
  const selectNodes = useCallback((ids: string[]) => {
    const idSet = new Set(ids);
    setNodes((current) =>
      current.map((node) => (Boolean(node.selected) === idSet.has(node.id) ? node : { ...node, selected: idSet.has(node.id) }))
    );
    setEdges((current) => (current.some((edge) => edge.selected) ? current.map((edge) => ({ ...edge, selected: false })) : current));
  }, []);

  const clearSelection = useCallback(() => selectNodes([]), [selectNodes]);

  // --- 그래프 변경 ---
  const onNodesChange = useCallback((changes: NodeChange<WorkflowNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<WorkflowEdge>[]) => {
    setEdges((current) => normalizeWorkflowEdges(applyEdgeChanges(changes, current)));
  }, []);

  const onNodesDelete = useCallback(
    (deleted: WorkflowNode[]) => {
      const ids = new Set(deleted.map((node) => node.id));
      if (!ids.size) return;
      setEdges((current) => current.filter((edge) => !ids.has(edge.source) && !ids.has(edge.target)));
      discardDraftsFor(ids);
    },
    [discardDraftsFor]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const message = validateConnection(connection, nodes, edges);
      if (message) {
        notify.error(message);
        return;
      }
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `${connection.source}-${connection.sourceHandle || "out"}-${connection.target}`,
            animated: false,
            label: connection.sourceHandle ? branchKeyLabel(connection.sourceHandle) : undefined
          },
          current
        )
      );
    },
    [edges, nodes, notify]
  );

  function addNode(kind: WorkflowNodeKind, position?: { x: number; y: number }) {
    const palette = nodePalette.find((item) => item.kind === kind);
    const node = workflowNode(
      kind,
      palette?.label ?? kind,
      position?.x ?? 160 + nodes.length * 48,
      position?.y ?? 260 + nodes.length * 16
    );
    // 새 노드만 선택한다. Drawer·패널은 열지 않고 viewport도 움직이지 않는다.
    setNodes((current) => [...current.map((item) => (item.selected ? { ...item, selected: false } : item)), { ...node, selected: true }]);
    setEdges((current) => (current.some((edge) => edge.selected) ? current.map((edge) => ({ ...edge, selected: false })) : current));
  }

  function duplicateNodes(ids: string[]) {
    const idSet = new Set(ids);
    const copies = nodes.filter((node) => idSet.has(node.id)).map((node) => duplicateWorkflowNode(node));
    if (!copies.length) return;
    setNodes((current) => [...current.map((node) => (node.selected ? { ...node, selected: false } : node)), ...copies]);
    notify.success(`${copies.length.toLocaleString()}개 노드를 복제했습니다.`);
  }

  function deleteNodes(ids: string[]) {
    const idSet = new Set(ids);
    if (!idSet.size) return;
    setNodes((current) => current.filter((node) => !idSet.has(node.id)));
    setEdges((current) => current.filter((edge) => !idSet.has(edge.source) && !idSet.has(edge.target)));
    discardDraftsFor(idSet);
    if (assetDrawerNodeId && idSet.has(assetDrawerNodeId)) setAssetDrawerNodeId(null);
    notify.success(`${idSet.size.toLocaleString()}개 노드를 삭제했습니다.`);
  }

  function deleteEdge(edgeId: string) {
    setEdges((current) => current.filter((edge) => edge.id !== edgeId));
    notify.success("선 연결을 삭제했습니다.");
  }

  function renameNode(nodeId: string, label: string) {
    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, data: { ...node.data, label } } : node)));
  }

  const updateNodeConfig = useCallback(
    (nodeId: string, key: string, value: string) => {
      setNodes((current) => {
        const next = current.map((node) =>
          node.id === nodeId ? { ...node, data: { ...node.data, config: { ...(node.data.config ?? {}), [key]: value } } } : node
        );
        return key === "classifier_id" ? syncBranchKeys(next, value, assets.classifiers) : next;
      });
    },
    [assets.classifiers]
  );

  // --- Drawer ---
  const openAssetDrawer = useCallback(
    (nodeId: string) => {
      if (workflowNodeHasAssetEditor(nodes.find((node) => node.id === nodeId))) setAssetDrawerNodeId(nodeId);
    },
    [nodes]
  );
  const closeAssetDrawer = useCallback(() => setAssetDrawerNodeId(null), []);

  // --- 캔버스 바꾸기 ---
  const replaceCanvas = useCallback(
    (next: { id: string; name: string; description: string; nodes: WorkflowNode[]; edges: WorkflowEdge[] }) => {
      setActiveWorkflowId(next.id);
      setWorkflowName(next.name);
      setWorkflowDescription(next.description);
      setNodes(next.nodes.map((node) => ({ ...normalizeWorkflowNode(node), selected: false })));
      setEdges(normalizeWorkflowEdges(next.edges).map((edge) => ({ ...edge, selected: false })));
      setAssetDrawerNodeId(null);
      setViewportRevision((current) => current + 1);
    },
    []
  );

  const loadWorkflowIntoCanvas = useCallback(
    (workflow: WorkflowDefinition) => {
      replaceCanvas({
        id: workflow.id,
        name: workflow.name,
        description: workflow.description ?? "",
        nodes: workflow.definition.nodes?.length ? workflow.definition.nodes : defaultNodes,
        edges: workflow.definition.edges?.length ? workflow.definition.edges : defaultEdges
      });
      replaceAllDrafts({});
    },
    [replaceAllDrafts, replaceCanvas]
  );

  function resetWorkflowDraft() {
    replaceCanvas({ id: "", name: DEFAULT_WORKFLOW_NAME, description: "", nodes: defaultNodes, edges: defaultEdges });
    replaceAllDrafts({});
    notify.success("새 워크플로우를 시작합니다.");
  }

  /** AI 초안 적용: 노드를 자동 선택하지 않는다. 초안은 해당 노드의 ● 배지로 보인다. */
  function applyAiDraft(draft: WorkflowAiDraft) {
    const nextNodes = (draft.definition.nodes?.length ? draft.definition.nodes : defaultNodes).map(normalizeWorkflowNode);
    const schemaNode = nextNodes.find((node) => node.data.kind === "kie");
    const checklistNode = nextNodes.find((node) => node.data.kind === "required-checker");
    replaceCanvas({
      id: "",
      name: draft.workflow_name || "AI 생성 워크플로우 초안",
      description: "",
      nodes: nextNodes,
      edges: draft.definition.edges?.length ? draft.definition.edges : defaultEdges
    });
    replaceAllDrafts({
      schemaDraftsByNodeId: schemaNode ? { [schemaNode.id]: normalizeSchemaDraft(draft.schema_draft) } : {},
      checklistDraftsByNodeId:
        checklistNode && draft.checklist_draft ? { [checklistNode.id]: normalizeChecklistDraft(draft.checklist_draft) } : {}
    });
    notify.success(schemaNode ? "초안 적용됨: 스키마 검토 필요" : "초안 적용됨");
  }

  // --- 저장 ---
  /** 초안 에셋을 먼저 저장하고(materialize) 워크플로우를 저장한다. 저장 후 초안 배지가 사라진다. */
  async function persistWorkflow() {
    if (validation.errors.length) throw new Error(validation.errors[0]);
    const materialized = await materializeDraftAssets(nodes, drafts, assets.classifiers);
    replaceAllDrafts(materialized);
    setAssets((current) => ({
      ...current,
      classifiers: prependSaved(current.classifiers, materialized.savedClassifiers),
      schemas: prependSaved(current.schemas, materialized.savedSchemas),
      checklists: prependSaved(current.checklists, materialized.savedChecklists)
    }));
    const payload = {
      name: workflowName.trim() || DEFAULT_WORKFLOW_NAME,
      description: workflowDescription.trim() || null,
      definition: serializeDefinition(materialized.nodes, edges)
    };
    const knownMissing = Boolean(
      activeWorkflowId && assets.workflows.length && !assets.workflows.some((workflow) => workflow.id === activeWorkflowId)
    );
    const shouldUpdate = Boolean(activeWorkflowId && !knownMissing);
    let saved: WorkflowDefinition;
    try {
      saved = shouldUpdate ? await updateWorkflow(activeWorkflowId, payload) : await createWorkflow(payload);
    } catch (exc) {
      if (!shouldUpdate || !isWorkflowNotFoundError(exc)) throw exc;
      setActiveWorkflowId("");
      saved = await createWorkflow(payload);
    }
    setActiveWorkflowId(saved.id);
    setAssets((current) => ({ ...current, workflows: upsertById(current.workflows, saved) }));
    // 선택 상태(selected)는 그대로 두고 config만 저장된 id로 바꾼다.
    const savedById = new Map(materialized.nodes.map((node) => [node.id, node]));
    setNodes((current) =>
      current.map((node) => {
        const savedNode = savedById.get(node.id);
        return savedNode ? { ...node, data: { ...node.data, ...savedNode.data } } : node;
      })
    );
    return saved;
  }

  return {
    assets,
    setAssets,
    activeWorkflowId,
    setActiveWorkflowId,
    workflowName,
    setWorkflowName,
    workflowDescription,
    setWorkflowDescription,
    nodes,
    edges,
    canvasNodes,
    issues,
    validation,
    selection,
    selectedNodes,
    selectedEdge,
    viewportRevision,
    assetDrawerNode,
    assetDrafts,
    drafts,
    onSelectionChange,
    selectNodes,
    clearSelection,
    onNodesChange,
    onEdgesChange,
    onNodesDelete,
    onConnect,
    addNode,
    duplicateNodes,
    deleteNodes,
    deleteEdge,
    renameNode,
    updateNodeConfig,
    openAssetDrawer,
    closeAssetDrawer,
    loadWorkflowIntoCanvas,
    resetWorkflowDraft,
    applyAiDraft,
    persistWorkflow
  };
}

export type WorkflowEditor = ReturnType<typeof useWorkflowEditorState>;
