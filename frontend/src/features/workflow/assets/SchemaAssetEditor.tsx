import { Sparkles, Trash2 } from "lucide-react";
import { schemaSummaryToDraft, updateSchemaDraftField } from "../model/drafts";
import type { SchemaSummary, WorkflowOutputFormat, WorkflowSchemaDraft } from "../types";
import { AssetEditorShell, type DraftUpdater } from "./AssetEditorShell";

export function SchemaAssetEditor(props: {
  savedSchema: SchemaSummary | undefined;
  draft: WorkflowSchemaDraft | undefined;
  onDraftChange: (updater: DraftUpdater<WorkflowSchemaDraft>) => void;
}) {
  const editable = props.draft ?? schemaSummaryToDraft(props.savedSchema);
  const updateDraft = props.onDraftChange;
  if (!editable) {
    return (
      <AssetEditorShell
        title="Schema 편집"
        subtitle="선택된 schema가 없습니다."
        actionLabel="새 schema 초안"
        onAction={() => updateDraft((draft) => draft)}
      />
    );
  }
  return (
    <AssetEditorShell
      title="Schema 편집"
      subtitle={props.draft ? "저장 대기 중인 변경사항" : props.savedSchema ? `${props.savedSchema.name} 수정` : "AI 생성 초안"}
      actionLabel="필드 추가"
      onAction={() =>
        updateDraft((draft) => ({
          ...draft,
          fields: [
            ...draft.fields,
            { key_name: `field_${draft.fields.length + 1}`, description: "추출할 값을 설명하세요.", output_format: "string" }
          ]
        }))
      }
    >
      <div className="module-config-editor workflow-asset-config-editor">
        <div className="module-form-grid workflow-schema-form-grid">
          <label>
            <span>Schema 이름</span>
            <input
              value={editable.name}
              onChange={(event) => updateDraft((draft) => ({ ...draft, name: event.target.value }))}
              aria-label="schema 이름"
            />
          </label>
          <label>
            <span>표시 이름</span>
            <input
              value={editable.display_name ?? ""}
              onChange={(event) => updateDraft((draft) => ({ ...draft, display_name: event.target.value }))}
              aria-label="schema 표시 이름"
            />
          </label>
          <label>
            <span>설명</span>
            <textarea
              value={editable.description ?? ""}
              onChange={(event) => updateDraft((draft) => ({ ...draft, description: event.target.value }))}
              aria-label="schema 설명"
              rows={2}
            />
          </label>
        </div>
        <div className="module-section-title workflow-asset-section-title">
          <Sparkles size={16} />
          <strong>Schema 필드</strong>
        </div>
        <div className="module-table-wrap workflow-asset-table-wrap">
          <table className="module-config-table workflow-schema-config-table">
            <thead>
              <tr>
                <th>필드명</th>
                <th>설명</th>
                <th>타입</th>
                <th>영역</th>
                <th>AI 검수</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {editable.fields.map((field, index) => (
                <tr key={`${field.key_name}-${index}`}>
                  <td>
                    <input
                      value={field.key_name}
                      onChange={(event) => updateDraft((draft) => updateSchemaDraftField(draft, index, { key_name: event.target.value }))}
                      aria-label="필드명"
                    />
                  </td>
                  <td>
                    <textarea
                      className="schema-description-input"
                      value={field.description}
                      onChange={(event) =>
                        updateDraft((draft) => updateSchemaDraftField(draft, index, { description: event.target.value }))
                      }
                      aria-label="필드 설명"
                    />
                  </td>
                  <td>
                    <select
                      value={field.output_format}
                      onChange={(event) =>
                        updateDraft((draft) =>
                          updateSchemaDraftField(draft, index, { output_format: event.target.value as WorkflowOutputFormat })
                        )
                      }
                      aria-label="출력 형식"
                    >
                      <option value="string">string</option>
                      <option value="float">float</option>
                      <option value="bool">bool</option>
                      <option value="date">date</option>
                    </select>
                  </td>
                  <td>
                    <select
                      value={field.region_id ?? ""}
                      onChange={(event) =>
                        updateDraft((draft) => updateSchemaDraftField(draft, index, { region_id: event.target.value || null }))
                      }
                      aria-label="영역"
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
                    <label className="workflow-table-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(field.judgement_enabled)}
                        onChange={(event) =>
                          updateDraft((draft) => updateSchemaDraftField(draft, index, { judgement_enabled: event.target.checked }))
                        }
                      />
                      <span>{field.judgement_enabled ? "사용" : "미사용"}</span>
                    </label>
                  </td>
                  <td>
                    <button
                      type="button"
                      className="icon-only danger-plain"
                      onClick={() =>
                        updateDraft((draft) => ({ ...draft, fields: draft.fields.filter((_, fieldIndex) => fieldIndex !== index) }))
                      }
                      disabled={editable.fields.length <= 1}
                      aria-label="필드 삭제"
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
