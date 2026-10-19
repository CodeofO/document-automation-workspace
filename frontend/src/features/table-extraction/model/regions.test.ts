import { describe, expect, it } from "vitest";
import {
  REGION_COLOR_COUNT,
  moveRegion,
  paddedRegion,
  regionColorIndex,
  regionColorMap,
  regionColorVar,
  regionFromPoints,
  resizeRegion,
  rowBand
} from "./regions";

describe("영역 색 배정", () => {
  it("표 순서대로 1..N을 쓰고 넘치면 다시 1부터", () => {
    expect(regionColorIndex(0)).toBe(1);
    expect(regionColorIndex(REGION_COLOR_COUNT - 1)).toBe(REGION_COLOR_COUNT);
    expect(regionColorIndex(REGION_COLOR_COUNT)).toBe(1);
    expect(regionColorIndex(-3)).toBe(1);
    expect(regionColorVar(2)).toBe("var(--table-region-3)");
  });

  it("표 key → 색 번호(중복 key는 처음 순서)", () => {
    expect(regionColorMap(["a", "b", "a", "c"])).toEqual({ a: 1, b: 2, c: 4 });
  });
});

describe("영역 이동·크기", () => {
  const region = { x: 0.1, y: 0.2, width: 0.3, height: 0.4 };

  it("이동은 크기를 유지하고 페이지 밖으로 나가지 않는다", () => {
    expect(moveRegion(region, 0.05, 0.05)).toEqual({ x: 0.15, y: 0.25, width: 0.3, height: 0.4 });
    expect(moveRegion(region, 0.9, 0.9)).toEqual({ x: 0.7, y: 0.6, width: 0.3, height: 0.4 });
    expect(moveRegion(region, -1, -1)).toEqual({ x: 0, y: 0, width: 0.3, height: 0.4 });
  });

  it("손잡이 크기 조절은 반대 변을 고정하고 최소 크기를 지킨다", () => {
    expect(resizeRegion(region, "se", 0.1, 0.1)).toEqual({ x: 0.1, y: 0.2, width: 0.4, height: 0.5 });
    expect(resizeRegion(region, "nw", 0.1, 0.1)).toEqual({ x: 0.2, y: 0.3, width: 0.2, height: 0.3 });
    const collapsed = resizeRegion(region, "e", -1, 0);
    expect(collapsed.x).toBe(0.1);
    expect(collapsed.width).toBeCloseTo(0.01);
  });

  it("두 점으로 그린 상자는 순서와 무관", () => {
    expect(regionFromPoints({ x: 0.5, y: 0.6 }, { x: 0.2, y: 0.1 })).toEqual({
      x: 0.2,
      y: 0.1,
      width: 0.3,
      height: 0.5
    });
  });

  it("여백을 더하고 [0,1]로 자른다(서버 crop 규칙)", () => {
    const padded = paddedRegion({ x: 0.02, y: 0.5, width: 0.5, height: 0.48 }, 0.05);
    expect(padded.x).toBe(0);
    expect(padded.y).toBeCloseTo(0.45);
    expect(padded.width).toBeCloseTo(0.57);
    expect(padded.height).toBeCloseTo(0.55);
  });
});

describe("선택 행 띠(y_center)", () => {
  const regionUsed = { x: 0.1, y: 0.2, width: 0.8, height: 0.5, padding: 0.05 };
  const rows = [
    { row_id: "r1", y_center: 0.1 },
    { row_id: "r2", y_center: 0.3 },
    { row_id: "r3", y_center: 0.5 }
  ];

  it("y_center는 region_used 안 비율: 이웃 행 간격의 절반씩 위·아래", () => {
    const band = rowBand(regionUsed, rows, "r2");
    expect(band).not.toBeNull();
    expect(band?.x).toBe(0.1);
    expect(band?.width).toBe(0.8);
    // 위 0.2 ~ 아래 0.4 (영역 안) → 페이지 0.2 + 0.2*0.5 = 0.3, 높이 0.2*0.5 = 0.1
    expect(band?.y).toBeCloseTo(0.3);
    expect(band?.height).toBeCloseTo(0.1);
  });

  it("첫·끝 행은 한쪽 이웃 간격으로 대칭", () => {
    const first = rowBand(regionUsed, rows, "r1");
    expect(first?.y).toBeCloseTo(0.2 + 0.0 * 0.5);
    expect(first?.height).toBeCloseTo(0.2 * 0.5);
    const last = rowBand(regionUsed, rows, "r3");
    expect(last?.y).toBeCloseTo(0.2 + 0.4 * 0.5);
    expect(last?.height).toBeCloseTo(0.2 * 0.5);
  });

  it("영역이 없으면 페이지 전체 기준, 행이 하나면 영역 높이/행 수", () => {
    const band = rowBand(null, [{ row_id: "r1", y_center: 0.5 }], "r1");
    expect(band).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it("y_center가 없거나 행이 없으면 null", () => {
    expect(rowBand(regionUsed, [{ row_id: "r1", y_center: null }], "r1")).toBeNull();
    expect(rowBand(regionUsed, rows, "missing")).toBeNull();
  });
});
