// 체크리스트 정의 편집: 이름·설명 + 항목 표(항목 · 설명 · 증거 유형 · 필수 · 영역).
// 영역은 RegionPicker 모달로 그린다. 좌표 숫자 입력은 "고급"에 접어 둔다(spec B-5).
import { ScanLine } from "lucide-react";
import { useState } from "react";
import { RegionPicker, type PickerRegion } from "../../components/document/RegionPicker";
import { AutoTextarea, DefinitionTable, IconButton } from "../../components/ui";
import type { DefinitionEditorProps, SchemaRegion } from "../module-batch";
import { CUSTOM_EVIDENCE_TYPE, defaultRegion, EVIDENCE_TYPE_LABELS, EVIDENCE_TYPES, isPresetEvidenceType } from "./model";
import type { RequiredFieldChecklist, RequiredFieldItem } from "./types";

const REGION_FIELDS = ["x", "y", "width", "height"] as const;

/** 그리는 중인 영역과, 저장하면 영역을 붙일 항목 index(없으면 영역만 저장). */
type RegionEdit = { region: SchemaRegion; itemIndex: number | null };

export function RequiredChecklistEditor({ draft, onDraft, showRegions, onShowRegions, document }: DefinitionEditorProps<RequiredFieldChecklist>) {
  const [regionEdit, setRegionEdit] = useState<RegionEdit | null>(null);
  const pages = (document?.pages ?? []).map((page) => ({ id: page.id, page: page.page, image_url: page.image_url }));

  function updateItem(index: number, patch: Partial<RequiredFieldItem>) {
    onDraft({ ...draft, items: draft.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) });
  }
  function updateRegion(index: number, patch: Partial<SchemaRegion>) {
    onDraft({ ...draft, regions: draft.regions.map((region, regionIndex) => (regionIndex === index ? { ...region, ...patch } : region)) });
  }
  function saveRegion(region: PickerRegion, itemIndex: number | null) {
    const exists = draft.regions.some((item) => item.id === region.id);
    const regions = exists ? draft.regions.map((item) => (item.id === region.id ? region : item)) : [...draft.regions, region];
    const items =
      itemIndex === null
        ? draft.items
        : draft.items.map((item, index) => (index === itemIndex ? { ...item, region_id: region.id } : item));
    onDraft({ ...draft, regions, items });
    onShowRegions(true);
    setRegionEdit(null);
  }
  function openRegionFor(itemIndex: number) {
    const regionId = draft.items[itemIndex]?.region_id;
    const region =
      draft.regions.find((item) => item.id === regionId) ??
      { ...defaultRegion(draft.regions.length + 1), name: draft.items[itemIndex]?.item_name || `영역 ${draft.regions.length + 1}` };
    setRegionEdit({ region, itemIndex });
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
      <DefinitionTable
        label="체크 항목"
        rows={draft.items}
        rowKey={(_, index) => String(index)}
        columns={[
          {
            key: "item_name",
            header: "항목",
            width: "20%",
            render: (item, index) => (
              <input
                aria-label={`체크 항목 ${index + 1}`}
                value={item.item_name}
                onChange={(event) => updateItem(index, { item_name: event.target.value })}
              />
            )
          },
          {
            key: "description",
            header: "설명",
            render: (item, index) => (
              <AutoTextarea
                aria-label={`체크 항목 ${index + 1} 설명`}
                value={item.description}
                onChange={(event) => updateItem(index, { description: event.target.value })}
              />
            )
          },
          {
            key: "evidence_type",
            header: "증거 유형",
            width: "17%",
            render: (item, index) => (
              <div className="evidence-type-control">
                <select
                  aria-label={`체크 항목 ${index + 1} 증거 유형`}
                  value={isPresetEvidenceType(item.evidence_type) ? item.evidence_type : CUSTOM_EVIDENCE_TYPE}
                  onChange={(event) =>
                    updateItem(index, { evidence_type: event.target.value === CUSTOM_EVIDENCE_TYPE ? "" : event.target.value })
                  }
                >
                  {EVIDENCE_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {EVIDENCE_TYPE_LABELS[type]}
                    </option>
                  ))}
                  <option value={CUSTOM_EVIDENCE_TYPE}>직접 입력</option>
                </select>
                {!isPresetEvidenceType(item.evidence_type) && (
                  <input
                    aria-label={`체크 항목 ${index + 1} 증거 유형 입력`}
                    value={item.evidence_type}
                    placeholder="증거 유형 입력"
                    onChange={(event) => updateItem(index, { evidence_type: event.target.value })}
                  />
                )}
              </div>
            )
          },
          {
            key: "required",
            header: "필수",
            width: "52px",
            align: "center",
            render: (item, index) => (
              <input
                type="checkbox"
                aria-label={`체크 항목 ${index + 1} 필수`}
                checked={item.required}
                onChange={(event) => updateItem(index, { required: event.target.checked })}
              />
            )
          },
          {
            key: "region",
            header: "영역",
            width: "21%",
            render: (item, index) => (
              <div className="ui-region-cell">
                <select
                  aria-label={`체크 항목 ${index + 1} 영역`}
                  value={item.region_id ?? ""}
                  onChange={(event) => updateItem(index, { region_id: event.target.value || null })}
                >
                  <option value="">전체 페이지</option>
                  {draft.regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={pages.length ? `체크 항목 ${index + 1} 영역 그리기` : "문서를 열면 영역을 그릴 수 있습니다"}
                  disabled={!pages.length}
                  onClick={() => openRegionFor(index)}
                >
                  <ScanLine size={15} />
                </IconButton>
              </div>
            )
          }
        ]}
        onRemove={(index) => onDraft({ ...draft, items: draft.items.filter((_, itemIndex) => itemIndex !== index) })}
        removeLabel={(_, index) => `체크 항목 ${index + 1} 삭제`}
        onAdd={() =>
          onDraft({
            ...draft,
            items: [...draft.items, { item_name: "", description: "", evidence_type: "text_or_handwriting", required: true, region_id: null }]
          })
        }
        addLabel="항목 추가"
      />
      <details className="ui-advanced">
        <summary>
          고급 · 영역 좌표 {draft.regions.length ? `(${draft.regions.length.toLocaleString()}개)` : ""}
        </summary>
        <label className="ui-inline-check">
          <input type="checkbox" checked={showRegions} onChange={(event) => onShowRegions(event.target.checked)} />
          문서 위에 영역 표시
        </label>
        {draft.regions.length ? (
          <DefinitionTable
            label="영역 좌표"
            rows={draft.regions}
            rowKey={(region) => region.id}
            columns={[
              {
                key: "name",
                header: "이름",
                render: (region, index) => (
                  <input aria-label="영역 이름" value={region.name} onChange={(event) => updateRegion(index, { name: event.target.value })} />
                )
              },
              {
                key: "page",
                header: "페이지",
                width: "64px",
                render: (region, index) => (
                  <input
                    aria-label="영역 페이지"
                    type="number"
                    min={1}
                    value={region.page}
                    onChange={(event) => updateRegion(index, { page: Number(event.target.value) || 1 })}
                  />
                )
              },
              ...REGION_FIELDS.map((key) => ({
                key,
                header: key,
                width: "70px",
                render: (region: SchemaRegion, index: number) => (
                  <input
                    aria-label={`영역 ${key}`}
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={region[key]}
                    onChange={(event) => updateRegion(index, { [key]: Number(event.target.value) })}
                  />
                )
              }))
            ]}
            onRemove={(index) => {
              const removed = draft.regions[index];
              onDraft({
                ...draft,
                regions: draft.regions.filter((_, regionIndex) => regionIndex !== index),
                items: draft.items.map((item) => (item.region_id === removed?.id ? { ...item, region_id: null } : item))
              });
            }}
            removeLabel={(region) => `${region.name} 삭제`}
          />
        ) : (
          <p className="ui-field-note">항목의 영역 열에서 그리면 여기에 좌표가 생깁니다.</p>
        )}
      </details>
      {regionEdit && pages.length > 0 && (
        <RegionPicker
          pages={pages}
          region={regionEdit.region}
          onSave={(region) => saveRegion(region, regionEdit.itemIndex)}
          onClose={() => setRegionEdit(null)}
        />
      )}
    </div>
  );
}
