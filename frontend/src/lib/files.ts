// 파일 선택·드롭·청크 업로드 헬퍼.

export type FileWithPaths = File & { webkitRelativePath?: string; libraryPath?: string };

export const DOCUMENT_FILE_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "docx", "pptx"] as const;
export const DOCUMENT_FILE_ACCEPT = ".pdf,.png,.jpg,.jpeg,.docx,.pptx";

export function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

export function hasExtension(file: File, extensions: Iterable<string>): boolean {
  const extension = fileExtension(file.name);
  for (const candidate of extensions) if (candidate === extension) return true;
  return false;
}

/** 폴더 선택·드롭이면 상대 경로, 아니면 파일명. */
export function fileDisplayName(file: File): string {
  return (file as FileWithPaths).webkitRelativePath || file.name;
}

export function sortFilesByDisplayName(files: File[]): File[] {
  return [...files].sort((left, right) =>
    fileDisplayName(left).localeCompare(fileDisplayName(right), undefined, { numeric: true, sensitivity: "base" })
  );
}

export function isImageFile(file: File): boolean {
  return ["png", "jpg", "jpeg"].includes(fileExtension(file.name)) || file.type.startsWith("image/");
}

/** 업로드 응답과 매칭하는 클라이언트 쪽 파일 id. */
export function clientFileId(file: File, index: number): string {
  const relativePath = (file as FileWithPaths).webkitRelativePath || "";
  return `${index}:${relativePath || file.name}:${file.size}:${file.lastModified}`;
}

export function chunkFiles<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  const step = Math.max(1, size);
  for (let index = 0; index < items.length; index += step) chunks.push(items.slice(index, index + step));
  return chunks;
}

export function indexedChunks<T>(items: T[], size: number): { start: number; files: T[] }[] {
  return chunkFiles(items, size).map((files, chunkIndex) => ({ start: chunkIndex * Math.max(1, size), files }));
}

export function normalizeLibraryPath(path: string): string {
  return path
    .replaceAll("\\", "/")
    .split("/")
    .filter((part) => part && part !== "." && part !== "..")
    .join("/");
}

/** 보관함 업로드 경로: 폴더 상대 경로 > 드롭 경로 > 파일명. */
export function libraryPathForFile(file: File): string {
  const withPaths = file as FileWithPaths;
  return normalizeLibraryPath(withPaths.webkitRelativePath || withPaths.libraryPath || file.name);
}

type WebkitFileSystemEntry = {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  fullPath?: string;
};

type WebkitFileSystemFileEntry = WebkitFileSystemEntry & {
  file: (success: (file: File) => void, error?: (error: DOMException) => void) => void;
};

type WebkitFileSystemDirectoryEntry = WebkitFileSystemEntry & {
  createReader: () => {
    readEntries: (success: (entries: WebkitFileSystemEntry[]) => void, error?: (error: DOMException) => void) => void;
  };
};

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => WebkitFileSystemEntry | null;
};

/** 드롭된 항목을 파일 목록으로 푼다. 폴더는 재귀로 펼치고 상대 경로를 남긴다. */
export async function filesFromDataTransfer(dataTransfer: DataTransfer): Promise<File[]> {
  const items = Array.from(dataTransfer.items ?? []);
  if (!items.length) return Array.from(dataTransfer.files ?? []);

  // 드롭 이벤트가 끝나면 항목에 접근할 수 없으므로, await 전에 엔트리·파일을 모두 먼저 꺼낸다.
  const sources = items
    .filter((item) => item.kind === "file")
    .map((item) => ({ entry: (item as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? null, file: item.getAsFile() }));
  const files: File[] = [];
  for (const source of sources) {
    if (source.entry) files.push(...(await filesFromEntry(source.entry)));
    else if (source.file) files.push(source.file);
  }
  return files.length ? files : Array.from(dataTransfer.files ?? []);
}

async function filesFromEntry(entry: WebkitFileSystemEntry, parentPath = ""): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => {
      (entry as WebkitFileSystemFileEntry).file(resolve, reject);
    });
    const relativePath = `${parentPath}${file.name}`;
    (file as FileWithPaths).libraryPath = relativePath;
    if (parentPath) {
      try {
        Object.defineProperty(file, "webkitRelativePath", { configurable: true, value: relativePath });
      } catch {
        // 일부 브라우저는 File 메타데이터를 바꿀 수 없다. libraryPath로 충분하다.
      }
    }
    return [file];
  }

  if (!entry.isDirectory) return [];

  const reader = (entry as WebkitFileSystemDirectoryEntry).createReader();
  const entries: WebkitFileSystemEntry[] = [];
  while (true) {
    const batch = await new Promise<WebkitFileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    entries.push(...batch);
  }
  const nextPath = `${parentPath}${entry.name}/`;
  const nested = await Promise.all(entries.map((item) => filesFromEntry(item, nextPath)));
  return nested.flat();
}

/**
 * 지원 확장자만 남기고 이름순 정렬한다. ignoredCount는 제외된 파일 수.
 */
export function filterSupportedFiles(
  files: FileList | File[] | null | undefined,
  extensions: Iterable<string>
): { files: File[]; ignoredCount: number } {
  const selected = files ? Array.from(files) : [];
  const allowed = new Set(extensions);
  const supported = sortFilesByDisplayName(selected.filter((file) => allowed.has(fileExtension(file.name))));
  return { files: supported, ignoredCount: selected.length - supported.length };
}

// ---- 문서 종류 (DocumentInput accept, 선택 요약) ----

export type DocumentKind = "pdf" | "image" | "docx" | "pptx" | "xlsx";

export const DOCUMENT_KIND_EXTENSIONS: Record<DocumentKind, string[]> = {
  pdf: ["pdf"],
  image: ["png", "jpg", "jpeg"],
  docx: ["docx"],
  pptx: ["pptx"],
  xlsx: ["xlsx"]
};

const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  pdf: "PDF",
  image: "이미지",
  docx: "DOCX",
  pptx: "PPTX",
  xlsx: "XLSX"
};

export const ALL_DOCUMENT_KINDS: DocumentKind[] = ["pdf", "image", "docx", "pptx", "xlsx"];

export function extensionsForKinds(kinds: DocumentKind[]): string[] {
  return kinds.flatMap((kind) => DOCUMENT_KIND_EXTENSIONS[kind]);
}

export function acceptForKinds(kinds: DocumentKind[]): string {
  return extensionsForKinds(kinds)
    .map((extension) => `.${extension}`)
    .join(",");
}

/** "PDF, 이미지(PNG·JPG), DOCX" 같은 허용 형식 안내 문구. */
export function acceptLabel(kinds: DocumentKind[]): string {
  return kinds.map((kind) => (kind === "image" ? "이미지(PNG·JPG)" : DOCUMENT_KIND_LABELS[kind])).join(", ");
}

export function documentKindOf(name: string, mimeType?: string | null): DocumentKind | null {
  const extension = fileExtension(name);
  for (const kind of ALL_DOCUMENT_KINDS) if (DOCUMENT_KIND_EXTENSIONS[kind].includes(extension)) return kind;
  if (mimeType?.startsWith("image/")) return "image";
  if (mimeType === "application/pdf") return "pdf";
  return null;
}

/**
 * 선택 문서 요약: "PDF 3개 · 이미지 2개 · 21페이지".
 * 처리 단위가 페이지라서 페이지 수를 함께 보여준다(계획 문서 §8.1).
 */
export function summarizeDocuments(documents: { filename: string; mime_type?: string | null; page_count?: number | null }[]): string {
  if (!documents.length) return "";
  const counts = new Map<string, number>();
  let pages = 0;
  for (const document of documents) {
    const kind = documentKindOf(document.filename, document.mime_type);
    const label = kind ? DOCUMENT_KIND_LABELS[kind] : "기타";
    counts.set(label, (counts.get(label) ?? 0) + 1);
    pages += document.page_count || 0;
  }
  const parts = Array.from(counts, ([label, count]) => `${label} ${count.toLocaleString()}개`);
  if (pages) parts.push(`${pages.toLocaleString()}페이지`);
  return parts.join(" · ");
}
