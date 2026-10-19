// 워크플로우 빌더 화면: 팔레트 | (툴바 / 캔버스 | 오른쪽 패널 / 검증 바).
// 상호작용 규칙은 docs/ux/workflow-inspector-spec.md:
// 클릭은 선택만 한다 → 오른쪽 Inspector 내용만 바뀐다. 에셋 편집 Drawer는 버튼·Enter로만 연다.
import { ReactFlowProvider, useReactFlow } from "@xyflow/react";
import { useMemo, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router";
import { workflowRunPath } from "../../../app/routes";
import { useToast } from "../../../components/ui";
import { useHandedOffDocuments } from "../../library";
import { AiWorkflowDraftDialog } from "../ai-draft/AiWorkflowDraftDialog";
import { useAiWorkflowDraft } from "../ai-draft/useAiWorkflowDraft";
import { AssetEditorDrawer } from "../assets/AssetEditorDrawer";
import { WorkflowSelectionInspector } from "../inspector/WorkflowSelectionInspector";
import { readWorkflowDraft } from "../model/draftStorage";
import { workflowNodeHasAssetEditor } from "../model/graph";
import { workflowRunIsProcessing } from "../model/runRules";
import { RIGHT_PANEL_RAIL_WIDTH, useRightPanelState } from "../panel/useRightPanelState";
import { WorkflowRightPanel } from "../panel/WorkflowRightPanel";
import { useWorkflowRuns } from "../runs/useWorkflowRuns";
import { WorkflowRunHistory } from "../runs/WorkflowRunHistory";
import { useWorkflowBootstrap } from "./useWorkflowBootstrap";
import { useWorkflowDraftAutosave } from "./useWorkflowDraftAutosave";
import { useWorkflowEditorState, type EditorNotify } from "./useWorkflowEditorState";
import { useWorkflowRunLauncher } from "./useWorkflowRunLauncher";
import { useWorkflowShortcuts } from "./useWorkflowShortcuts";
import { WORKFLOW_FIT_VIEW_OPTIONS, WorkflowCanvas } from "./WorkflowCanvas";
import { WorkflowPalette } from "./WorkflowPalette";
import { WorkflowStatusBar } from "./WorkflowStatusBar";
import { WorkflowToolbar } from "./WorkflowToolbar";

export type WorkflowBuilderProps = {
  uploadMaxBatchFiles: number;
  uploadChunkFiles: number;
  /** 경로(/workflows/:id)로 받은 워크플로우. 한 번 불러온 뒤 경로를 /workflows로 정리한다. */
  initialWorkflowId?: string;
};

export function WorkflowBuilder(props: WorkflowBuilderProps) {
  return (
    <ReactFlowProvider>
      <WorkflowEditorScreen {...props} />
    </ReactFlowProvider>
  );
}

function WorkflowEditorScreen({ uploadMaxBatchFiles, uploadChunkFiles, initialWorkflowId = "" }: WorkflowBuilderProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const reactFlow = useReactFlow();
  const handedOffDocuments = useHandedOffDocuments("workflow");
  const [initialDraft] = useState(() => readWorkflowDraft());
  const [inspectorFocusRequest, setInspectorFocusRequest] = useState(0);

  const notify = useMemo<EditorNotify>(
    () => ({
      success: (message) => toast.show(message, { tone: "success" }),
      error: (message) => toast.show(message, { tone: "danger" })
    }),
    [toast]
  );
  const runsNotify = useMemo(
    () => ({
      message: (message: string | null) => message && notify.success(message),
      error: (message: string | null) => message && notify.error(message)
    }),
    [notify]
  );

  const editor = useWorkflowEditorState(initialDraft, notify);
  const runsState = useWorkflowRuns(runsNotify);
  const launcher = useWorkflowRunLauncher({
    initialDocuments: handedOffDocuments,
    uploadMaxBatchFiles,
    uploadChunkFiles,
    validationErrors: editor.validation.errors,
    persistWorkflow: editor.persistWorkflow,
    runs: runsState,
    notify
  });
  const panel = useRightPanelState();
  const aiDraft = useAiWorkflowDraft({
    onApply: editor.applyAiDraft,
    onSamplesPersisted: launcher.selectLibraryDocuments,
    onMessage: (message) => notify.success(message),
    onError: (message) => notify.error(message)
  });
  useWorkflowBootstrap({
    editor,
    initialDraft,
    initialWorkflowId,
    notify
  });
  const { savedAt } = useWorkflowDraftAutosave(
    {
      activeWorkflowId: editor.activeWorkflowId,
      workflowName: editor.workflowName,
      workflowDescription: editor.workflowDescription,
      nodes: editor.nodes,
      edges: editor.edges,
      ...editor.drafts
    },
    Boolean(initialDraft)
  );

  const activeRunCount = runsState.runs.filter(workflowRunIsProcessing).length;
  const isRunningRun = activeRunCount > 0;
  const drawerOpen = Boolean(editor.assetDrawerNode);
  const modalOpen = drawerOpen || aiDraft.open;
  const { selectedNodes } = editor;
  const errorCount = editor.issues.filter((issue) => issue.level === "error").length;

  function openWorkflowInspector() {
    editor.clearSelection();
    panel.showTab("inspect");
  }

  useWorkflowShortcuts({
    modalOpen,
    onEscape: editor.clearSelection,
    onDuplicate: () => editor.duplicateNodes(selectedNodes.map((node) => node.id)),
    onSave: () => void launcher.saveWorkflow(),
    onTogglePanel: panel.toggleCollapsed,
    onFitView: () => void reactFlow.fitView({ ...WORKFLOW_FIT_VIEW_OPTIONS, duration: 240 }),
    onEnter: () => {
      if (selectedNodes.length !== 1 || !workflowNodeHasAssetEditor(selectedNodes[0])) return false;
      editor.openAssetDrawer(selectedNodes[0].id);
      return true;
    }
  });

  const layoutStyle = {
    "--wf-right-panel-width": `${panel.collapsed ? RIGHT_PANEL_RAIL_WIDTH : panel.width}px`
  } as CSSProperties;

  return (
    <main className="workflow-builder wf-editor" style={layoutStyle}>
      <WorkflowPalette onAdd={(kind) => editor.addNode(kind)} />

      <section className="workflow-canvas-shell">
        <WorkflowToolbar
          workflowName={editor.workflowName}
          onWorkflowNameChange={editor.setWorkflowName}
          activeWorkflowId={editor.activeWorkflowId}
          workflows={editor.assets.workflows}
          onLoadWorkflow={(workflowId) => {
            const workflow = editor.assets.workflows.find((item) => item.id === workflowId);
            if (!workflow) {
              editor.resetWorkflowDraft();
              return;
            }
            editor.loadWorkflowIntoCanvas(workflow);
            notify.success(`불러온 워크플로우: ${workflow.name}`);
          }}
          onOpenAiDraft={() => aiDraft.setOpen(true)}
          aiGenerating={aiDraft.isGenerating}
          validationErrors={editor.validation.errors}
          launcher={launcher}
          uploadChunkFiles={uploadChunkFiles}
          isRunningRun={isRunningRun}
          activeRun={runsState.activeRun}
        />

        <div className="workflow-main-area">
          <WorkflowCanvas
            editor={editor}
            animateEdges={isRunningRun || launcher.isStartingRun}
            keyboardDisabled={modalOpen}
            onNodeDoubleClick={() => {
              panel.showTab("inspect");
              setInspectorFocusRequest((current) => current + 1);
            }}
          />
          <WorkflowRightPanel
            panel={panel}
            activeRunCount={activeRunCount}
            inspect={
              <WorkflowSelectionInspector
                editor={editor}
                launcher={launcher}
                focusRequest={inspectorFocusRequest}
              />
            }
            runs={
              <WorkflowRunHistory
                runs={runsState.runs}
                activeRunId={runsState.activeRunId}
                onSelect={(runId) => runsState.focusRun(runId, true)}
                onOpen={(runId) => navigate(workflowRunPath(runId))}
                onResume={(runId) => void runsState.resumeRun(runId)}
                onPause={launcher.pauseRun}
                onStartWaiting={(runId) => void runsState.startWaitingRun(runId)}
                onDeleteQueueEntry={(runId) => void runsState.deleteQueueEntry(runId)}
              />
            }
          />
        </div>

        <WorkflowStatusBar
          errorCount={errorCount}
          warningCount={editor.issues.length - errorCount}
          persistentError={runsState.summaryError}
          autosaveLabel={savedAt}
          onOpenValidation={openWorkflowInspector}
        />
      </section>

      <AssetEditorDrawer
        node={editor.assetDrawerNode}
        assets={editor.assets}
        assetDrafts={editor.assetDrafts}
        onClose={editor.closeAssetDrawer}
      />

      {aiDraft.open && (
        <AiWorkflowDraftDialog
          files={aiDraft.files}
          persistSamples={aiDraft.persistSamples}
          includeChecklist={aiDraft.includeChecklist}
          isGenerating={aiDraft.isGenerating}
          onFilesChange={aiDraft.onFilesChange}
          onPersistSamplesChange={aiDraft.setPersistSamples}
          onIncludeChecklistChange={aiDraft.setIncludeChecklist}
          onGenerate={() => void aiDraft.generate()}
          onClose={aiDraft.close}
        />
      )}
    </main>
  );
}
