// 표 영역(페이지 비율 0~1) 계산: 색 배정, 이동·크기 조절, 선택 행 띠(y_center).
import type { RegionUsed, TableRegion, TableRow } from "../types";

/** 표 영역 색 개수. table-extraction.css의 --table-region-1..N과 맞춘다. */
export const REGION_COLOR_COUNT = 8;

/** 표 순서(index)로 색을 고른다. 표를 지우거나 옮기면 색도 순서를 따라간다. */
export function regionColorIndex(index: number): number {
  if (!Number.isFinite(index) || index < 0) return 1;
  return (Math.floor(index) % REGION_COLOR_COUNT) + 1;
}

export function regionColorVar(index: number): string {
  return `var(--table-region-${regionColorIndex(index)})`;
}

/** 표 key → 색 번호. 같은 양식이면 편집기·검토 화면이 같은 색을 쓴다. */
export function regionColorMap(tableKeys: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  tableKeys.forEach((key, index) => {
    if (!(key in map)) map[key] = regionColorIndex(index);
  });
  return map;
}

export { moveRegion, normalizeRegion, regionFromPoints, resizeRegion } from "../../../components/document/regionMath";
export type { RegionHandle as ResizeHandle } from "../../../components/document/regionMath";

function clampRange(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/** 여백(페이지 비율)을 더하고 [0,1]로 자른 실제 crop. 서버 crop 규칙(API §5)과 같다. */
export function paddedRegion(region: TableRegion, padding: number): TableRegion {
  const left = clampRange(region.x - padding, 0, 1);
  const top = clampRange(region.y - padding, 0, 1);
  const right = clampRange(region.x + region.width + padding, 0, 1);
  const bottom = clampRange(region.y + region.height + padding, 0, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const FULL_PAGE: TableRegion = { x: 0, y: 0, width: 1, height: 1 };

/**
 * 선택 행의 띠(페이지 비율). y_center는 region_used 안의 세로 위치(0~1)다.
 * 띠 높이는 이웃 행과의 간격 절반씩(위·아래), 이웃이 없으면 영역 높이 / 행 수로 어림한다.
 * y_center가 없으면 null.
 */
export function rowBand(
  regionUsed: RegionUsed | TableRegion | null,
  rows: Pick<TableRow, "row_id" | "y_center">[],
  rowId: string
) {
  const row = rows.find((item) => item.row_id === rowId);
  if (!row || row.y_center === null || row.y_center === undefined || !Number.isFinite(row.y_center)) return null;
  const region = regionUsed ?? FULL_PAGE;
  const centers = rows
    .map((item) => item.y_center)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
  const center = clampRange(row.y_center, 0, 1);
  const fallbackHalf = 0.5 / Math.max(1, centers.length);
  const previous = [...centers].reverse().find((value) => value < center);
  const next = centers.find((value) => value > center);
  const halfAbove =
    previous === undefined ? (next === undefined ? fallbackHalf : (next - center) / 2) : (center - previous) / 2;
  const halfBelow = next === undefined ? halfAbove : (next - center) / 2;
  const top = clampRange(center - halfAbove, 0, 1);
  const bottom = clampRange(center + halfBelow, 0, 1);
  return {
    x: region.x,
    y: region.y + top * region.height,
    width: region.width,
    height: Math.max(0.004, (bottom - top) * region.height)
  };
}
