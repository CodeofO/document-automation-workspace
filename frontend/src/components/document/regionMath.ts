// 영역(페이지 비율 0~1, 왼쪽 위 원점) 계산. 영역 편집기와 표 추출이 같이 쓴다. React에 의존하지 않는다.

export type RatioRegion = { x: number; y: number; width: number; height: number };
export type RegionHandle = "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";

/** 가장 작은 상자 크기(페이지 비율). */
export const MIN_REGION_SIZE = 0.01;

function clampRange(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

/** 페이지 안에 들어오게 자르고 소수 4자리로 맞춘다(x+width<=1, y+height<=1, width/height>0). */
export function normalizeRegion(region: RatioRegion): RatioRegion {
  const x = round4(clampRange(region.x, 0, 1 - MIN_REGION_SIZE));
  const y = round4(clampRange(region.y, 0, 1 - MIN_REGION_SIZE));
  const width = round4(clampRange(region.width, MIN_REGION_SIZE, 1 - x));
  const height = round4(clampRange(region.height, MIN_REGION_SIZE, 1 - y));
  return { x, y, width, height };
}

/** 두 점으로 그린 상자. */
export function regionFromPoints(a: { x: number; y: number }, b: { x: number; y: number }): RatioRegion {
  return normalizeRegion({
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.max(MIN_REGION_SIZE, Math.abs(b.x - a.x)),
    height: Math.max(MIN_REGION_SIZE, Math.abs(b.y - a.y))
  });
}

/** 상자를 (dx, dy)만큼 옮긴다. 크기는 그대로 두고 페이지 밖으로 나가지 않게 막는다. */
export function moveRegion(region: RatioRegion, dx: number, dy: number): RatioRegion {
  return normalizeRegion({
    ...region,
    x: clampRange(region.x + dx, 0, 1 - region.width),
    y: clampRange(region.y + dy, 0, 1 - region.height)
  });
}

/** 손잡이를 (dx, dy)만큼 끌어 크기를 바꾼다. 반대쪽 변은 고정. */
export function resizeRegion(region: RatioRegion, handle: RegionHandle, dx: number, dy: number): RatioRegion {
  let left = region.x;
  let top = region.y;
  let right = region.x + region.width;
  let bottom = region.y + region.height;
  if (handle.includes("w")) left = clampRange(left + dx, 0, right - MIN_REGION_SIZE);
  if (handle.includes("e")) right = clampRange(right + dx, left + MIN_REGION_SIZE, 1);
  if (handle.includes("n")) top = clampRange(top + dy, 0, bottom - MIN_REGION_SIZE);
  if (handle.includes("s")) bottom = clampRange(bottom + dy, top + MIN_REGION_SIZE, 1);
  return normalizeRegion({ x: left, y: top, width: right - left, height: bottom - top });
}
