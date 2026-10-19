// 워크플로우 업로드 파일 규칙.
import { DOCUMENT_FILE_ACCEPT, DOCUMENT_FILE_EXTENSIONS, fileExtension, hasExtension } from "../../../lib/files";

export const WORKFLOW_FILE_ACCEPT = DOCUMENT_FILE_ACCEPT;
export const WORKFLOW_AI_DRAFT_MAX_IMAGES = 10;
export const WORKFLOW_AI_DRAFT_ACCEPT = ".png,.jpg,.jpeg";

export function isWorkflowUploadFile(file: File) {
  return hasExtension(file, DOCUMENT_FILE_EXTENSIONS);
}

export function isWorkflowAiDraftImage(file: File) {
  return ["png", "jpg", "jpeg"].includes(fileExtension(file.name));
}

/**
 * 업로드 순서(upload_index)를 정하는 정렬 키. 이름 → 상대 경로 → 크기 → 수정 시각.
 * lib/files의 sortFilesByDisplayName(상대 경로 우선)과 순서가 달라서 그대로 유지한다.
 */
function uploadFileSortKey(file: File) {
  const relativePath = "webkitRelativePath" in file && typeof file.webkitRelativePath === "string" ? file.webkitRelativePath : "";
  return `${file.name}\u0000${relativePath}\u0000${file.size}\u0000${file.lastModified}`;
}

export function compareUploadFiles(left: File, right: File) {
  return uploadFileSortKey(left).localeCompare(uploadFileSortKey(right), "ko-KR", { numeric: true, sensitivity: "base" });
}

export function sortUploadFiles(files: File[]) {
  return [...files].sort(compareUploadFiles);
}
