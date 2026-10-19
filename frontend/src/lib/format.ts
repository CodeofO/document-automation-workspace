// 표시용 포맷 헬퍼. 화면마다 따로 있던 formatBytes/formatDate/... 를 한 곳으로 모았다.

/** 바이트 수를 B/KB/MB/GB로 줄여 쓴다. 0 이하·NaN은 "0 B". */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 날짜만 (로캘 기본 형식). 해석할 수 없으면 원문을 돌려준다. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  const date = parseDate(value);
  return date ? date.toLocaleDateString() : value;
}

/** "MM. DD. HH:mm" 형태의 짧은 날짜·시간. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return "-";
  const date = parseDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(
    date
  );
}

/** 0~1 신뢰도를 백분율로. */
export function formatConfidence(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `${Math.round(value * 100)}%`;
}

/** 경과 시간(ms)을 "1분 5초" 형태로. */
export function formatElapsedTime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (!minutes) return `${seconds}초`;
  return seconds ? `${minutes}분 ${seconds}초` : `${minutes}분`;
}

/**
 * 결과 목록·레일에 쓰는 문서 라벨. 처리 단위가 페이지가 되면(page_number가 있으면)
 * "파일명 · p.3"으로 표기한다. page_number가 없거나 null이면 파일명만.
 */
export function documentLabel(filename: string, pageNumber?: number | null): string {
  return typeof pageNumber === "number" && Number.isFinite(pageNumber) ? `${filename} · p.${pageNumber}` : filename;
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function percent(value: number): number {
  return Math.round(clamp01(value) * 100);
}
