import { ChevronDown, FilePlus2, FolderOpen, Loader2, UploadCloud } from "lucide-react";
import { useRef, useState, type DragEvent, type ReactNode } from "react";
import { Button } from "./Button";
import { MenuItem, MenuList, useMenu } from "./Menu";

/**
 * 숨은 파일·폴더 input 한 쌍. 버튼에서 openFile/openFolder로 연다.
 * (e2e가 input[type=file]에 직접 파일을 넣을 수 있도록 항상 DOM에 둔다)
 */
export function useFileInputs(options: {
  accept: string;
  multiple: boolean;
  allowFolder: boolean;
  disabled?: boolean;
  onFiles: (files: FileList | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const folderRef = useRef<HTMLInputElement | null>(null);
  const inputs = (
    <>
      <input
        ref={fileRef}
        className="visually-hidden"
        type="file"
        tabIndex={-1}
        aria-hidden
        multiple={options.multiple}
        accept={options.accept}
        disabled={options.disabled}
        onChange={(event) => {
          options.onFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      {options.allowFolder && (
        <input
          ref={folderRef}
          className="visually-hidden"
          type="file"
          tabIndex={-1}
          aria-hidden
          multiple
          accept={options.accept}
          disabled={options.disabled}
          onChange={(event) => {
            options.onFiles(event.target.files);
            event.currentTarget.value = "";
          }}
          {...{ webkitdirectory: "", directory: "" }}
        />
      )}
    </>
  );
  return { inputs, openFile: () => fileRef.current?.click(), openFolder: () => folderRef.current?.click() };
}

/** 끌어다 놓기 상태(dragging)와 핸들러. 자식 요소 사이를 오갈 때 깜빡이지 않게 relatedTarget을 본다. */
export function useDropTarget(onDrop: (dataTransfer: DataTransfer) => void, disabled?: boolean) {
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    handlers: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (disabled) return;
        event.preventDefault();
        if (!dragging) setDragging(true);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setDragging(false);
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) onDrop(event.dataTransfer);
      }
    }
  };
}

/**
 * "문서 추가 ▾" 메뉴(파일 선택 / 폴더 선택 / + 추가 항목). DocumentInput의 button 변형과 보관함 툴바가 쓴다.
 * 버튼에 끌어다 놓아도 된다(onDropFiles).
 */
export function FileSourceMenu(props: {
  label: string;
  accept: string;
  multiple?: boolean;
  allowFolder?: boolean;
  disabled?: boolean;
  busy?: boolean;
  variant?: "primary" | "secondary";
  onFiles: (files: FileList | null) => void;
  onDropFiles?: (dataTransfer: DataTransfer) => void;
  /** 메뉴 아래쪽 추가 항목(예: 보관함에서 선택). close를 불러 메뉴를 닫는다. */
  extraItems?: (close: () => void) => ReactNode;
  status?: ReactNode;
  className?: string;
}) {
  const multiple = props.multiple ?? true;
  const allowFolder = (props.allowFolder ?? true) && multiple;
  const { open, ref, toggle, close } = useMenu();
  const { inputs, openFile, openFolder } = useFileInputs({
    accept: props.accept,
    multiple,
    allowFolder,
    disabled: props.disabled,
    onFiles: props.onFiles
  });
  const drop = useDropTarget((dataTransfer) => props.onDropFiles?.(dataTransfer), props.disabled || !props.onDropFiles);
  return (
    <div
      className={["ui-file-source workflow-upload-picker", drop.dragging ? "dragging" : "", props.className ?? ""]
        .filter(Boolean)
        .join(" ")}
      ref={ref}
      {...drop.handlers}
    >
      {inputs}
      <Button
        variant={props.variant ?? "secondary"}
        icon={props.busy ? <Loader2 size={16} className="spin" /> : <UploadCloud size={16} />}
        disabled={props.disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        {props.label}
        <ChevronDown size={14} />
      </Button>
      {open && !props.disabled && (
        <MenuList label={props.label}>
          <MenuItem
            icon={<FilePlus2 size={15} />}
            onSelect={() => {
              close();
              openFile();
            }}
          >
            파일 선택
          </MenuItem>
          {allowFolder && (
            <MenuItem
              icon={<FolderOpen size={15} />}
              onSelect={() => {
                close();
                openFolder();
              }}
            >
              폴더 선택
            </MenuItem>
          )}
          {props.extraItems?.(close)}
        </MenuList>
      )}
      {props.status && <div className="ui-file-source-status">{props.status}</div>}
    </div>
  );
}
