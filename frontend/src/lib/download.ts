// 브라우저에서 만든 내용을 파일로 내려받는다(단건 결과 Export 등 서버 export job이 없는 경우).

export function downloadText(filename: string, text: string, mimeType = "application/json") {
  const blob = new Blob([text], { type: `${mimeType};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadJson(filename: string, value: unknown) {
  downloadText(filename, JSON.stringify(value, null, 2), "application/json");
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** 행 목록을 CSV로. 엑셀에서 한글이 깨지지 않게 BOM을 붙인다. */
export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "\uFEFF";
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [headers.map(csvCell).join(","), ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(","))];
  return `\uFEFF${lines.join("\r\n")}`;
}

export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  downloadText(filename, toCsv(rows), "text/csv");
}

/** 파일 이름에 쓸 수 없는 문자를 바꾼다. */
export function safeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_").slice(0, 120) || "export";
}
