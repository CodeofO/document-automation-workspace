import { Clipboard, Copy, FolderOpen, FolderPlus, Scissors } from "lucide-react";
import { Button } from "../../../components/ui";
import type { LibraryFolder } from "../api";

/** 왼쪽 폴더 목록과 폴더 단위 작업(새 폴더·복사·이동·붙여넣기). */
export function LibraryFolderTree(props: {
  folders: LibraryFolder[];
  activeFolder: string;
  totalCount: number;
  busy: boolean;
  canPaste: boolean;
  onSelectFolder: (path: string) => void;
  onCreateFolder: () => void;
  onCopyFolder: (mode: "copy" | "cut") => void;
  onPaste: () => void;
}) {
  const folderButtons = props.folders.filter((folder) => folder.path);
  return (
    <aside className="document-library-folders">
      <div className="document-library-folder-tools">
        <Button size="sm" icon={<FolderPlus size={14} />} disabled={props.busy} onClick={props.onCreateFolder}>
          새 폴더
        </Button>
        <Button
          size="sm"
          icon={<Copy size={14} />}
          disabled={!props.activeFolder || props.busy}
          onClick={() => props.onCopyFolder("copy")}
        >
          폴더 복사
        </Button>
        <Button
          size="sm"
          icon={<Scissors size={14} />}
          disabled={!props.activeFolder || props.busy}
          onClick={() => props.onCopyFolder("cut")}
        >
          폴더 이동
        </Button>
        <Button size="sm" icon={<Clipboard size={14} />} disabled={!props.canPaste || props.busy} onClick={props.onPaste}>
          붙여넣기
        </Button>
      </div>
      <FolderButton label="전체 문서" count={props.totalCount} active={props.activeFolder === ""} onClick={() => props.onSelectFolder("")} />
      {folderButtons.map((folder) => (
        <FolderButton
          key={folder.path}
          label={folder.path}
          count={folder.total_count}
          active={props.activeFolder === folder.path}
          onClick={() => props.onSelectFolder(folder.path)}
        />
      ))}
    </aside>
  );
}

function FolderButton(props: { label: string; count: number; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`document-library-folder-button ${props.active ? "active" : ""}`}
      aria-current={props.active ? "true" : undefined}
      onClick={props.onClick}
    >
      <FolderOpen size={16} />
      <span>{props.label}</span>
      <small>{props.count}</small>
    </button>
  );
}
