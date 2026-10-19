// 에셋 편집 Drawer. Inspector의 "에셋 편집" 버튼이나 Enter로만 열린다(선택만으로는 열리지 않음).
// 닫아도 노드 선택은 그대로다. 편집 내용은 노드별 초안으로 남고, 워크플로우 저장·실행 때 에셋으로 저장된다.
import { Button, Drawer } from "../../../components/ui";
import type { AssetDraftsController } from "../canvas/useAssetDrafts";
import { nodeKindLabel } from "../model/graph";
import { nodeAssetInfo } from "../model/nodeAssets";
import type { WorkflowAssets, WorkflowNode } from "../types";
import { ChecklistAssetEditor } from "./ChecklistAssetEditor";
import { ClassifierAssetEditor } from "./ClassifierAssetEditor";
import { SchemaAssetEditor } from "./SchemaAssetEditor";

export function AssetEditorDrawer(props: {
  node: WorkflowNode | null;
  assets: WorkflowAssets;
  assetDrafts: AssetDraftsController;
  onClose: () => void;
}) {
  const { node, assets, assetDrafts } = props;
  const info = node ? nodeAssetInfo(node, assets, assetDrafts.drafts) : null;
  if (!node || !info) return null;
  const config = node.data.config ?? {};
  const { drafts } = assetDrafts;

  return (
    <Drawer
      open
      eyebrow={`${nodeKindLabel(node.data.kind)} · ${info.label} 편집`}
      title={
        <span className="wf-drawer-title">
          {node.data.label}
          {info.hasDraft && (
            <span className="wf-draft-pill" title="저장되지 않은 초안">
              ● 미저장 초안
            </span>
          )}
        </span>
      }
      onClose={props.onClose}
      footer={
        <div className="wf-drawer-footer">
          <span>변경 내용은 이 노드의 초안으로 남고, 워크플로우를 저장하거나 실행할 때 {info.label}로 저장됩니다.</span>
          <Button variant="primary" size="sm" onClick={props.onClose}>
            완료
          </Button>
        </div>
      }
    >
      {node.data.kind === "classifier" && (
        <ClassifierAssetEditor
          savedClassifier={assets.classifiers.find((item) => item.id === config.classifier_id)}
          draft={drafts.classifierDraftsByNodeId[node.id]}
          onDraftChange={(updater) => assetDrafts.updateClassifierDraft(node.id, updater)}
        />
      )}
      {node.data.kind === "kie" && (
        <SchemaAssetEditor
          savedSchema={assets.schemas.find((item) => item.id === config.schema_id)}
          draft={drafts.schemaDraftsByNodeId[node.id]}
          onDraftChange={(updater) => assetDrafts.updateSchemaDraft(node.id, updater)}
        />
      )}
      {node.data.kind === "required-checker" && (
        <ChecklistAssetEditor
          savedChecklist={assets.checklists.find((item) => item.id === config.checklist_id)}
          draft={drafts.checklistDraftsByNodeId[node.id]}
          onDraftChange={(updater) => assetDrafts.updateChecklistDraft(node.id, updater)}
        />
      )}
    </Drawer>
  );
}
