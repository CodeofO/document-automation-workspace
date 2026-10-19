import { describe, expect, it } from "vitest";
import { pathFromLegacyHash, workflowRunPath } from "./routes";

describe("pathFromLegacyHash", () => {
  it("모듈 해시를 경로로 바꾼다", () => {
    expect(pathFromLegacyHash("#key-info")).toBe("/key-info");
    expect(pathFromLegacyHash("#required-checker")).toBe("/required-check");
    expect(pathFromLegacyHash("#workflow")).toBe("/workflows");
  });

  it("결과 창 해시는 run 경로로 바꾼다", () => {
    expect(pathFromLegacyHash("#workflow-result:run%201")).toBe(workflowRunPath("run 1"));
  });

  it("모르는 해시와 빈 해시는 무시한다", () => {
    expect(pathFromLegacyHash("")).toBeNull();
    expect(pathFromLegacyHash("#section-3")).toBeNull();
  });
});
