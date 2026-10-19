// 선택한 표 스키마(TableSpec) 설정 + 칼럼 표(DefinitionTable) + 행 검증 규칙.
import type { CSSProperties } from "react";
import { Calculator, Eraser, Fingerprint, Trash2 } from "lucide-react";
import { AutoTextarea, Button, DefinitionTable, IconButton } from "../../../components/ui";
import {
  COLUMN_TYPE_LABELS,
  formatHeaderPath,
  newColumn,
  newRule,
  nextColumnKey,
  parseHeaderPath,
  renameColumnInRules
} from "../model/template";
import {
  TABLE_COLUMN_TYPES,
  type TableColumnSpec,
  type TableColumnType,
  type TableRuleSpec,
  type TableSpec
} from "../types";
import { TagInput } from "./TagInput";

function formatRegion(spec: TableSpec) {
  if (!spec.region) return null;
  const { x, y, width, height } = spec.region;
  return `x ${x.toFixed(3)} · y ${y.toFixed(3)} · w ${width.toFixed(3)} · h ${height.toFixed(3)}`;
}

export function TableSpecEditor(props: { spec: TableSpec; colorVar: string; onChange: (spec: TableSpec) => void }) {
  const { spec } = props;
  const set = (patch: Partial<TableSpec>) => props.onChange({ ...spec, ...patch });

  function updateColumn(index: number, patch: Partial<TableColumnSpec>) {
    const before = spec.columns[index];
    const columns = spec.columns.map((column, columnIndex) =>
      columnIndex === index ? { ...column, ...patch } : column
    );
    const rules =
      patch.key !== undefined && before && patch.key.trim() && before.key !== patch.key
        ? renameColumnInRules(spec.rules, before.key, patch.key.trim())
        : spec.rules;
    props.onChange({ ...spec, columns, rules });
  }

  function updateRule(index: number, patch: Partial<TableRuleSpec>) {
    set({ rules: spec.rules.map((rule, ruleIndex) => (ruleIndex === index ? { ...rule, ...patch } : rule)) });
  }

  const regionText = formatRegion(spec);
  const columnKeys = spec.columns.map((column) => column.key).filter(Boolean);

  return (
    <div className="table-spec-editor">
      <div className="ui-form-grid table-spec-identity">
        <label className="ui-field">
          <span>표 이름</span>
          <input aria-label="표 이름" value={spec.name} onChange={(event) => set({ name: event.target.value })} />
        </label>
        <label className="ui-field">
          <span>표 key</span>
          <input
            aria-label="표 key"
            value={spec.key}
            spellCheck={false}
            title="양식 안에서 유일한 key. export 시트·결과 key로 쓰입니다."
            onChange={(event) => set({ key: event.target.value.replace(/\s+/g, "_") })}
          />
        </label>
      </div>
      <label className="ui-field">
        <span>설명</span>
        <AutoTextarea
          aria-label="표 설명"
          placeholder="예: 수주처별 주입 기록, 한 행 = 한 제품"
          value={spec.description ?? ""}
          onChange={(event) => set({ description: event.target.value })}
        />
      </label>

      <div className="table-region-status" style={{ "--region-color": props.colorVar } as CSSProperties}>
        <span className="table-region-swatch" aria-hidden />
        {regionText ? (
          <>
            <span>
              영역 <code>{regionText}</code>
            </span>
            <Button size="sm" variant="ghost" icon={<Eraser size={14} />} onClick={() => set({ region: null })}>
              영역 지우기
            </Button>
          </>
        ) : (
          <span>영역 없음 · 왼쪽 샘플 이미지에서 끌어 표 영역을 그리세요. 없으면 페이지 전체에서 찾습니다.</span>
        )}
      </div>

      <div className="table-spec-grid">
        <label className="ui-field">
          <span>행 수</span>
          <select
            aria-label="행 수 방식"
            value={spec.row_count.mode}
            onChange={(event) => {
              const mode = event.target.value as TableSpec["row_count"]["mode"];
              set({ row_count: { mode, value: mode === "unknown" ? null : (spec.row_count.value ?? 10) } });
            }}
          >
            <option value="unknown">정하지 않음</option>
            <option value="exact">정확히</option>
            <option value="max">최대</option>
          </select>
        </label>
        <label className="ui-field">
          <span>행 수 값</span>
          <input
            aria-label="행 수 값"
            type="number"
            min={1}
            max={1000}
            disabled={spec.row_count.mode === "unknown"}
            value={spec.row_count.value ?? ""}
            onChange={(event) =>
              set({
                row_count: {
                  ...spec.row_count,
                  value: event.target.value ? Math.max(1, Number(event.target.value)) : null
                }
              })
            }
          />
        </label>
        <label className="ui-field">
          <span>빈 줄</span>
          <select
            aria-label="빈 줄 처리"
            value={spec.blank_rows}
            onChange={(event) => set({ blank_rows: event.target.value as TableSpec["blank_rows"] })}
          >
            <option value="skip">건너뜀</option>
            <option value="keep">유지</option>
          </select>
        </label>
        <label className="ui-field">
          <span>영역 여백(%)</span>
          <input
            aria-label="영역 여백"
            type="number"
            min={0}
            max={50}
            step={1}
            value={Math.round(spec.region_padding * 100)}
            onChange={(event) =>
              set({ region_padding: Math.min(0.5, Math.max(0, Number(event.target.value || 0) / 100)) })
            }
          />
        </label>
      </div>
      <div className="ui-form-grid table-spec-hints">
        <label className="ui-field">
          <span>표 끝 힌트</span>
          <input
            aria-label="표 끝 힌트"
            placeholder="예: '일일누계' 줄 위까지"
            value={spec.end_hint ?? ""}
            onChange={(event) => set({ end_hint: event.target.value })}
          />
        </label>
        <label className="ui-field">
          <span>행 단위 힌트</span>
          <input
            aria-label="행 단위 힌트"
            placeholder="예: 주입 1건(2줄짜리 행)"
            value={spec.row_unit_hint ?? ""}
            onChange={(event) => set({ row_unit_hint: event.target.value })}
          />
        </label>
      </div>

      <DefinitionTable
        label={`${spec.name || spec.key} 칼럼`}
        className="table-column-table"
        rows={spec.columns}
        rowKey={(_, index) => `${spec.key}-${index}`}
        columns={[
          {
            key: "key",
            header: "칼럼명",
            width: "17%",
            render: (column, index) => (
              <input
                aria-label={`칼럼 ${index + 1} 이름`}
                value={column.key}
                onChange={(event) => updateColumn(index, { key: event.target.value })}
              />
            )
          },
          {
            key: "header_path",
            header: "원본 머리글",
            width: "17%",
            render: (column, index) => (
              <input
                // 밖에서 값이 바뀌면(AI 초안) 다시 그린다. 입력 중에는 구분자를 그대로 두고 칸을 떠날 때 정리한다.
                key={formatHeaderPath(column.header_path)}
                aria-label={`칼럼 ${index + 1} 원본 머리글`}
                placeholder="주입수량 › 실적"
                title="2단 머리글은 쉼표 또는 › 로 구분"
                defaultValue={formatHeaderPath(column.header_path)}
                onBlur={(event) => {
                  const next = parseHeaderPath(event.target.value);
                  if (next.join("\u0000") !== column.header_path.join("\u0000"))
                    updateColumn(index, { header_path: next });
                }}
              />
            )
          },
          {
            key: "type",
            header: "형식",
            width: "12%",
            render: (column, index) => (
              <select
                aria-label={`칼럼 ${index + 1} 형식`}
                value={column.type}
                onChange={(event) => updateColumn(index, { type: event.target.value as TableColumnType })}
              >
                {TABLE_COLUMN_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {COLUMN_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            )
          },
          {
            key: "description",
            header: "설명·판독 힌트",
            width: "21%",
            render: (column, index) => (
              <AutoTextarea
                aria-label={`칼럼 ${index + 1} 설명`}
                placeholder="예: 26C266처럼 숫자·영문"
                value={column.description ?? ""}
                onChange={(event) => updateColumn(index, { description: event.target.value })}
              />
            )
          },
          {
            key: "options",
            header: "옵션",
            render: (column, index) => (
              <div className="table-column-options">
                {column.type === "choice" && (
                  <>
                    <TagInput
                      label={`칼럼 ${index + 1} 허용 값`}
                      placeholder="허용 값 입력 후 Enter"
                      values={column.choices}
                      onChange={(choices) => updateColumn(index, { choices })}
                    />
                    <label className="table-check">
                      <input
                        type="checkbox"
                        checked={column.choice_allow_number}
                        onChange={(event) => updateColumn(index, { choice_allow_number: event.target.checked })}
                      />
                      숫자도 허용
                    </label>
                  </>
                )}
                {column.type === "checkbox" && (
                  <TagInput
                    label={`칼럼 ${index + 1} 체크 칸`}
                    placeholder="칸 이름(A1, A2 …)"
                    values={column.checkbox_options}
                    onChange={(checkbox_options) => updateColumn(index, { checkbox_options })}
                  />
                )}
                {column.type === "number" && (
                  <select
                    aria-label={`칼럼 ${index + 1} 숫자 구분자`}
                    value={column.number_format}
                    onChange={(event) =>
                      updateColumn(index, { number_format: event.target.value as TableColumnSpec["number_format"] })
                    }
                  >
                    <option value="auto">구분자 자동</option>
                    <option value="dot_decimal">. 소수점</option>
                    <option value="dot_thousands">. 천 단위</option>
                  </select>
                )}
                <div className="table-check-row">
                  <label className="table-check" title="결과에 원문(raw)을 함께 내보냅니다">
                    <input
                      type="checkbox"
                      aria-label={`칼럼 ${index + 1} 원문 보존`}
                      checked={column.keep_raw}
                      onChange={(event) => updateColumn(index, { keep_raw: event.target.checked })}
                    />
                    원문
                  </label>
                  <label className="table-check" title="〃(같음) 표시를 위 행 값으로 채웁니다">
                    <input
                      type="checkbox"
                      aria-label={`칼럼 ${index + 1} 〃 채우기`}
                      checked={column.ditto === "fill_from_above"}
                      onChange={(event) =>
                        updateColumn(index, { ditto: event.target.checked ? "fill_from_above" : "keep" })
                      }
                    />
                    〃 채우기
                  </label>
                  <label className="table-check" title="비어 있으면 행을 검토 필요로 표시합니다">
                    <input
                      type="checkbox"
                      aria-label={`칼럼 ${index + 1} 필수`}
                      checked={column.required}
                      onChange={(event) => updateColumn(index, { required: event.target.checked })}
                    />
                    필수
                  </label>
                </div>
              </div>
            )
          }
        ]}
        onRemove={(index) => {
          const removed = spec.columns[index]?.key;
          set({
            columns: spec.columns.filter((_, columnIndex) => columnIndex !== index),
            rules: spec.rules.map((rule) =>
              rule.kind === "unique" ? { ...rule, columns: rule.columns.filter((column) => column !== removed) } : rule
            )
          });
        }}
        removeLabel={(column, index) => `칼럼 ${column.key || index + 1} 삭제`}
        onAdd={() => set({ columns: [...spec.columns, newColumn(nextColumnKey(spec.columns))] })}
        addLabel="칼럼 추가"
      />

      <section className="table-rules" aria-label="행 검증 규칙">
        <header>
          <h4>행 검증 규칙</h4>
          <div className="table-rules-actions">
            <Button
              size="sm"
              icon={<Calculator size={14} />}
              onClick={() => set({ rules: [...spec.rules, newRule("row_formula")] })}
            >
              계산 규칙
            </Button>
            <Button
              size="sm"
              icon={<Fingerprint size={14} />}
              onClick={() => set({ rules: [...spec.rules, newRule("unique")] })}
            >
              중복 금지
            </Button>
          </div>
        </header>
        {spec.rules.filter((rule) => rule.kind !== "row_count").length === 0 ? (
          <p className="ui-field-note">
            행 수 검사는 위 "행 수" 설정으로 항상 합니다. 계산(예: 주입중량 = 단중 * 실적)이나 중복 금지 규칙을 더할 수
            있습니다.
          </p>
        ) : (
          <ul className="table-rule-list">
            {spec.rules.map((rule, index) =>
              rule.kind === "row_count" ? null : (
                <li key={`${rule.kind}-${index}`}>
                  {rule.kind === "row_formula" ? (
                    <div className="table-rule-formula">
                      <label className="ui-field">
                        <span>계산식</span>
                        <input
                          aria-label={`규칙 ${index + 1} 계산식`}
                          placeholder="주입중량 = 단중 * 실적"
                          spellCheck={false}
                          value={rule.expression ?? ""}
                          onChange={(event) => updateRule(index, { expression: event.target.value })}
                        />
                      </label>
                      <label className="ui-field">
                        <span>허용 오차</span>
                        <input
                          aria-label={`규칙 ${index + 1} 허용 오차`}
                          type="number"
                          min={0}
                          step={0.01}
                          value={rule.tolerance}
                          onChange={(event) =>
                            updateRule(index, { tolerance: Math.max(0, Number(event.target.value || 0)) })
                          }
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="table-rule-unique">
                      <span className="table-rule-kind">중복 금지</span>
                      <div className="table-rule-columns" role="group" aria-label={`규칙 ${index + 1} 칼럼`}>
                        {columnKeys.map((key) => (
                          <label key={key} className="table-check">
                            <input
                              type="checkbox"
                              checked={rule.columns.includes(key)}
                              onChange={(event) =>
                                updateRule(index, {
                                  columns: event.target.checked
                                    ? [...rule.columns, key]
                                    : rule.columns.filter((column) => column !== key)
                                })
                              }
                            />
                            {key}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                  <IconButton
                    size="sm"
                    variant="danger-ghost"
                    label={`규칙 ${index + 1} 삭제`}
                    onClick={() => set({ rules: spec.rules.filter((_, ruleIndex) => ruleIndex !== index) })}
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </li>
              )
            )}
          </ul>
        )}
      </section>
    </div>
  );
}
