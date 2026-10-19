import { Check, FileText, Trash2, UploadCloud } from "lucide-react";
import type { DragEvent, MouseEvent as ReactMouseEvent } from "react";
import type { LibraryDocument } from "../../../api/types";
import { Button, StatusBadge } from "../../../components/ui";
import { formatBytes, formatDateTime } from "../../../lib/format";
import { libraryStatusLabel, type LibraryViewMode } from "../model";

/**
 * 문서 카드 목록. 카드의 주 버튼 이름은 "<파일명> <경로·크기…> <상태>"로 시작한다(e2e가 의존).
 */
export function LibraryDocumentList(props: {
  documents: LibraryDocument[];
  selectedIds: ReadonlySet<string>;
  viewMode: LibraryViewMode;
  onToggle: (document: LibraryDocument, event: ReactMouseEvent<HTMLButtonElement>) => void;
  onDelete: (document: LibraryDocument) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  return (
    <div className={`document-library-list ${props.viewMode === "icon" ? "icon-view" : "list-view"}`}>
      {props.documents.length ? (
        props.documents.map((document) => {
          const selected = props.selectedIds.has(document.document_id);
          return (
            <article key={document.document_id} className={`document-library-row ${document.status} ${selected ? "selected" : ""}`}>
              <button
                type="button"
                className="document-library-row-main"
                aria-pressed={selected}
                onClick={(event) => props.onToggle(document, event)}
              >
                <span className="document-library-check">{selected ? <Check size={15} /> : null}</span>
                <span className="document-library-icon">
                  <FileText size={18} />
                </span>
                <span className="document-library-info">
                  <strong>{document.filename}</strong>
                  <small>
                    {document.library_path || document.filename} · {document.page_count.toLocaleString()}p ·{" "}
                    {formatBytes(document.size_bytes)} · {formatDateTime(document.created_at)}
                  </small>
                  {document.error_message && <small className="ui-error-text">{document.error_message}</small>}
                </span>
                <StatusBadge
                  status={document.status}
                  subject="document"
                  label={libraryStatusLabel(document.status)}
                  className="document-library-status"
                />
              </button>
              <Button
                size="sm"
                variant="danger-outline"
                icon={<Trash2 size={14} />}
                disabled={document.status === "deleted"}
                onClick={() => props.onDelete(document)}
              >
                원본 삭제
              </Button>
            </article>
          );
        })
      ) : (
        <div className="document-library-empty" onDragOver={(event) => event.preventDefault()} onDrop={props.onDrop}>
          <UploadCloud size={36} />
          <strong>문서를 업로드하세요</strong>
          <span>파일이나 폴더를 끌어오거나 상단의 추가 버튼을 사용할 수 있습니다.</span>
        </div>
      )}
    </div>
  );
}
