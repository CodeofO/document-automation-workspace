// React Flow 캔버스. 선택은 React Flow(onSelectionChange)에만 맡기고, 클릭으로 편집기를 열지 않는다.
// fitView는 (1) 캔버스가 처음 실제 크기를 얻고 노드 크기가 측정된 뒤 한 번, (2) viewportRevision이 바뀔 때(불러오기·AI 초안 적용)만 한다.
// 노드 추가·선택·패널 토글/리사이즈·에셋 목록 갱신에는 움직이지 않는다.
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type FitViewOptions
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { workflowContextMenuPosition } from "../model/graph";
import type { WorkflowNode, WorkflowNodeContextMenu } from "../types";
import { NodeContextMenu } from "./NodeContextMenu";
import type { WorkflowEditor } from "./useWorkflowEditorState";
import { workflowNodeTypes } from "./WorkflowCanvasNode";

export const WORKFLOW_FIT_VIEW_PADDING = 0.12;
/** 화면 맞춤 기준. 너무 작게 줄어 글자가 안 읽히거나, 노드가 적을 때 과하게 커지지 않게 묶는다. */
export const WORKFLOW_FIT_VIEW_OPTIONS = {
  padding: WORKFLOW_FIT_VIEW_PADDING,
  minZoom: 0.6,
  maxZoom: 1.1
} satisfies FitViewOptions;
const DELETE_KEYS = ["Backspace", "Delete"];

export function WorkflowCanvas(props: {
  editor: WorkflowEditor;
  animateEdges: boolean;
  /** Drawer 같은 모달이 열려 있으면 캔버스 키(삭제)를 끈다. */
  keyboardDisabled: boolean;
  onNodeDoubleClick: (nodeId: string) => void;
}) {
  const { editor } = props;
  const reactFlow = useReactFlow<WorkflowNode>();
  const [contextMenu, setContextMenu] = useState<WorkflowNodeContextMenu | null>(null);

  const edges = useMemo(
    () =>
      editor.edges.map((edge) => ({
        ...edge,
        animated: props.animateEdges,
        className:
          [edge.className, props.animateEdges ? "workflow-edge-flowing" : ""].filter(Boolean).join(" ") || undefined
      })),
    [editor.edges, props.animateEdges]
  );

  // 캔버스가 처음 실제 크기(0이 아닌 폭·높이)를 얻은 시점. 3열 레이아웃이 자리 잡기 전에 맞추면 그래프가 작게 남는다.
  const containerRef = useRef<HTMLDivElement>(null);
  const [canvasSized, setCanvasSized] = useState(false);
  useEffect(() => {
    const element = containerRef.current;
    if (!element || canvasSized) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setCanvasSized(true);
        observer.disconnect();
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [canvasSized]);

  // 맞춤이 끝난 viewportRevision. 첫 맞춤(-1 → 현재 값) 뒤에는 revision이 바뀔 때만 다시 맞춘다.
  const nodesInitialized = useNodesInitialized();
  const fittedRevisionRef = useRef(-1);
  useEffect(() => {
    const revision = editor.viewportRevision;
    if (!canvasSized || !nodesInitialized || fittedRevisionRef.current === revision) return;
    const isFirstFit = fittedRevisionRef.current === -1;
    const frame = window.requestAnimationFrame(() => {
      // 새 노드가 아직 측정되지 않았으면 다음 nodesInitialized 변화 때 다시 시도한다.
      if (!reactFlow.getNodes().every((node) => node.measured?.width && node.measured?.height)) return;
      fittedRevisionRef.current = revision;
      void reactFlow.fitView({ ...WORKFLOW_FIT_VIEW_OPTIONS, duration: isFirstFit ? 0 : 240 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canvasSized, nodesInitialized, editor.viewportRevision, reactFlow]);

  function openContextMenu(event: ReactMouseEvent | globalThis.MouseEvent) {
    event.preventDefault();
    const flowPosition = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    setContextMenu({ ...workflowContextMenuPosition(event.clientX, event.clientY), flowPosition });
  }
  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return (
    <div className="workflow-canvas" ref={containerRef}>
      <ReactFlow
        nodes={editor.canvasNodes}
        edges={edges}
        nodeTypes={workflowNodeTypes}
        onNodesChange={editor.onNodesChange}
        onEdgesChange={editor.onEdgesChange}
        onNodesDelete={editor.onNodesDelete}
        onConnect={editor.onConnect}
        onSelectionChange={editor.onSelectionChange}
        onNodeDoubleClick={(_, node) => props.onNodeDoubleClick(node.id)}
        onPaneClick={closeContextMenu}
        onPaneContextMenu={openContextMenu}
        deleteKeyCode={props.keyboardDisabled ? null : DELETE_KEYS}
        multiSelectionKeyCode="Shift"
        zoomOnDoubleClick={false}
        minZoom={0.25}
      >
        <Background />
        <Controls />
        <MiniMap
          className="wf-minimap"
          pannable
          zoomable
          position="bottom-right"
          style={{ width: 160, height: 110 }}
          maskColor="rgba(240, 242, 245, 0.55)"
          nodeColor="#d1d6db"
          nodeBorderRadius={4}
        />
      </ReactFlow>
      {contextMenu && (
        <NodeContextMenu
          menu={contextMenu}
          onAdd={(kind) => {
            editor.addNode(kind, contextMenu.flowPosition);
            setContextMenu(null);
          }}
          onClose={closeContextMenu}
        />
      )}
    </div>
  );
}
