import { CheckSquare, Trash2 } from "lucide-react";
import {
  checklistSummaryToDraft,
  updateChecklistDraftItem,
  WORKFLOW_CUSTOM_EVIDENCE_TYPE_VALUE,
  WORKFLOW_EVIDENCE_TYPE_LABELS,
  WORKFLOW_EVIDENCE_TYPES,
  workflowEvidenceTypeIsPreset
} from "../model/drafts";
import type { ChecklistSummary, WorkflowChecklistDraft } from "../types";
import { AssetEditorShell, type DraftUpdater } from "./AssetEditorShell";

export function ChecklistAssetEditor(props: {
  savedChecklist: ChecklistSummary | undefined;
  draft: WorkflowChecklistDraft | undefined;
  onDraftChange: (updater: DraftUpdater<WorkflowChecklistDraft>) => void;
}) {
  const editable = props.draft ?? checklistSummaryToDraft(props.savedChecklist);
  const updateDraft = props.onDraftChange;
  if (!editable) {
    return (
      <AssetEditorShell
        title="Checklist 편집"
        subtitle="선택된 checklist가 없습니다."
        actionLabel="새 checklist 초안"
        onAction={() => updateDraft((draft) => draft)}
      />
    );
  }
  const status = props.draft ? "저장 대기 중인 변경사항" : props.savedChecklist ? `${props.savedChecklist.name} 수정` : "새 checklist 초안";
  return (
    <AssetEditorShell
      className="compact-list"
      title="Checklist 편집"
      subtitle={`${status} · ${editable.items.length.toLocaleString()}개 항목`}
      actionLabel="항목 추가"
      onAction={() =>
        updateDraft((draft) => ({
          ...draft,
          items: [
            ...draft.items,
            {
              item_name: `항목 ${draft.items.length + 1}`,
              description: "확인할 항목을 설명하세요.",
              evidence_type: "text_or_handwriting",
              required: true
            }
          ]
        }))
      }
    >
      <div className="module-config-editor workflow-asset-config-editor">
        <div className="module-form-grid workflow-checklist-form-grid">
          <label>
            <span>설정 이름</span>
            <input
              value={editable.name}
              onChange={(event) => updateDraft((draft) => ({ ...draft, name: event.target.value }))}
              aria-label="checklist 이름"
            />
          </label>
          <label>
            <span>설명</span>
            <textarea
              value={editable.description ?? ""}
              onChange={(event) => updateDraft((draft) => ({ ...draft, description: event.target.value }))}
              aria-label="checklist 설명"
              rows={2}
            />
          </label>
        </div>
        <div className="module-section-title workflow-asset-section-title">
          <CheckSquare size={16} />
          <strong>필요 부분 체크</strong>
        </div>
        <div className="module-table-wrap workflow-asset-table-wrap">
          <table className="module-config-table checklist-table workflow-checklist-config-table">
            <thead>
              <tr>
                <th>체크 항목</th>
                <th>설명</th>
                <th>증거 유형</th>
                <th>필수</th>
                <th>영역</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {editable.items.map((item, index) => {
                const evidenceType = item.evidence_type || "text_or_handwriting";
                const isPreset = workflowEvidenceTypeIsPreset(evidenceType);
                return (
                  <tr key={`${item.item_name}-${index}`}>
                    <td>
                      <input
                        value={item.item_name}
                        onChange={(event) =>
                          updateDraft((draft) => updateChecklistDraftItem(draft, index, { item_name: event.target.value }))
                        }
                        aria-label="체크리스트 항목명"
                      />
                    </td>
                    <td>
                      <textarea
                        value={item.description ?? ""}
                        onChange={(event) =>
                          updateDraft((draft) => updateChecklistDraftItem(draft, index, { description: event.target.value }))
                        }
                        aria-label="체크리스트 설명"
                      />
                    </td>
                    <td>
                      <div className="evidence-type-control">
                        <select
                          value={isPreset ? evidenceType : WORKFLOW_CUSTOM_EVIDENCE_TYPE_VALUE}
                          onChange={(event) =>
                            updateDraft((draft) =>
                              updateChecklistDraftItem(draft, index, {
                                evidence_type: event.target.value === WORKFLOW_CUSTOM_EVIDENCE_TYPE_VALUE ? "" : event.target.value
                              })
                            )
                          }
                          aria-label="증거 타입"
                        >
                          {WORKFLOW_EVIDENCE_TYPES.map((type) => (
                            <option key={type} value={type}>
                              {WORKFLOW_EVIDENCE_TYPE_LABELS[type]}
                            </option>
                          ))}
                          <option value={WORKFLOW_CUSTOM_EVIDENCE_TYPE_VALUE}>직접 입력</option>
                        </select>
                        {!isPreset && (
                          <input
                            value={item.evidence_type || ""}
                            placeholder="증거 유형 입력"
                            onChange={(event) =>
                              updateDraft((draft) => updateChecklistDraftItem(draft, index, { evidence_type: event.target.value }))
                            }
                            aria-label="직접 입력 증거 타입"
                          />
                        )}
                      </div>
                    </td>
                    <td>
                      <input
                        type="checkbox"
                        checked={item.required ?? true}
                        onChange={(event) =>
                          updateDraft((draft) => updateChecklistDraftItem(draft, index, { required: event.target.checked }))
                        }
                        aria-label="필수 여부"
                      />
                    </td>
                    <td>
                      <select
                        value={item.region_id ?? ""}
                        onChange={(event) =>
                          updateDraft((draft) => updateChecklistDraftItem(draft, index, { region_id: event.target.value || null }))
                        }
                        aria-label="체크리스트 영역"
                      >
                        <option value="">-</option>
                        {(editable.regions ?? []).map((region) => (
                          <option key={region.id} value={region.id}>
                            {region.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="icon-only danger-plain"
                        onClick={() =>
                          updateDraft((draft) => ({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) }))
                        }
                        disabled={editable.items.length <= 1}
                        aria-label="체크리스트 항목 삭제"
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </AssetEditorShell>
  );
}
