import { useEffect, useState } from "react";
import { writeWorkflowDraft } from "../model/draftStorage";
import type { WorkflowDraft } from "../types";

/**
 * 캔버스가 바뀌면 350ms 뒤 localStorage에 초안을 남기고, 마지막 저장 시각 라벨을 돌려준다.
 * 선택 상태는 남기지 않는다(노드 selected만 바뀌어도 다시 쓰지만 저장 내용에는 들어가지 않음).
 */
export function useWorkflowDraftAutosave(draft: WorkflowDraft, restored: boolean) {
  const [savedAt, setSavedAt] = useState<string | null>(restored ? "복원됨" : null);
  const {
    activeWorkflowId,
    workflowName,
    workflowDescription,
    nodes,
    edges,
    classifierDraftsByNodeId,
    schemaDraftsByNodeId,
    checklistDraftsByNodeId
  } = draft;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      writeWorkflowDraft({
        activeWorkflowId,
        workflowName,
        workflowDescription,
        nodes,
        edges,
        classifierDraftsByNodeId,
        schemaDraftsByNodeId,
        checklistDraftsByNodeId
      });
      setSavedAt(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    activeWorkflowId,
    workflowName,
    workflowDescription,
    nodes,
    edges,
    classifierDraftsByNodeId,
    schemaDraftsByNodeId,
    checklistDraftsByNodeId
  ]);

  return { savedAt, setSavedAt };
}
