// 모든 모듈의 문서 입력(spec B-2). 파일·폴더·드롭·보관함 선택을 한 컴포넌트로 받는다.
// 업로드는 항상 보관함(/api/library/uploads)으로 청크 업로드한 뒤 onReady(보관함 문서)를 부른다.
// 실행(from-documents)은 각 모듈이 한다.
import { FilePlus2, FolderUp, Library, Loader2, RotateCcw, UploadCloud, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { isAbortError, toFriendlyError } from "../../api/client";
import type { LibraryDocument } from "../../api/types";
import {
  Button,
  FileSourceMenu,
  IconButton,
  InlineAlert,
  MenuItem,
  ProgressBar,
  useDropTarget,
  useFileInputs
} from "../../components/ui";
import type { AlertTone } from "../../components/ui";
import {
  ALL_DOCUMENT_KINDS,
  acceptForKinds,
  acceptLabel,
  chunkFiles,
  extensionsForKinds,
  fileDisplayName,
  filesFromDataTransfer,
  filterSupportedFiles,
  type DocumentKind
} from "../../lib/files";
import { uploadLibraryFiles } from "./api";
import { DocumentPickerDialog } from "./DocumentPicker";

export type DocumentInputNotice = { tone: AlertTone; text: string };

export type DocumentInputProps = {
  /** 허용 형식. 기본 pdf, image, docx, pptx, xlsx */
  accept?: DocumentKind[];
  /** 기본 true */
  multiple?: boolean;
  /** 기본 true(multiple일 때만) */
  allowFolder?: boolean;
  /** 기본 true */
  allowLibrary?: boolean;
  maxFiles: number;
  chunkSize: number;
  variant: "zone" | "button";
  /** 결과는 항상 보관함 문서다(업로드했든 보관함에서 골랐든). */
  onReady: (documents: LibraryDocument[]) => void;
  /**
   * 주면 보관함에 올리지 않고 파일을 그대로 넘긴다.
   * 보관함 화면(자체 업로드 큐)과 원문 추출(TODO: 백엔드 document_id 입력 전환 전까지 직접 업로드)이 쓴다.
   */
  onFiles?: (files: File[]) => void;
  /** 현재 선택된 보관함 문서(버튼 문구 "N개 문서 선택됨", 보관함 picker 초기 선택) */
  selectedDocuments?: LibraryDocument[];
  /** 알림을 호출부(페이지 상단 InlineAlert)로 보낸다. 없으면 컴포넌트 안에 보여준다. */
  onNotice?: (notice: DocumentInputNotice | null) => void;
  disabled?: boolean;
  /** 업로드할 보관함 폴더 */
  targetFolder?: string;
  /** button 변형의 기본 문구(기본 "문서 추가") */
  label?: string;
  /** zone 변형 제목·설명 */
  title?: ReactNode;
  description?: ReactNode;
  /** zone 아래 추가 내용(예: 활성 schema 카드) */
  children?: ReactNode;
  className?: string;
};

type UploadState = { done: number; total: number } | null;
type FailedState = { files: File[]; message: string } | null;

export function DocumentInput(props: DocumentInputProps) {
  const kinds = props.accept ?? ALL_DOCUMENT_KINDS;
  const multiple = props.multiple ?? true;
  const allowFolder = (props.allowFolder ?? true) && multiple;
  const allowLibrary = props.allowLibrary ?? true;
  const accept = acceptForKinds(kinds);
  const abortRef = useRef<AbortController | null>(null);
  const [upload, setUpload] = useState<UploadState>(null);
  const [failed, setFailed] = useState<FailedState>(null);
  const [localNotice, setLocalNotice] = useState<DocumentInputNotice | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerIds, setPickerIds] = useState<string[]>([]);
  const busy = upload !== null;
  const disabled = props.disabled || busy;

  function notify(notice: DocumentInputNotice | null) {
    if (props.onNotice) props.onNotice(notice);
    else setLocalNotice(notice);
  }

  async function uploadToLibrary(files: File[]) {
    const controller = new AbortController();
    abortRef.current = controller;
    const uploaded: LibraryDocument[] = [];
    const failedFiles: File[] = [];
    let lastError = "";
    let done = 0;
    setFailed(null);
    setUpload({ done, total: files.length });
    try {
      for (const chunk of chunkFiles(files, Math.max(1, props.chunkSize))) {
        if (controller.signal.aborted) break;
        try {
          uploaded.push(...(await uploadLibraryFiles(chunk, props.targetFolder ?? "", controller.signal)));
        } catch (error) {
          if (isAbortError(error) || controller.signal.aborted) break;
          failedFiles.push(...chunk);
          lastError = toFriendlyError(error);
        }
        done += chunk.length;
        setUpload({ done, total: files.length });
      }
    } finally {
      abortRef.current = null;
      setUpload(null);
    }
    if (controller.signal.aborted) {
      notify({
        tone: "warning",
        text: `업로드를 취소했습니다. ${uploaded.length.toLocaleString()}개는 보관함에 올라갔습니다.`
      });
    } else if (failedFiles.length) {
      setFailed({ files: failedFiles, message: lastError });
      if (!uploaded.length) notify({ tone: "danger", text: lastError || "업로드에 실패했습니다." });
    }
    if (uploaded.length) props.onReady(uploaded);
  }

  function acceptFiles(raw: FileList | File[] | null | undefined) {
    const { files: supported, ignoredCount } = filterSupportedFiles(raw, extensionsForKinds(kinds));
    let files = supported;
    const warnings: string[] = [];
    if (ignoredCount) warnings.push(`지원하지 않는 형식 ${ignoredCount.toLocaleString()}개는 제외했습니다.`);
    if (!multiple && files.length > 1) {
      warnings.push("한 번에 하나의 문서만 처리합니다. 첫 번째 파일만 사용합니다.");
      files = files.slice(0, 1);
    }
    if (files.length > props.maxFiles) {
      notify({
        tone: "danger",
        text: `한 번에 최대 ${props.maxFiles.toLocaleString()}개 파일까지 업로드할 수 있습니다. (선택 ${files.length.toLocaleString()}개)`
      });
      return;
    }
    if (!files.length) {
      notify(warnings.length ? { tone: "warning", text: warnings.join(" ") } : null);
      return;
    }
    notify(warnings.length ? { tone: "warning", text: warnings.join(" ") } : null);
    if (props.onFiles) props.onFiles(files);
    else void uploadToLibrary(files);
  }

  function dropFiles(dataTransfer: DataTransfer) {
    // 드롭은 항상 폴더를 재귀로 푼다.
    filesFromDataTransfer(dataTransfer)
      .then(acceptFiles)
      .catch((error: unknown) => notify({ tone: "danger", text: toFriendlyError(error) }));
  }
  const drop = useDropTarget(dropFiles, disabled);
  const dragging = drop.dragging;

  function openPicker() {
    setPickerIds((props.selectedDocuments ?? []).map((document) => document.document_id));
    setPickerOpen(true);
  }

  const {
    inputs: hiddenInputs,
    openFile,
    openFolder
  } = useFileInputs({
    accept,
    multiple,
    allowFolder,
    disabled,
    onFiles: acceptFiles
  });

  const picker = allowLibrary && (
    <DocumentPickerDialog
      open={pickerOpen}
      single={!multiple}
      uploadChunkFiles={props.chunkSize}
      selectedIds={pickerIds}
      onSelectedIds={setPickerIds}
      onClose={() => setPickerOpen(false)}
      onApply={(documents) => {
        setPickerOpen(false);
        notify(null);
        props.onReady(multiple ? documents : documents.slice(0, 1));
      }}
    />
  );

  const status = (
    <>
      {upload && (
        <div className="ui-document-input-progress" role="status">
          <Loader2 size={14} className="spin" aria-hidden />
          <span>
            업로드 중 {upload.done.toLocaleString()} / {upload.total.toLocaleString()}
          </span>
          <ProgressBar value={upload.total ? upload.done / upload.total : 0} label="업로드 진행률" />
          <IconButton label="업로드 취소" size="sm" variant="ghost" onClick={() => abortRef.current?.abort()}>
            <X size={14} />
          </IconButton>
        </div>
      )}
      {failed && (
        <InlineAlert
          tone="danger"
          onDismiss={() => setFailed(null)}
          action={
            <Button size="sm" icon={<RotateCcw size={14} />} onClick={() => void uploadToLibrary(failed.files)}>
              다시 시도
            </Button>
          }
        >
          <strong>{failed.files.length.toLocaleString()}개 파일을 올리지 못했습니다.</strong>
          {failed.message && <div>{failed.message}</div>}
          <div className="ui-document-input-failed">
            {failed.files.slice(0, 5).map((file, index) => (
              <span key={`${fileDisplayName(file)}_${index}`}>{fileDisplayName(file)}</span>
            ))}
            {failed.files.length > 5 && <span>+ {(failed.files.length - 5).toLocaleString()}개</span>}
          </div>
        </InlineAlert>
      )}
      {!props.onNotice && localNotice && (
        <InlineAlert tone={localNotice.tone} onDismiss={() => setLocalNotice(null)}>
          {localNotice.text}
        </InlineAlert>
      )}
    </>
  );

  if (props.variant === "button") {
    const selectedCount = props.selectedDocuments?.length ?? 0;
    return (
      <>
        <FileSourceMenu
          className={["ui-document-input-button", props.className ?? ""].filter(Boolean).join(" ")}
          label={
            busy && upload
              ? `업로드 중 ${upload.done.toLocaleString()} / ${upload.total.toLocaleString()}`
              : selectedCount
                ? `${selectedCount.toLocaleString()}개 문서 선택됨`
                : (props.label ?? "문서 추가")
          }
          accept={accept}
          multiple={multiple}
          allowFolder={allowFolder}
          disabled={disabled}
          busy={busy}
          onFiles={acceptFiles}
          onDropFiles={dropFiles}
          extraItems={
            allowLibrary
              ? (close) => (
                  <MenuItem
                    icon={<Library size={15} />}
                    onSelect={() => {
                      close();
                      openPicker();
                    }}
                  >
                    보관함에서 선택
                  </MenuItem>
                )
              : undefined
          }
          status={upload || failed || (!props.onNotice && localNotice) ? status : null}
        />
        {picker}
      </>
    );
  }

  return (
    <div
      className={["ui-document-input", dragging ? "dragging" : "", props.className ?? ""].filter(Boolean).join(" ")}
      data-state={busy ? "uploading" : dragging ? "dragging" : failed ? "partial-error" : "idle"}
      {...drop.handlers}
    >
      {hiddenInputs}
      <div className="ui-document-input-zone">
        <span className="ui-document-input-icon" aria-hidden>
          <UploadCloud size={32} />
        </span>
        <strong>
          {dragging ? "놓으면 보관함에 업로드됩니다" : (props.title ?? "문서를 끌어다 놓거나 선택하세요")}
        </strong>
        <span className="ui-document-input-hint">
          {props.description ?? `${acceptLabel(kinds)}${multiple ? " · 여러 파일과 폴더 가능" : " · 한 번에 한 파일"}`}
        </span>
        <div className="ui-document-input-actions">
          <Button variant="primary" icon={<FilePlus2 size={16} />} disabled={disabled} onClick={openFile}>
            파일 선택
          </Button>
          {allowFolder && (
            <Button icon={<FolderUp size={16} />} disabled={disabled} onClick={openFolder}>
              폴더 선택
            </Button>
          )}
          {allowLibrary && (
            <Button icon={<Library size={16} />} disabled={disabled} onClick={openPicker}>
              보관함에서 선택
            </Button>
          )}
        </div>
      </div>
      {status}
      {props.children}
      {picker}
    </div>
  );
}
