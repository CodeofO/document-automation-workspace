// 보관함 API 호출과 TanStack Query 키. 화면 컴포넌트는 fetch를 직접 하지 않는다.
import { api, jsonBody, type Schemas } from "../../api/client";
import { pollUntil } from "../../api/polling";
import type { DocumentRead, LibraryDocument } from "../../api/types";
import { isActiveStatus } from "../../lib/status";
import { libraryPathForFile, normalizeLibraryPath } from "../../lib/files";
import { LIBRARY_LIST_LIMIT, LIBRARY_SELECT_ALL_LIMIT, libraryFilterParams, type LibraryFilters } from "./model";

export type LibraryFolder = Schemas["DocumentTreeFolderRead"];

/** 이동·복사 결과. DocumentLibraryActionRead의 문서는 목록 모양(LibraryDocument)으로 다룬다. */
export type LibraryActionResult = { documents: LibraryDocument[]; folders: LibraryFolder[] };

export const libraryKeys = {
  all: ["library"] as const,
  documentLists: () => ["library", "documents"] as const,
  documents: (filters: LibraryFilters) =>
    ["library", "documents", { folder: filters.folder, query: filters.query.trim(), status: filters.status }] as const,
  tree: () => ["library", "tree"] as const
};

export function fetchLibraryDocuments(filters: LibraryFilters, signal?: AbortSignal): Promise<LibraryDocument[]> {
  const params = libraryFilterParams(filters);
  params.set("limit", String(LIBRARY_LIST_LIMIT));
  return api<LibraryDocument[]>(`/api/documents?${params.toString()}`, { signal });
}

export async function fetchLibraryFolders(signal?: AbortSignal): Promise<LibraryFolder[]> {
  const tree = await api<Schemas["DocumentTreeRead"]>("/api/library/tree", { signal });
  return tree.folders;
}

/** 현재 필터에 맞는 문서 id 전체(전체 선택용). */
export function fetchLibraryDocumentIds(filters: LibraryFilters): Promise<string[]> {
  const params = libraryFilterParams(filters);
  params.set("limit", String(LIBRARY_SELECT_ALL_LIMIT));
  return api<string[]>(`/api/documents/ids?${params.toString()}`);
}

export async function fetchLibraryDocumentSelection(documentIds: string[]): Promise<LibraryDocument[]> {
  const response = await api<{ documents: LibraryDocument[] }>(
    "/api/documents/selection",
    jsonBody("POST", { document_ids: documentIds })
  );
  return response.documents;
}

export async function deleteLibraryDocuments(documentIds: string[]): Promise<LibraryDocument[]> {
  const response = await api<{ documents: LibraryDocument[] }>(
    "/api/documents/delete",
    jsonBody("POST", { document_ids: documentIds })
  );
  return response.documents;
}

export function deleteLibraryDocument(documentId: string): Promise<LibraryDocument> {
  return api<LibraryDocument>(`/api/documents/${documentId}`, { method: "DELETE" });
}

export async function transferLibraryItems(
  mode: "copy" | "cut",
  payload: { documentIds: string[]; folderPaths: string[]; targetFolder: string }
): Promise<LibraryActionResult> {
  const response = await api<{ documents?: LibraryDocument[]; folders?: LibraryFolder[] }>(
    `/api/library/${mode === "copy" ? "copy" : "move"}`,
    jsonBody("POST", {
      document_ids: payload.documentIds,
      folder_paths: payload.folderPaths,
      target_folder: payload.targetFolder
    })
  );
  return { documents: response.documents ?? [], folders: response.folders ?? [] };
}

export async function createLibraryFolder(folderPath: string): Promise<LibraryFolder[]> {
  const tree = await api<Schemas["DocumentTreeRead"]>("/api/library/folders", jsonBody("POST", { folder_path: folderPath }));
  return tree.folders;
}

/** 파일을 보관함에 올린다(한 번의 요청). 청크 분할은 호출부가 한다. */
export async function uploadLibraryFiles(files: File[], targetFolder = "", signal?: AbortSignal): Promise<LibraryDocument[]> {
  const form = new FormData();
  files.forEach((file) => {
    form.append("files", file);
    form.append("library_paths", normalizeLibraryPath([targetFolder, libraryPathForFile(file)].filter(Boolean).join("/")));
  });
  const response = await api<{ documents: LibraryDocument[] }>("/api/library/uploads", { method: "POST", body: form, signal });
  return response.documents;
}

// ---- 문서 상세(페이지 포함) ----

export const documentKeys = {
  detail: (documentId: string) => ["library", "document", documentId] as const
};

export function fetchDocumentDetail(documentId: string, signal?: AbortSignal): Promise<DocumentRead> {
  return api<DocumentRead>(`/api/documents/${documentId}`, { signal });
}

/** 보관함 문서가 준비(ready)될 때까지 기다린다. 변환 실패면 오류. 시간 제한 없음(signal로만 취소). */
export async function waitForDocumentReady(documentId: string, signal?: AbortSignal): Promise<DocumentRead> {
  const document = await pollUntil((innerSignal) => fetchDocumentDetail(documentId, innerSignal ?? signal), {
    isDone: (item) => !isActiveStatus(item.status),
    signal
  });
  if (document.status === "failed") throw new Error(document.error_message || `${document.filename} 변환에 실패했습니다.`);
  return document;
}
