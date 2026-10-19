// 분류기 정의 편집: 이름·설명 + 문서 클래스 표(클래스 · 설명 · 판단 신호).
import { AutoTextarea, DefinitionTable } from "../../components/ui";
import type { DefinitionEditorProps } from "../module-batch";
import { signalText } from "./model";
import type { ClassCandidateDraft, ClassifierDraft } from "./types";

export function ClassifierConfigEditor({ draft, onDraft }: DefinitionEditorProps<ClassifierDraft>) {
  function updateClass(index: number, patch: Partial<ClassCandidateDraft>) {
    onDraft({ ...draft, classes: draft.classes.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) });
  }
  return (
    <div className="module-definition-editor">
      <div className="ui-form-grid">
        <label className="ui-field">
          <span>이름</span>
          <input value={draft.name} onChange={(event) => onDraft({ ...draft, name: event.target.value })} />
        </label>
        <label className="ui-field">
          <span>설명</span>
          <AutoTextarea value={draft.description ?? ""} onChange={(event) => onDraft({ ...draft, description: event.target.value })} />
        </label>
      </div>
      <p className="ui-field-note">결과는 아래 클래스 중 하나 또는 미분류(unknown)입니다.</p>
      <DefinitionTable
        label="문서 클래스"
        rows={draft.classes}
        rowKey={(_, index) => String(index)}
        columns={[
          {
            key: "class_name",
            header: "클래스",
            width: "26%",
            render: (item, index) => (
              <input
                aria-label={`문서 클래스 ${index + 1}`}
                value={item.class_name}
                onChange={(event) => updateClass(index, { class_name: event.target.value })}
              />
            )
          },
          {
            key: "description",
            header: "설명",
            render: (item, index) => (
              <AutoTextarea
                aria-label={`문서 클래스 ${index + 1} 설명`}
                value={item.description}
                onChange={(event) => updateClass(index, { description: event.target.value })}
              />
            )
          },
          {
            key: "signals",
            header: "판단 신호",
            width: "30%",
            render: (item, index) => (
              <AutoTextarea
                aria-label={`문서 클래스 ${index + 1} 판단 신호`}
                placeholder="한 줄에 하나씩"
                value={signalText(item)}
                onChange={(event) => updateClass(index, { signals_text: event.target.value })}
              />
            )
          }
        ]}
        onRemove={(index) => onDraft({ ...draft, classes: draft.classes.filter((_, itemIndex) => itemIndex !== index) })}
        removeLabel={(_, index) => `문서 클래스 ${index + 1} 삭제`}
        onAdd={() =>
          onDraft({ ...draft, classes: [...draft.classes, { class_name: "", description: "", signals: [], signals_text: "" }] })
        }
        addLabel="클래스 추가"
      />
    </div>
  );
}
