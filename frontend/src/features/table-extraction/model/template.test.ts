import { describe, expect, it } from "vitest";
import {
  draftToPayload,
  formatHeaderPath,
  formulaColumnNames,
  moveItem,
  newTableSpec,
  parseHeaderPath,
  parseTags,
  renameColumnInRules,
  tableSpecError,
  templateDraftError,
  templateSummary,
  uniqueTemplateName
} from "./template";

describe("양식 초안", () => {
  it("새 표는 칼럼 1개로 시작해 바로 저장할 수 있다", () => {
    const first = newTableSpec([]);
    expect(first.key).toBe("table_1");
    expect(tableSpecError(first)).toBeNull();
    expect(newTableSpec([first]).key).toBe("table_2");
  });

  it("이름 중복을 피한다", () => {
    expect(uniqueTemplateName([])).toBe("새 표 양식");
    expect(uniqueTemplateName(["새 표 양식", "새 표 양식 2"])).toBe("새 표 양식 3");
  });

  it("머리글 경로·태그 파싱", () => {
    expect(parseHeaderPath("주입수량 › 실적")).toEqual(["주입수량", "실적"]);
    expect(parseHeaderPath("a, b,c,d,e")).toEqual(["a", "b", "c", "d"]);
    expect(formatHeaderPath(["a", "b"])).toBe("a › b");
    expect(parseTags("완, 만,완\nA1")).toEqual(["완", "만", "A1"]);
  });

  it("검증: 칼럼 이름·choice·행 수·규칙 참조", () => {
    const spec = newTableSpec([]);
    expect(tableSpecError({ ...spec, columns: [] })).toMatch(/칼럼을 하나 이상/);
    expect(tableSpecError({ ...spec, columns: [{ ...spec.columns[0], type: "choice" }] })).toMatch(/허용 값/);
    expect(tableSpecError({ ...spec, row_count: { mode: "max", value: null } })).toMatch(/행 수/);
    expect(
      tableSpecError({
        ...spec,
        rules: [{ kind: "row_formula", expression: "칼럼1 = 없음 * 2", tolerance: 0.01, columns: [], message: null }]
      })
    ).toMatch(/없음/);
    expect(templateDraftError({ name: " ", description: "", tables: [], sample_refs: [] })).toMatch(/양식 이름/);
  });

  it("계산식 칼럼 이름: 대괄호·맨 이름, 숫자 제외", () => {
    expect(formulaColumnNames("주입중량 = 단중 * [주입 수량] + 2.5")).toEqual(["주입 수량", "주입중량", "단중"]);
  });

  it("칼럼 이름을 바꾸면 규칙도 따라 바뀐다", () => {
    const rules = renameColumnInRules(
      [
        { kind: "row_formula", expression: "중량 = 단중 * 실적", tolerance: 0.01, columns: [], message: null },
        { kind: "unique", expression: null, tolerance: 0.01, columns: ["단중"], message: null }
      ],
      "단중",
      "단위 중량"
    );
    expect(rules[0].expression).toBe("중량 = [단위 중량] * 실적");
    expect(rules[1].columns).toEqual(["단위 중량"]);
  });

  it("저장 바디: 공백 정리, unknown 행 수 value null, 형식과 맞지 않는 옵션 제거", () => {
    const spec = newTableSpec([]);
    const payload = draftToPayload({
      name: " 용해일지 ",
      description: "  ",
      sample_refs: [],
      tables: [
        {
          ...spec,
          description: " ",
          row_count: { mode: "unknown", value: 5 },
          columns: [{ ...spec.columns[0], key: " 단중 ", choices: ["x"], type: "number" }]
        }
      ]
    });
    expect(payload.name).toBe("용해일지");
    expect(payload.description).toBeNull();
    expect(payload.tables[0].row_count).toEqual({ mode: "unknown", value: null });
    expect(payload.tables[0].columns[0].key).toBe("단중");
    expect(payload.tables[0].columns[0].choices).toEqual([]);
    expect(templateSummary(payload)).toBe("표 1개 · 칼럼 1개");
  });

  it("순서 바꾸기", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b"], 0, -1)).toEqual(["a", "b"]);
  });
});
