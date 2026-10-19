// 화면 진입 때 한 번: 에셋 목록을 읽고, 손대지 않은 기본 캔버스면 마지막/첫 저장 워크플로우를 불러온다
// (저장된 워크플로우가 없으면 빈 새 워크플로우 그대로 둔다).
// 경로(/workflows/:id)로 받은 워크플로우는 목록이 준비되면 불러오고 경로를 /workflows로 정리한다.
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { ROUTES } from "../../../app/routes";
import { fetchWorkflowAssets } from "../api";
import { starterWorkflowToAutoLoad } from "../model/starter";
import type { WorkflowDraft } from "../types";
import type { EditorNotify, WorkflowEditor } from "./useWorkflowEditorState";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useWorkflowBootstrap(params: {
  editor: WorkflowEditor;
  initialDraft: WorkflowDraft | null;
  initialWorkflowId: string;
  notify: EditorNotify;
}) {
  const navigate = useNavigate();
  const { editor, initialDraft, initialWorkflowId } = params;
  const { loadWorkflowIntoCanvas } = editor;
  const workflows = editor.assets.workflows;
  // 목록 읽기는 비동기다. 그사이 사용자가 캔버스를 바꿨으면(새 워크플로우·불러오기·AI 초안 → viewportRevision 증가)
  // 늦게 도착한 자동 불러오기로 덮어쓰지 않는다.
  const mountRevisionRef = useRef(editor.viewportRevision);
  const latestRevisionRef = useRef(editor.viewportRevision);
  useEffect(() => {
    latestRevisionRef.current = editor.viewportRevision;
  });
  const userReplacedCanvas = () => latestRevisionRef.current !== mountRevisionRef.current;

  async function loadAssets() {
    try {
      const loaded = await fetchWorkflowAssets();
      editor.setAssets(loaded);
      if (editor.activeWorkflowId && !loaded.workflows.some((workflow) => workflow.id === editor.activeWorkflowId)) {
        editor.setActiveWorkflowId("");
      }
      if (userReplacedCanvas()) return;
      const starter = starterWorkflowToAutoLoad({
        workflows: loaded.workflows,
        activeWorkflowId: editor.activeWorkflowId,
        initialDraft,
        initialWorkflowId
      });
      if (starter) loadWorkflowIntoCanvas(starter);
    } catch (exc) {
      params.notify.error(errorMessage(exc, "워크플로우 데이터를 불러오지 못했습니다."));
    }
  }

  useEffect(() => {
    void loadAssets();
    // 마운트 때 한 번만 읽는다. 초기 초안·경로 값으로 자동 불러오기 여부를 정하므로 이후 값 변화에 다시 돌면 안 된다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!initialWorkflowId || !workflows.length) return;
    const workflow = workflows.find((item) => item.id === initialWorkflowId);
    if (!workflow) return;
    // 비동기로 받은 목록에 반응해 캔버스를 채우는 동기화라 effect가 맞다.
    loadWorkflowIntoCanvas(workflow);
    navigate(ROUTES.workflows, { replace: true });
  }, [initialWorkflowId, workflows, loadWorkflowIntoCanvas, navigate]);
}
