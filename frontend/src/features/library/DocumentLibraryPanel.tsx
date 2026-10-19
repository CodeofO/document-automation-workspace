import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { toFriendlyError } from "../../api/client";
import type { LibraryDocument } from "../../api/types";
import type { ModuleTarget } from "../../app/routes";
import { useConfirm, usePrompt, useToast } from "../../components/ui";
import { filesFromDataTransfer, normalizeLibraryPath } from "../../lib/files";
import {
  createLibraryFolder,
  deleteLibraryDocument,
  deleteLibraryDocuments,
  fetchLibraryDocumentIds,
  fetchLibraryDocumentSelection,
  transferLibraryItems
} from "./api";
import { LibraryDocumentList } from "./components/LibraryDocumentList";
import { LibraryFolderTree } from "./components/LibraryFolderTree";
import { LibraryRunActions } from "./components/LibraryRunActions";
import { LibrarySelectionBar } from "./components/LibrarySelectionBar";
import { LibraryToolbar } from "./components/LibraryToolbar";
import { UploadQueueList } from "./components/UploadQueueList";
import { useLibraryData } from "./hooks/useLibraryData";
import { useLibraryShortcuts } from "./hooks/useLibraryShortcuts";
import { useUploadQueue } from "./hooks/useUploadQueue";
import {
  clipboardLabel,
  deleteConfirmMessage,
  filterLibraryFiles,
  isSelectableDocument,
  mergeDocuments,
  selectRangeIds,
  toggleSelectedId,
  type LibraryClipboard,
  type LibraryViewMode
} from "./model";

type NoticeType = "info" | "success" | "error";

export type DocumentLibraryPanelProps = {
  mode: "screen" | "picker";
  uploadChunkFiles?: number;
  selectedIds: string[];
  onSelectedIds: (ids: string[]) => void;
  /** picker: "선택 적용" */
  onApply?: (documents: LibraryDocument[]) => void;
  /** screen: 선택 문서를 모듈로 보낸다. */
  onRunSelected?: (target: ModuleTarget, documents: LibraryDocument[]) => void;
};

/** 보관함 본체(화면·picker 공용): 폴더 트리, 툴바, 업로드 큐, 문서 목록과 선택 작업. */
export function DocumentLibraryPanel(props: DocumentLibraryPanelProps) {
  const { selectedIds, onSelectedIds } = props;
  const [activeFolder, setActiveFolder] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [viewMode, setViewMode] = useState<LibraryViewMode>("list");
  const [clipboard, setClipboard] = useState<LibraryClipboard>(null);
  const [operationLabel, setOperationLabel] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  /** 선택한 문서의 마지막으로 본 값(다른 폴더로 옮겨가도 "선택 적용"이 서버 왕복 없이 끝나게). */
  const documentCacheRef = useRef(new Map<string, LibraryDocument>());
  const lastSelectedIdRef = useRef<string | null>(selectedIds[selectedIds.length - 1] ?? null);
  const lastToastIdRef = useRef<number | null>(null);
  const confirm = useConfirm();
  const prompt = usePrompt();
  const toast = useToast();
  const operationBusy = operationLabel !== null;
  const filters = useMemo(() => ({ folder: activeFolder, query, status }), [activeFolder, query, status]);

  const notify = useCallback(
    (message: string, type: NoticeType = "info") => {
      if (lastToastIdRef.current !== null) toast.dismiss(lastToastIdRef.current);
      lastToastIdRef.current = toast.show(message, {
        tone: type === "error" ? "danger" : type,
        durationMs: type === "error" ? 4800 : 2400
      });
    },
    [toast]
  );
  const dismissNotice = useCallback(() => {
    if (lastToastIdRef.current !== null) toast.dismiss(lastToastIdRef.current);
    lastToastIdRef.current = null;
  }, [toast]);
  const notifyError = useCallback((error: unknown) => notify(toFriendlyError(error), "error"), [notify]);

  const rememberDocuments = useCallback((documents: LibraryDocument[]) => {
    documents.forEach((document) => documentCacheRef.current.set(document.document_id, document));
  }, []);

  const uploads = useUploadQueue({
    chunkSize: props.uploadChunkFiles,
    onChunkUploaded: (documents) => setDocuments((current) => mergeDocuments(documents, current)),
    onItemCompleted: async (documents) => {
      rememberDocuments(documents);
      onSelectedIds([...new Set([...selectedIds, ...documents.map((document) => document.document_id)])]);
      await refresh();
    },
    onItemFailed: notifyError
  });

  const { documents, folders, totalCount, loading, error, errorUpdatedAt, setDocuments, setFolders, refresh } =
    useLibraryData(filters, uploads.pendingCount);

  useEffect(() => {
    rememberDocuments(documents);
  }, [documents, rememberDocuments]);

  useEffect(() => {
    if (error) notifyError(error);
    // 같은 오류를 폴링마다 반복해 띄우지 않도록 errorUpdatedAt이 바뀔 때만 알린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errorUpdatedAt]);

  useEffect(() => {
    if (!selectedIds.length) lastSelectedIdRef.current = null;
    else if (!lastSelectedIdRef.current || !selectedIds.includes(lastSelectedIdRef.current)) {
      lastSelectedIdRef.current = selectedIds[selectedIds.length - 1] ?? null;
    }
  }, [selectedIds]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectableDocuments = documents.filter(isSelectableDocument);
  const allVisibleSelected =
    selectableDocuments.length > 0 && selectableDocuments.every((document) => selectedSet.has(document.document_id));

  async function withOperation(label: string, task: () => Promise<void>) {
    setOperationLabel(label);
    try {
      await task();
    } catch (err) {
      notifyError(err);
    } finally {
      setOperationLabel(null);
    }
  }

  function toggleDocument(document: LibraryDocument, event?: ReactMouseEvent<HTMLButtonElement>) {
    if (!isSelectableDocument(document)) return;
    if (event?.shiftKey && lastSelectedIdRef.current) {
      const range = selectRangeIds(documents, selectedIds, lastSelectedIdRef.current, document.document_id);
      if (range) {
        rememberDocuments(range.added);
        if (range.added.length) onSelectedIds(range.ids);
        lastSelectedIdRef.current = document.document_id;
        return;
      }
    }
    rememberDocuments([document]);
    onSelectedIds(toggleSelectedId(selectedIds, document.document_id));
    lastSelectedIdRef.current = document.document_id;
  }

  function clearSelection() {
    onSelectedIds([]);
    lastSelectedIdRef.current = null;
  }

  async function selectAllDocuments() {
    dismissNotice();
    try {
      const ids = await fetchLibraryDocumentIds(filters);
      onSelectedIds(allVisibleSelected ? [] : Array.from(new Set([...selectedIds, ...ids])));
      if (!ids.length) notify("선택할 문서가 없습니다.");
      else notify(allVisibleSelected ? "현재 목록 선택을 해제했습니다." : `${ids.length.toLocaleString()}개 문서를 선택했습니다.`);
    } catch (err) {
      notifyError(err);
    }
  }

  async function resolveSelectedDocuments(): Promise<LibraryDocument[]> {
    const cache = documentCacheRef.current;
    const missing = selectedIds.filter((id) => !cache.has(id));
    if (missing.length) rememberDocuments(await fetchLibraryDocumentSelection(selectedIds));
    return selectedIds.map((id) => cache.get(id)).filter((document): document is LibraryDocument => Boolean(document));
  }

  async function runSelected(target: ModuleTarget) {
    try {
      props.onRunSelected?.(target, await resolveSelectedDocuments());
    } catch (err) {
      notifyError(err);
    }
  }

  async function applySelection() {
    try {
      props.onApply?.(await resolveSelectedDocuments());
    } catch (err) {
      notifyError(err);
    }
  }

  function copySelected(mode: "copy" | "cut") {
    if (!selectedIds.length) return;
    setClipboard({ mode, documentIds: selectedIds, folderPaths: [] });
    notify(`${selectedIds.length.toLocaleString()}개 문서를 ${mode === "copy" ? "복사" : "이동"} 대상으로 잡았습니다.`);
  }

  function copyActiveFolder(mode: "copy" | "cut") {
    if (!activeFolder) {
      notify("먼저 왼쪽에서 폴더를 선택하세요.", "error");
      return;
    }
    setClipboard({ mode, documentIds: [], folderPaths: [activeFolder] });
    notify(`"${activeFolder}" 폴더를 ${mode === "copy" ? "복사" : "이동"} 대상으로 잡았습니다.`);
  }

  async function confirmDelete(count: number, label?: string) {
    return confirm({
      title: "원본 파일 삭제",
      message: deleteConfirmMessage(count, label),
      confirmLabel: "삭제",
      tone: "danger"
    });
  }

  async function deleteSelectedDocuments() {
    if (!selectedIds.length || operationBusy) return;
    if (!(await confirmDelete(selectedIds.length))) return;
    await withOperation("삭제가 진행중입니다", async () => {
      const deleted = await deleteLibraryDocuments(selectedIds);
      const deletedIds = new Set(deleted.map((document) => document.document_id));
      setDocuments((current) => current.filter((document) => !deletedIds.has(document.document_id)));
      deletedIds.forEach((id) => documentCacheRef.current.delete(id));
      onSelectedIds(selectedIds.filter((id) => !deletedIds.has(id)));
      if (clipboard?.documentIds.some((id) => deletedIds.has(id))) setClipboard(null);
      notify(`${deletedIds.size.toLocaleString()}개 문서의 원본을 삭제했습니다.`, "success");
      await refresh();
    });
  }

  async function deleteDocument(document: LibraryDocument) {
    if (!(await confirmDelete(1, document.filename))) return;
    await withOperation("삭제가 진행중입니다", async () => {
      const deleted = await deleteLibraryDocument(document.document_id);
      setDocuments((current) => current.map((item) => (item.document_id === deleted.document_id ? deleted : item)));
      onSelectedIds(selectedIds.filter((id) => id !== document.document_id));
      notify(`"${document.filename}" 원본을 삭제했습니다.`, "success");
      await refresh();
    });
  }

  async function pasteClipboard() {
    if (!clipboard) return;
    const verb = clipboard.mode === "copy" ? "복사" : "이동";
    await withOperation(`${verb} 처리 중입니다`, async () => {
      const result = await transferLibraryItems(clipboard.mode, {
        documentIds: clipboard.documentIds,
        folderPaths: clipboard.folderPaths,
        targetFolder: activeFolder
      });
      rememberDocuments(result.documents);
      setFolders(result.folders);
      if (clipboard.mode === "cut") {
        setClipboard(null);
        onSelectedIds([]);
      }
      notify(`${verb} 완료: ${result.documents.length.toLocaleString()}개 문서`, "success");
      await refresh();
    });
  }

  async function createFolder() {
    const name = await prompt({ title: "새 폴더 이름", placeholder: "폴더 이름", confirmLabel: "만들기" });
    const folderName = normalizeLibraryPath(name ?? "");
    if (!folderName) return;
    const folderPath = activeFolder ? `${activeFolder}/${folderName}` : folderName;
    await withOperation("폴더를 만드는 중입니다", async () => {
      setFolders(await createLibraryFolder(folderPath));
      setActiveFolder(normalizeLibraryPath(folderPath));
      notify(`"${folderPath}" 폴더를 만들었습니다.`, "success");
    });
  }

  function enqueueFiles(files: File[], label: string) {
    const supported = filterLibraryFiles(files);
    if (!supported.length) {
      notify("지원하는 문서 파일이 없습니다.", "error");
      return;
    }
    uploads.enqueue(supported, label, activeFolder);
    notify(`${supported.length.toLocaleString()}개 파일을 업로드 대기에 추가했습니다.`);
  }

  async function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    enqueueFiles(await filesFromDataTransfer(event.dataTransfer), "드래그한 항목");
  }

  useLibraryShortcuts(panelRef, {
    hasSelection: selectedIds.length > 0,
    hasClipboard: Boolean(clipboard),
    selectAll: () => void selectAllDocuments(),
    clearSelection: () => {
      clearSelection();
      dismissNotice();
    },
    copy: () => copySelected("copy"),
    cut: () => copySelected("cut"),
    paste: () => void pasteClipboard(),
    remove: () => void deleteSelectedDocuments()
  });

  return (
    <section ref={panelRef} className={`document-library-panel ${props.mode === "screen" ? "full" : "compact"}`}>
      <LibraryToolbar
        totalCount={totalCount}
        pendingUploadCount={uploads.pendingCount}
        query={query}
        status={status}
        showTitle={props.mode === "picker"}
        onQueryChange={setQuery}
        onStatusChange={setStatus}
        onFiles={enqueueFiles}
        onDrop={(event) => void onDrop(event)}
      />

      <div className="document-library-body">
        <LibraryFolderTree
          folders={folders}
          activeFolder={activeFolder}
          totalCount={totalCount}
          busy={operationBusy}
          canPaste={Boolean(clipboard)}
          onSelectFolder={setActiveFolder}
          onCreateFolder={() => void createFolder()}
          onCopyFolder={copyActiveFolder}
          onPaste={() => void pasteClipboard()}
        />

        <div className="document-library-main">
          <LibrarySelectionBar
            selectedCount={selectedIds.length}
            clipboardLabel={clipboardLabel(clipboard)}
            viewMode={viewMode}
            allVisibleSelected={allVisibleSelected}
            canSelectAll={!loading && !operationBusy && selectableDocuments.length > 0}
            busy={operationBusy}
            canPaste={Boolean(clipboard)}
            onViewMode={setViewMode}
            onSelectAll={() => void selectAllDocuments()}
            onClearSelection={clearSelection}
            onCopy={copySelected}
            onPaste={() => void pasteClipboard()}
            onDelete={() => void deleteSelectedDocuments()}
            onApply={props.onApply ? () => void applySelection() : undefined}
          />

          {props.mode === "screen" && props.onRunSelected && (
            <LibraryRunActions selectedCount={selectedIds.length} onRun={(target) => void runSelected(target)} />
          )}

          <UploadQueueList items={uploads.items} />

          {(loading || operationBusy) && (
            <div className="document-library-feedback" aria-live="polite">
              <div className="document-library-busy">
                <Loader2 size={15} className="spin" />
                {operationLabel ?? "보관함을 불러오는 중입니다"}
              </div>
            </div>
          )}

          <LibraryDocumentList
            documents={documents}
            selectedIds={selectedSet}
            viewMode={viewMode}
            onToggle={toggleDocument}
            onDelete={(document) => void deleteDocument(document)}
            onDrop={(event) => void onDrop(event)}
          />
        </div>
      </div>
    </section>
  );
}
