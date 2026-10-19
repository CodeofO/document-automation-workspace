import { UploadCloud } from "lucide-react";
import type { ChangeEvent, CSSProperties } from "react";
import { MenuList, useMenu } from "./Menu";

/**
 * "업로드 ▾" 메뉴(파일 선택 / 폴더 선택). App·ModuleWorkspace·WorkflowBuilder의 3벌을 대체한다.
 * 4B의 DocumentInput(button 변형)이 이 컴포넌트 위에 올라간다.
 */
export function UploadPicker(props: {
  accept: string;
  disabled?: boolean;
  includeFolder?: boolean;
  label?: string;
  multiple?: boolean;
  selectedCount?: number;
  align?: "left" | "right";
  fixed?: boolean;
  className?: string;
  onSelectFiles: (files: FileList | null) => void;
  /** 원본 change 이벤트가 필요한 호출자용 */
  onChangeEvent?: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  const { open, ref, toggle, close, menuStyle, fixed } = useMenu({ fixed: props.fixed, placement: props.align });
  const includeFolder = props.includeFolder ?? true;
  const multiple = props.multiple ?? true;
  const triggerLabel = props.selectedCount
    ? `${props.selectedCount.toLocaleString()}개 파일 선택됨`
    : (props.label ?? "업로드");

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    close();
    if (props.onChangeEvent) props.onChangeEvent(event);
    else props.onSelectFiles(event.target.files);
    event.currentTarget.value = "";
  };

  return (
    <div className={["workflow-upload-picker unified-upload-picker", props.className ?? ""].join(" ")} ref={ref}>
      <button
        type="button"
        className="workflow-upload"
        disabled={props.disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <UploadCloud size={17} />
        <span>{triggerLabel}</span>
      </button>
      {open && !props.disabled && (
        <MenuList align={props.align} fixed={fixed} style={menuStyle as CSSProperties | undefined}>
          <label className="workflow-upload-menu-item" role="menuitem">
            파일 선택
            <input type="file" multiple={multiple} accept={props.accept} onChange={onChange} />
          </label>
          {includeFolder && (
            <label className="workflow-upload-menu-item" role="menuitem">
              폴더 선택
              <input
                type="file"
                multiple
                accept={props.accept}
                onChange={onChange}
                {...{ webkitdirectory: "", directory: "" }}
              />
            </label>
          )}
        </MenuList>
      )}
    </div>
  );
}
