import { CheckSquare, Trash2 } from "lucide-react";
import {
  classifierSummaryToDraft,
  formatClassifierSignals,
  parseClassifierSignals,
  updateClassifierDraftClass
} from "../model/drafts";
import type { ClassifierSummary, WorkflowClassifierDraft } from "../types";
import { AssetEditorShell, type DraftUpdater } from "./AssetEditorShell";

export function ClassifierAssetEditor(props: {
  savedClassifier: ClassifierSummary | undefined;
  draft: WorkflowClassifierDraft | undefined;
  onDraftChange: (updater: DraftUpdater<WorkflowClassifierDraft>) => void;
}) {
  const editable = props.draft ?? classifierSummaryToDraft(props.savedClassifier);
  const updateDraft = props.onDraftChange;
  if (!editable) {
    return (
      <AssetEditorShell
        title="Classifier 편집"
        subtitle="선택된 classifier가 없습니다."
        actionLabel="새 classifier 초안"
        ariaLabel="분류기 편집"
        onAction={() => updateDraft((draft) => draft)}
      />
    );
  }
  return (
    <AssetEditorShell
      title="Classifier 편집"
      subtitle={props.draft ? "저장 대기 중인 변경사항" : props.savedClassifier ? `${props.savedClassifier.name} 수정` : "새 분류기 초안"}
      actionLabel="클래스 추가"
      ariaLabel="분류기 편집"
      onAction={() =>
        updateDraft((draft) => ({
          ...draft,
          classes: [
            ...draft.classes,
            { class_name: `class_${draft.classes.length + 1}`, description: "분류 기준을 설명하세요.", signals: [] }
          ]
        }))
      }
    >
      <div className="module-config-editor workflow-asset-config-editor">
        <div className="module-form-grid workflow-classifier-form-grid">
          <label>
            <span>설정 이름</span>
            <input
              value={editable.name}
              onChange={(event) => updateDraft((draft) => ({ ...draft, name: event.target.value }))}
              aria-label="classifier 이름"
            />
          </label>
          <label className="module-toggle-row classifier-outcome-note">
            <span>결과 범위</span>
            <strong>{editable.allow_unknown ? "사용자 정의 class 또는 unknown" : "사용자 정의 class"}</strong>
          </label>
        </div>
        <label>
          <span>설명</span>
          <textarea
            value={editable.description ?? ""}
            onChange={(event) => updateDraft((draft) => ({ ...draft, description: event.target.value }))}
            aria-label="classifier 설명"
            rows={2}
          />
        </label>
        <label className="module-toggle-row workflow-asset-toggle-row">
          <span>unknown 허용</span>
          <input
            type="checkbox"
            checked={editable.allow_unknown}
            onChange={(event) => updateDraft((draft) => ({ ...draft, allow_unknown: event.target.checked }))}
          />
        </label>
        <div className="module-section-title workflow-asset-section-title">
          <CheckSquare size={16} />
          <strong>문서 클래스</strong>
        </div>
        <div className="module-table-wrap workflow-asset-table-wrap">
          <table className="module-config-table classifier-table workflow-classifier-config-table">
            <thead>
              <tr>
                <th>문서 클래스</th>
                <th>설명</th>
                <th>판단 신호</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {editable.classes.map((candidate, index) => (
                <tr key={`${candidate.class_name}-${index}`}>
                  <td>
                    <input
                      value={candidate.class_name}
                      onChange={(event) =>
                        updateDraft((draft) => updateClassifierDraftClass(draft, index, { class_name: event.target.value }))
                      }
                      aria-label="분류 클래스명"
                    />
                  </td>
                  <td>
                    <textarea
                      value={candidate.description ?? ""}
                      onChange={(event) =>
                        updateDraft((draft) => updateClassifierDraftClass(draft, index, { description: event.target.value }))
                      }
                      aria-label="분류 클래스 설명"
                    />
                  </td>
                  <td>
                    <textarea
                      value={formatClassifierSignals(candidate.signals ?? [])}
                      onChange={(event) =>
                        updateDraft((draft) =>
                          updateClassifierDraftClass(draft, index, { signals: parseClassifierSignals(event.target.value) })
                        )
                      }
                      aria-label="분류 시그널"
                      placeholder="쉼표 또는 줄바꿈으로 구분"
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-only danger-plain"
                      onClick={() =>
                        updateDraft((draft) => ({ ...draft, classes: draft.classes.filter((_, classIndex) => classIndex !== index) }))
                      }
                      disabled={editable.classes.length <= 1}
                      aria-label="분류 클래스 삭제"
                    >
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </AssetEditorShell>
  );
}
