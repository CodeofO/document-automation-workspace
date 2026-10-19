import { describe, expect, it } from "vitest";
import { defaultClassifier, normalizeClassifier, signalsForPayload, signalText, toClassifierPayload } from "./model";

describe("classifier model", () => {
  it("signals_text는 줄바꿈으로 나누고, 없으면 기존 signals를 쓴다", () => {
    expect(signalsForPayload({ class_name: "a", description: "b", signals: [" x ", ""] })).toEqual(["x"]);
    expect(signalsForPayload({ class_name: "a", description: "b", signals: ["x"], signals_text: "p\n\n q " })).toEqual(["p", "q"]);
    expect(signalText({ class_name: "a", description: "b", signals: ["x", "y"] })).toBe("x, y");
  });

  it("빈 클래스는 빼고 저장 바디를 만든다", () => {
    const draft = defaultClassifier();
    draft.classes.push({ class_name: " ", description: "", signals: [] });
    const payload = toClassifierPayload(draft);
    expect(payload.classes).toHaveLength(2);
    expect(payload.allow_unknown).toBe(true);
  });

  it("이름이나 클래스가 없으면 오류", () => {
    expect(() => toClassifierPayload({ ...defaultClassifier(), name: " " })).toThrow("분류 설정 이름");
    expect(() => toClassifierPayload({ ...defaultClassifier(), classes: [] })).toThrow("문서 클래스");
  });

  it("클래스가 없는 정의는 기본 클래스로 채운다", () => {
    const { classes: _classes, ...rest } = defaultClassifier();
    expect(normalizeClassifier({ ...rest, classes: [] }).classes).toHaveLength(2);
    expect(normalizeClassifier({ ...rest, classes: [{ class_name: "x", description: "y" }] }).classes[0].signals).toEqual([]);
  });
});
