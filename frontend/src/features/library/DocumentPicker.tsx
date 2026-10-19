import { FolderOpen } from "lucide-react";
import { useState } from "react";
import type { LibraryDocument } from "../../api/types";
import { Button, Dialog } from "../../components/ui";
import { DocumentLibraryPanel } from "./DocumentLibraryPanel";

export type DocumentPickerButtonProps = {
  label?: string;
  disabled?: boolean;
  /** false면 한 문서만 고른다. */
  multiple?: boolean;
  selectedDocuments: LibraryDocument[];
  uploadChunkFiles?: number;
  onSelected: (documents: LibraryDocument[]) => void;
};

/** 모듈 화면의 "문서 보관함" 버튼. 누르면 보관함 picker 대화상자를 연다. */
export function DocumentPickerButton(props: DocumentPickerButtonProps) {
  const [open, setOpen] = useState(false);
  const [draftSelectedIds, setDraftSelectedIds] = useState<string[]>([]);
  const selectedCount = props.selectedDocuments.length;
  const single = props.multiple === false;

  return (
    <>
      <Button
        className="library-picker-trigger"
        icon={<FolderOpen size={16} />}
        disabled={props.disabled}
        onClick={() => {
          setDraftSelectedIds(props.selectedDocuments.map((document) => document.document_id));
          setOpen(true);
        }}
      >
        {selectedCount ? `${selectedCount.toLocaleString()}개 문서 선택됨` : (props.label ?? "문서 보관함")}
      </Button>
      <DocumentPickerDialog
        open={open}
        single={single}
        uploadChunkFiles={props.uploadChunkFiles}
        selectedIds={draftSelectedIds}
        onSelectedIds={setDraftSelectedIds}
        onClose={() => setOpen(false)}
        onApply={(documents) => {
          props.onSelected(single ? documents.slice(0, 1) : documents);
          setOpen(false);
        }}
      />
    </>
  );
}

/** 보관함 picker 대화상자(공용 Dialog: focus trap, Esc 닫기). 제목 "실행할 문서 선택". */
export function DocumentPickerDialog(props: {
  open: boolean;
  single?: boolean;
  uploadChunkFiles?: number;
  selectedIds: string[];
  onSelectedIds: (ids: string[]) => void;
  onClose: () => void;
  onApply: (documents: LibraryDocument[]) => void;
}) {
  return (
    <Dialog
      open={props.open}
      eyebrow="문서 보관함"
      title="실행할 문서 선택"
      size="lg"
      className="library-picker-dialog"
      onClose={() => {
        // 삭제 확인 같은 대화상자가 위에 떠 있으면 Esc는 그쪽만 닫는다.
        if (document.querySelectorAll('[role="dialog"]').length > 1) return;
        props.onClose();
      }}
    >
      <DocumentLibraryPanel
        mode="picker"
        uploadChunkFiles={props.uploadChunkFiles}
        selectedIds={props.selectedIds}
        onSelectedIds={(ids) => props.onSelectedIds(props.single ? ids.slice(-1) : ids)}
        onApply={props.onApply}
      />
    </Dialog>
  );
}
