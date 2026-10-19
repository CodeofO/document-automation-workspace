import { Check, CheckSquare, Clipboard, Copy, LayoutGrid, List as ListIcon, Scissors, Trash2 } from "lucide-react";
import { Button } from "../../../components/ui";
import type { LibraryViewMode } from "../model";

/** 선택 개수·클립보드 상태와 선택 작업(전체 선택, 복사·이동·붙여넣기, 삭제, 선택 적용). */
export function LibrarySelectionBar(props: {
  selectedCount: number;
  clipboardLabel: string;
  viewMode: LibraryViewMode;
  allVisibleSelected: boolean;
  canSelectAll: boolean;
  busy: boolean;
  canPaste: boolean;
  onViewMode: (mode: LibraryViewMode) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onCopy: (mode: "copy" | "cut") => void;
  onPaste: () => void;
  onDelete: () => void;
  /** picker 모드에서만 "선택 적용" 버튼을 보인다. */
  onApply?: () => void;
}) {
  const hasSelection = props.selectedCount > 0;
  return (
    <div className="document-library-selection-bar">
      <span>
        {hasSelection ? `${props.selectedCount.toLocaleString()}개 선택됨` : "문서를 선택하면 작업으로 보낼 수 있습니다."}
        {props.clipboardLabel ? ` · ${props.clipboardLabel}` : ""}
      </span>
      <div className="document-library-selection-actions">
        <div className="document-library-view-switch" role="group" aria-label="보기 방식">
          <button
            type="button"
            className={props.viewMode === "list" ? "active" : ""}
            aria-pressed={props.viewMode === "list"}
            onClick={() => props.onViewMode("list")}
            title="목록 보기"
          >
            <ListIcon size={14} />
            목록
          </button>
          <button
            type="button"
            className={props.viewMode === "icon" ? "active" : ""}
            aria-pressed={props.viewMode === "icon"}
            onClick={() => props.onViewMode("icon")}
            title="아이콘 보기"
          >
            <LayoutGrid size={14} />
            아이콘
          </button>
        </div>
        <div className="document-library-selection-group">
          <Button
            size="sm"
            icon={<CheckSquare size={14} />}
            disabled={!props.canSelectAll}
            onClick={props.onSelectAll}
            title="Command/Ctrl + A"
          >
            {props.allVisibleSelected ? "전체 해제" : "전체 선택"}
          </Button>
          {hasSelection && (
            <Button size="sm" onClick={props.onClearSelection}>
              선택 해제
            </Button>
          )}
        </div>
        <div className="document-library-selection-group">
          <Button
            size="sm"
            icon={<Copy size={14} />}
            disabled={!hasSelection || props.busy}
            onClick={() => props.onCopy("copy")}
            title="Command/Ctrl + C"
          >
            복사
          </Button>
          <Button
            size="sm"
            icon={<Scissors size={14} />}
            disabled={!hasSelection || props.busy}
            onClick={() => props.onCopy("cut")}
            title="Command/Ctrl + X"
          >
            이동
          </Button>
          <Button
            size="sm"
            icon={<Clipboard size={14} />}
            disabled={!props.canPaste || props.busy}
            onClick={props.onPaste}
            title="Command/Ctrl + V"
          >
            붙여넣기
          </Button>
        </div>
        <div className="document-library-selection-group">
          <Button
            size="sm"
            variant="danger-outline"
            icon={<Trash2 size={14} />}
            disabled={!hasSelection || props.busy}
            onClick={props.onDelete}
            title="Delete"
          >
            선택 삭제
          </Button>
          {props.onApply && (
            <Button size="sm" variant="primary" icon={<Check size={14} />} disabled={!hasSelection} onClick={props.onApply}>
              선택 적용
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
