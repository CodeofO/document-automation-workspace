// Schema 정의 카드 본문(spec B-5): 이름·설명 + 필드 표(필드명 · 설명 · 타입 · 영역 · AI 검수).
// 영역 열은 공용 RegionPicker로 그린다. 영역 목록·좌표는 "영역 관리"에서 고친다.
import { ClipboardList, ScanLine, Sparkles } from "lucide-react";
import { useState } from "react";
import { RegionPicker, type PickerPage } from "../../../components/document/RegionPicker";
import { AutoTextarea, Button, DefinitionTable, IconButton } from "../../../components/ui";
import type { SchemaDraft } from "../hooks/useSchemaDraft";
import { createRegionId } from "../model/schema";
import { OUTPUT_FORMATS, type OutputFormat, type SchemaRegion } from "../types";
import { RegionManagerDialog } from "./RegionModals";

export function SchemaEditor(props: {
  schema: SchemaDraft;
  pages: PickerPage[];
  activePage: number;
  onRecommendDescription: () => void;
}) {
  const { schema } = props;
  const [regionEdit, setRegionEdit] = useState<{ region: SchemaRegion; fieldIndex: number } | null>(null);
  const [managerOpen, setManagerOpen] = useState(false);
  const canDraw = props.pages.length > 0;

  function openRegionFor(fieldIndex: number) {
    const field = schema.fields[fieldIndex];
    const existing = schema.regions.find((region) => region.id === field?.region_id);
    const page = props.pages[Math.min(props.activePage, props.pages.length - 1)]?.page ?? 1;
    setRegionEdit({
      fieldIndex,
      region: existing ?? {
        id: createRegionId(schema.regions),
        name: field?.key_name || `영역 ${schema.regions.length + 1}`,
        page,
        x: 0.1,
        y: 0.1,
        width: 0.25,
        height: 0.12
      }
    });
  }

  return (
    <div className="module-definition-editor">
      <div className="ui-form-grid">
        <label className="ui-field">
          <span>이름</span>
          <input aria-label="Schema 이름" value={schema.schemaName} onChange={(event) => schema.setName(event.target.value)} />
        </label>
        <label className="ui-field">
          <span className="ui-field-label-row">
            설명
            <button
              type="button"
              className="ui-link-button"
              disabled={!schema.fields.length}
              title="현재 필드만 보고 schema 설명을 다시 씁니다."
              onClick={props.onRecommendDescription}
            >
              <Sparkles size={12} /> AI로 다듬기
            </button>
          </span>
          <AutoTextarea value={schema.schemaDescription} onChange={(event) => schema.setDescription(event.target.value)} />
        </label>
      </div>
      {!schema.meaningful && (
        <div className="ui-hint-row">
          <span>처음이면 샘플 schema로 시작해 보세요.</span>
          <Button size="sm" icon={<ClipboardList size={14} />} onClick={schema.applySample}>
            샘플 schema 사용
          </Button>
        </div>
      )}
      <DefinitionTable
        label="Schema 필드"
        rows={schema.fields}
        rowKey={(field) => field.local_id}
        columns={[
          {
            key: "key_name",
            header: "필드명",
            width: "20%",
            render: (field, index) => (
              <input
                aria-label="필드명"
                value={field.key_name}
                onChange={(event) => schema.updateField(index, { key_name: event.target.value })}
              />
            )
          },
          {
            key: "description",
            header: "설명",
            render: (field, index) => (
              <AutoTextarea
                aria-label="설명"
                value={field.description}
                placeholder="값을 어디서 어떻게 찾을지 입력하세요"
                onChange={(event) => schema.updateField(index, { description: event.target.value })}
              />
            )
          },
          {
            key: "output_format",
            header: "타입",
            width: "92px",
            render: (field, index) => (
              <select
                aria-label="출력 형식"
                value={field.output_format}
                onChange={(event) => schema.updateField(index, { output_format: event.target.value as OutputFormat })}
              >
                {OUTPUT_FORMATS.map((format) => (
                  <option key={format} value={format}>
                    {format}
                  </option>
                ))}
              </select>
            )
          },
          {
            key: "region",
            header: "영역",
            width: "20%",
            render: (field, index) => (
              <div className="ui-region-cell">
                <select
                  aria-label="영역"
                  value={field.region_id ?? ""}
                  onChange={(event) => schema.updateField(index, { region_id: event.target.value || null, region: null })}
                >
                  <option value="">전체 페이지</option>
                  {schema.regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>
                <IconButton
                  size="sm"
                  variant="ghost"
                  label={canDraw ? `${field.key_name || "필드"} 영역 그리기` : "문서를 열면 영역을 그릴 수 있습니다"}
                  disabled={!canDraw}
                  onClick={() => openRegionFor(index)}
                >
                  <ScanLine size={15} />
                </IconButton>
              </div>
            )
          },
          {
            key: "judgement",
            header: "AI 검수",
            width: "64px",
            align: "center",
            render: (field, index) => (
              <input
                type="checkbox"
                aria-label={`${field.key_name || "필드"} AI 검수`}
                title="1차 추출 후 AI가 한 번 더 판단하고 필요할 때만 보정합니다."
                checked={Boolean(field.judgement_enabled)}
                onChange={(event) => schema.updateField(index, { judgement_enabled: event.target.checked })}
              />
            )
          }
        ]}
        onRemove={schema.removeField}
        removeLabel={(field) => `${field.key_name || "필드"} 삭제`}
        onAdd={schema.addField}
        addLabel="필드 추가"
        footerActions={
          <Button size="sm" variant="ghost" icon={<ScanLine size={14} />} onClick={() => setManagerOpen(true)}>
            영역 관리 {schema.regions.length ? `(${schema.regions.length})` : ""}
          </Button>
        }
      />
      {regionEdit && canDraw && (
        <RegionPicker
          pages={props.pages}
          region={regionEdit.region}
          onSave={(region) => {
            schema.saveRegion(region, regionEdit.fieldIndex);
            setRegionEdit(null);
          }}
          onClose={() => setRegionEdit(null)}
        />
      )}
      {managerOpen && (
        <RegionManagerDialog
          pages={props.pages}
          regions={schema.regions}
          activePage={props.activePage}
          onSaveRegion={(region) => schema.saveRegion(region)}
          onRemoveRegion={schema.removeRegion}
          onClose={() => setManagerOpen(false)}
        />
      )}
    </div>
  );
}
