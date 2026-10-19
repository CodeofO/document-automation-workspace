// AI 워크플로우 초안 생성 흐름: 샘플 선택 → 생성 → 캔버스 적용(→ 선택 시 보관함 저장).
import { useState, type ChangeEvent } from "react";
import { uploadLibraryFiles, type LibraryDocument } from "../../library";
import { generateWorkflowAiDraft } from "../api";
import { isWorkflowAiDraftImage, WORKFLOW_AI_DRAFT_MAX_IMAGES } from "../model/files";
import type { WorkflowAiDraft } from "../types";

export function useAiWorkflowDraft(handlers: {
  onApply: (draft: WorkflowAiDraft) => void;
  onSamplesPersisted: (documents: LibraryDocument[]) => void;
  onMessage: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [persistSamples, setPersistSamples] = useState(false);
  const [includeChecklist, setIncludeChecklist] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);

  function onFilesChange(event: ChangeEvent<HTMLInputElement>) {
    const incomingFiles = Array.from(event.target.files ?? []);
    const nextFiles = incomingFiles.filter(isWorkflowAiDraftImage);
    const ignoredCount = incomingFiles.length - nextFiles.length;
    event.currentTarget.value = "";
    if (nextFiles.length > WORKFLOW_AI_DRAFT_MAX_IMAGES) {
      setFiles([]);
      handlers.onError(`AI 워크플로우 생성은 샘플 이미지 최대 ${WORKFLOW_AI_DRAFT_MAX_IMAGES}장까지 가능합니다.`);
      return;
    }
    setFiles(nextFiles);
    if (ignoredCount) handlers.onMessage(`지원하지 않는 샘플 ${ignoredCount.toLocaleString()}개는 제외했습니다.`);
  }

  async function generate() {
    if (!files.length) {
      handlers.onError("AI가 참고할 샘플 이미지를 선택하세요.");
      return;
    }
    setIsGenerating(true);
    try {
      const draft = await generateWorkflowAiDraft(files, includeChecklist);
      handlers.onApply(draft);
      if (persistSamples) handlers.onSamplesPersisted(await uploadLibraryFiles(files));
      setOpen(false);
      setFiles([]);
      // 적용 알림("초안 적용됨: 스키마 검토 필요")은 onApply 쪽 토스트가 맡고, 여기서는 샘플 보관 여부만 알린다.
      handlers.onMessage(
        `${draft.sample_count.toLocaleString()}장 샘플을 사용했습니다. 원본 이미지는 ${
          persistSamples ? "문서 보관함에 저장했습니다." : "서버에 보관하지 않았습니다."
        }`
      );
    } catch (error) {
      handlers.onError(error instanceof Error ? error.message : "AI 워크플로우 초안 생성에 실패했습니다.");
    } finally {
      setIsGenerating(false);
    }
  }

  return {
    open,
    setOpen,
    files,
    persistSamples,
    setPersistSamples,
    includeChecklist,
    setIncludeChecklist,
    isGenerating,
    onFilesChange,
    generate,
    close: () => {
      if (!isGenerating) setOpen(false);
    }
  };
}
