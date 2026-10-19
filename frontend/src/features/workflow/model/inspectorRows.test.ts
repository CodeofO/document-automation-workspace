import { describe, expect, it } from "vitest";
import {
  inspectorConfidenceTone,
  inspectorKieRows,
  inspectorRequiredRows,
  kieRowTone,
  kieSectionMeta,
  requiredRowTone,
  requiredSectionMeta
} from "./inspectorRows";

describe("결과 창 문서 결과 행", () => {
  it("KIE 값은 객체·원시값 모두 행으로 바꾸고, 신뢰도·경고로 검토 수를 센다", () => {
    const rows = inspectorKieRows({
      kie_values: {
        문서번호: { value: "A-1", confidence: 0.92, evidence: "상단", page: 1 },
        금액: { value: 1000, confidence: 0.7, warnings: ["format"] },
        고객명: "홍길동"
      }
    });
    expect(rows.map((row) => row.key)).toEqual(["문서번호", "금액", "고객명"]);
    expect(rows[2]).toMatchObject({ value: "홍길동", confidence: null, evidence: "" });
    expect(rows.map(kieRowTone)).toEqual([undefined, "warning", undefined]);
    expect(kieSectionMeta(rows)).toBe("3필드 · 검토 1");
    expect(kieSectionMeta([])).toBe("0필드");
  });

  it("신뢰도 색은 다른 모듈과 같은 기준(0.8 / 0.6)", () => {
    expect(inspectorConfidenceTone(0.8)).toBeUndefined();
    expect(inspectorConfidenceTone(0.79)).toBe("warning");
    expect(inspectorConfidenceTone(0.59)).toBe("danger");
    expect(inspectorConfidenceTone(null)).toBeUndefined();
  });

  it("필수 항목: 필수 누락은 빨강, 불확실은 노랑, 요약에 누락·검토 수", () => {
    const rows = inspectorRequiredRows({
      required_items: {
        고객명: { status: "present", required: true, confidence: 0.9, evidence: "서명란" },
        동의: { status: "uncertain", required: true, confidence: 0.58 },
        서명: { status: "missing", required: true },
        비고: { status: "missing", required: false }
      }
    });
    expect(rows.map(requiredRowTone)).toEqual([undefined, "warning", "danger", undefined]);
    expect(requiredSectionMeta(rows)).toBe("4항목 · 누락 2 · 검토 1");
  });
});
