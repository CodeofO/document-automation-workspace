// 실행 입력(업로드 파일·보관 문서)과 저장·실행·예약·시작 중단. 결과 목록은 useWorkflowRuns가 맡는다.
import { useRef, useState } from "react";
import { chunkFiles } from "../../../lib/files";
import { uploadLibraryFiles, type LibraryDocument } from "../../library";
import { enqueueRun as enqueueRunRequest, startRunFromDocuments } from "../api";
import { isWorkflowUploadFile, sortUploadFiles } from "../model/files";
import type { WorkflowRunsController } from "../runs/useWorkflowRuns";
import type { WorkflowDefinition } from "../types";
import type { EditorNotify } from "./useWorkflowEditorState";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function useWorkflowRunLauncher(params: {
  initialDocuments: LibraryDocument[];
  uploadMaxBatchFiles: number;
  uploadChunkFiles: number;
  validationErrors: string[];
  persistWorkflow: () => Promise<WorkflowDefinition>;
  runs: WorkflowRunsController;
  notify: EditorNotify;
}) {
  const { notify, runs } = params;
  const [files, setFiles] = useState<File[]>([]);
  const [libraryDocuments, setLibraryDocuments] = useState<LibraryDocument[]>(() => params.initialDocuments);
  const [isSaving, setIsSaving] = useState(false);
  const [isStartingRun, setIsStartingRun] = useState(false);
  const startAbortRef = useRef<AbortController | null>(null);
  const startRunIdRef = useRef("");
  const startCancelRequestedRef = useRef(false);

  async function saveWorkflow() {
    if (isSaving) return;
    setIsSaving(true);
    try {
      await params.persistWorkflow();
      notify.success("워크플로우를 저장했습니다.");
    } catch (exc) {
      notify.error(errorMessage(exc, "워크플로우 저장에 실패했습니다."));
    } finally {
      setIsSaving(false);
    }
  }

  async function uploadFilesToLibrary(runFiles: File[], signal: AbortSignal) {
    const uploaded: LibraryDocument[] = [];
    for (const chunk of chunkFiles(runFiles, params.uploadChunkFiles)) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      uploaded.push(...(await uploadLibraryFiles(chunk)));
    }
    return uploaded;
  }

  async function runWorkflow() {
    const runFiles = sortUploadFiles(files);
    if (!runFiles.length && !libraryDocuments.length) {
      notify.error("실행할 문서를 업로드하거나 문서 보관함에서 선택하세요.");
      return;
    }
    if (params.validationErrors.length) {
      notify.error(`워크플로우를 실행할 수 없습니다. ${params.validationErrors[0]}`);
      return;
    }
    setIsStartingRun(true);
    setIsSaving(true);
    startCancelRequestedRef.current = false;
    const abortController = new AbortController();
    startAbortRef.current = abortController;
    startRunIdRef.current = "";
    try {
      const saved = await params.persistWorkflow();
      const sourceDocuments = libraryDocuments.length
        ? libraryDocuments
        : await uploadFilesToLibrary(runFiles, abortController.signal);
      const run = await startRunFromDocuments(
        saved.id,
        sourceDocuments.map((document) => document.document_id),
        abortController.signal
      );
      startRunIdRef.current = run.id;
      runs.upsertRun(run);
      runs.focusRun(run.id, false);
      setFiles([]);
      setLibraryDocuments([]);
      notify.success("문서 보관함 기준으로 워크플로우 실행을 시작했습니다. 변환 중인 문서는 준비되면 자동 실행됩니다.");
      void runs.refreshRun(run.id);
    } catch (exc) {
      if (startCancelRequestedRef.current || (exc instanceof Error && exc.name === "AbortError")) {
        notify.success("워크플로우 시작을 중단했습니다.");
        return;
      }
      notify.error(errorMessage(exc, "워크플로우 실행에 실패했습니다."));
    } finally {
      if (startAbortRef.current === abortController) {
        startAbortRef.current = null;
        startRunIdRef.current = "";
      }
      setIsStartingRun(false);
      setIsSaving(false);
    }
  }

  async function pauseStartingRun() {
    startCancelRequestedRef.current = true;
    startAbortRef.current?.abort();
    const runId = startRunIdRef.current || runs.activeRunId;
    if (runId) await runs.pauseRun(runId);
    else notify.success("워크플로우 시작을 일시중단했습니다.");
    setIsStartingRun(false);
    setIsSaving(false);
  }

  function pauseRun(runId: string) {
    if (isStartingRun && (startRunIdRef.current === runId || runs.activeRunId === runId)) {
      void pauseStartingRun();
      return;
    }
    void runs.pauseRun(runId);
  }

  async function enqueueRun(runId: string) {
    setIsSaving(true);
    try {
      const saved = await params.persistWorkflow();
      runs.upsertRun(await enqueueRunRequest(runId, saved.id));
      notify.success("업로드된 문서를 재사용하는 워크플로우 실행을 예약했습니다.");
      void runs.refreshRun(runId);
    } catch (exc) {
      notify.error(errorMessage(exc, "워크플로우 실행을 예약하지 못했습니다."));
    } finally {
      setIsSaving(false);
    }
  }

  function selectUploadFiles(fileList: FileList | null) {
    setLibraryDocuments([]);
    const incoming = Array.from(fileList ?? []);
    const nextFiles = sortUploadFiles(incoming.filter(isWorkflowUploadFile));
    const ignoredCount = incoming.length - nextFiles.length;
    if (nextFiles.length > params.uploadMaxBatchFiles) {
      setFiles([]);
      notify.error(`한 번에 최대 ${params.uploadMaxBatchFiles.toLocaleString()}개 파일까지 업로드할 수 있습니다.`);
      return;
    }
    setFiles(nextFiles);
    if (ignoredCount) notify.success(`지원하지 않는 파일 ${ignoredCount.toLocaleString()}개는 제외했습니다.`);
  }

  function selectLibraryDocuments(documents: LibraryDocument[]) {
    setLibraryDocuments(documents);
    setFiles([]);
    if (documents.length) notify.success(`${documents.length.toLocaleString()}개 보관 문서를 선택했습니다.`);
  }

  function clearDocuments() {
    setLibraryDocuments([]);
    setFiles([]);
  }

  return {
    files,
    setFiles,
    libraryDocuments,
    setLibraryDocuments,
    selectedDocumentCount: files.length || libraryDocuments.length,
    isSaving,
    isStartingRun,
    saveWorkflow,
    runWorkflow,
    pauseRun,
    enqueueRun,
    selectUploadFiles,
    selectLibraryDocuments,
    clearDocuments
  };
}

export type WorkflowRunLauncher = ReturnType<typeof useWorkflowRunLauncher>;
