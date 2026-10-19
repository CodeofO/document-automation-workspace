// "속성" 탭 본문: 선택에 따라 워크플로우·노드·연결·여러 노드 Inspector 중 하나를 보여준다.
// 노드를 더블클릭하면(focusRequest 증가) 설정의 첫 입력에 포커스를 준다.
import { useEffect, useRef } from "react";
import type { WorkflowEditor } from "../canvas/useWorkflowEditorState";
import type { WorkflowRunLauncher } from "../canvas/useWorkflowRunLauncher";
import { NodeInspector } from "./NodeInspector";
import { EdgeInspector, MultiSelectionInspector } from "./SelectionInspectors";
import { WorkflowInspector } from "./WorkflowInspector";

export function WorkflowSelectionInspector(props: { editor: WorkflowEditor; launcher: WorkflowRunLauncher; focusRequest: number }) {
  const { editor, launcher } = props;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectNode = (nodeId: string) => editor.selectNodes([nodeId]);
  const nodeLabel = (nodeId: string) => editor.nodes.find((node) => node.id === nodeId)?.data.label;

  useEffect(() => {
    if (!props.focusRequest) return;
    const container = containerRef.current;
    const target =
      container?.querySelector<HTMLElement>("[data-inspector-first-field]") ??
      container?.querySelector<HTMLElement>("input, select, textarea");
    target?.focus();
  }, [props.focusRequest]);

  let body;
  if (editor.selectedEdge) {
    body = (
      <EdgeInspector
        edge={editor.selectedEdge}
        nodes={editor.nodes}
        onSelectNode={selectNode}
        onDelete={editor.deleteEdge}
      />
    );
  } else if (editor.selectedNodes.length > 1) {
    const ids = editor.selectedNodes.map((node) => node.id);
    body = (
      <MultiSelectionInspector
        nodes={editor.selectedNodes}
        onSelectNode={selectNode}
        onDuplicate={() => editor.duplicateNodes(ids)}
        onDelete={() => editor.deleteNodes(ids)}
      />
    );
  } else if (editor.selectedNodes.length === 1) {
    const node = editor.selectedNodes[0];
    body = (
      <NodeInspector
        key={node.id}
        node={node}
        nodes={editor.nodes}
        edges={editor.edges}
        assets={editor.assets}
        drafts={editor.drafts}
        issues={editor.issues.filter((issue) => issue.nodeId === node.id)}
        updateNodeConfig={editor.updateNodeConfig}
        onOpenAssetEditor={editor.openAssetDrawer}
        onStartNewDraft={(target) => {
          editor.assetDrafts.startNewDraft(target);
          editor.openAssetDrawer(target.id);
        }}
        onDiscardDraft={editor.assetDrafts.discardDraft}
        onSelectNode={selectNode}
        onRename={editor.renameNode}
        onDuplicate={(nodeId) => editor.duplicateNodes([nodeId])}
        onDelete={(nodeId) => editor.deleteNodes([nodeId])}
      />
    );
  } else {
    body = (
      <WorkflowInspector
        workflowName={editor.workflowName}
        description={editor.workflowDescription}
        onDescriptionChange={editor.setWorkflowDescription}
        nodeCount={editor.nodes.length}
        edgeCount={editor.edges.length}
        issues={editor.issues}
        nodeLabel={nodeLabel}
        onSelectNode={selectNode}
        files={launcher.files}
        libraryDocuments={launcher.libraryDocuments}
        onClearDocuments={launcher.clearDocuments}
      />
    );
  }
  return (
    <div ref={containerRef} className="wf-inspector-scroll">
      {body}
    </div>
  );
}
