// 보관함 화면의 순수 규칙(선택·병합·필터·라벨). 컴포넌트와 분리해 유닛 테스트한다.
import type { LibraryDocument } from "../../api/types";
import { POLL_RUNNING_MS, pollIntervalForList } from "../../api/polling";
import { hasExtension, libraryPathForFile } from "../../lib/files";
import { statusLabel } from "../../lib/status";

/** 보관함은 xlsx도 받는다(모듈 업로드 DOCUMENT_FILE_EXTENSIONS보다 넓다). */
export const LIBRARY_FILE_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "docx", "xlsx", "pptx"] as const;
export const LIBRARY_FILE_ACCEPT = LIBRARY_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");
export const DEFAULT_LIBRARY_UPLOAD_CHUNK_FILES = 50;
export const LIBRARY_LIST_LIMIT = 300;
export const LIBRARY_SELECT_ALL_LIMIT = 20000;

export type LibraryFilters = { folder: string; query: string; status: string };

export type LibraryClipboard = { mode: "copy" | "cut"; documentIds: string[]; folderPaths: string[] } | null;

export type UploadQueueStatus = "pending" | "uploading" | "completed" | "failed";

export type UploadQueueItem = {
  id: string;
  label: string;
  files: File[];
  targetFolder: string;
  status: UploadQueueStatus;
  uploadedCount: number;
  error: string | null;
};

export type LibraryViewMode = "list" | "icon";

/** 상태 필터 select의 선택지. */
export const LIBRARY_STATUS_FILTERS: { value: string; label: string }[] = [
  { value: "", label: "전체 상태" },
  { value: "ready", label: "준비 완료" },
  { value: "queued", label: "변환 대기" },
  { value: "preprocessing", label: "변환 중" },
  { value: "failed", label: "실패" }
];

/** 목록 API 쿼리 파라미터(limit 제외). 검색어는 앞뒤 공백을 뺀다. */
export function libraryFilterParams(filters: LibraryFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.folder) params.set("library_path", filters.folder);
  if (filters.query.trim()) params.set("q", filters.query.trim());
  if (filters.status) params.set("status", filters.status);
  return params;
}

export function isSelectableDocument(document: Pick<LibraryDocument, "status">): boolean {
  return document.status !== "deleted" && document.status !== "failed";
}

/** 새로 받은 문서를 앞에 두고 같은 id는 새 값으로 바꾼 뒤 최신순으로 정렬한다. */
export function mergeDocuments(incoming: LibraryDocument[], current: LibraryDocument[]): LibraryDocument[] {
  const byId = new Map<string, LibraryDocument>();
  [...incoming, ...current].forEach((document) => {
    if (!byId.has(document.document_id)) byId.set(document.document_id, document);
  });
  return Array.from(byId.values()).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** 선택 목록 뒤에 아직 없는 문서만 붙인다(순서 유지). */
export function appendUniqueDocuments(current: LibraryDocument[], incoming: LibraryDocument[]): LibraryDocument[] {
  const seen = new Set(current.map((document) => document.document_id));
  const appended = [...current];
  incoming.forEach((document) => {
    if (seen.has(document.document_id)) return;
    seen.add(document.document_id);
    appended.push(document);
  });
  return appended;
}

export function sortLibraryFiles(files: File[]): File[] {
  return [...files].sort((left, right) => libraryPathForFile(left).localeCompare(libraryPathForFile(right), "ko"));
}

/** 지원 확장자만 남기고 보관함 경로순으로 정렬한다. */
export function filterLibraryFiles(files: File[]): File[] {
  return sortLibraryFiles(files.filter((file) => hasExtension(file, LIBRARY_FILE_EXTENSIONS)));
}

export function toggleSelectedId(selectedIds: string[], id: string): string[] {
  return selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id];
}

/**
 * Shift 클릭 범위 선택. anchor~target 사이의 선택 가능한 문서를 기존 선택에 더한다.
 * 둘 중 하나가 목록에 없으면 null(호출부가 단일 토글로 처리한다).
 */
export function selectRangeIds(
  documents: LibraryDocument[],
  selectedIds: string[],
  anchorId: string,
  targetId: string
): { ids: string[]; added: LibraryDocument[] } | null {
  const anchorIndex = documents.findIndex((document) => document.document_id === anchorId);
  const targetIndex = documents.findIndex((document) => document.document_id === targetId);
  if (anchorIndex < 0 || targetIndex < 0) return null;
  const [start, end] = anchorIndex < targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex];
  const added = documents.slice(start, end + 1).filter(isSelectableDocument);
  if (!added.length) return { ids: selectedIds, added };
  return { ids: Array.from(new Set([...selectedIds, ...added.map((item) => item.document_id)])), added };
}

/** 보관함 문서 상태 라벨. queued만 보관함 고유 문구("변환 대기")를 쓴다. */
export function libraryStatusLabel(status: string): string {
  if (status === "queued") return "변환 대기";
  return statusLabel(status, "document");
}

export function uploadQueueStatusLabel(status: UploadQueueStatus): string {
  if (status === "pending") return "대기";
  if (status === "uploading") return "업로드 중";
  if (status === "completed") return "완료";
  return "실패";
}

export function clipboardLabel(clipboard: LibraryClipboard): string {
  if (!clipboard) return "";
  const count = clipboard.documentIds.length + clipboard.folderPaths.length;
  return `${count}개 ${clipboard.mode === "copy" ? "복사" : "이동"} 준비됨`;
}

export function deleteConfirmMessage(count: number, label?: string): string {
  const target = label ? `"${label}"` : `${count.toLocaleString()}개 문서`;
  return `${target}의 원본 파일을 삭제합니다.\n\n삭제된 원본과 페이지 이미지는 복구할 수 없습니다. 과거 실행 기록과 추출 결과 row는 남습니다. 계속할까요?`;
}

/** 업로드 대기가 있거나 변환 중 문서가 있으면 빠르게, 아니면 idle 주기로 목록을 다시 읽는다. */
export function libraryPollInterval(documents: Pick<LibraryDocument, "status">[], pendingUploadCount: number): number {
  if (pendingUploadCount > 0) return POLL_RUNNING_MS;
  return pollIntervalForList(documents.map((document) => document.status));
}

/** 입력 중인 요소에서는 보관함 단축키를 쓰지 않는다. */
export function isEditableShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select" || target.isContentEditable;
}

export function newUploadQueueId(): string {
  return `upload_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}
