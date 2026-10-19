import { FileText, X } from "lucide-react";
import type { LibraryDocument } from "../../api/types";
import { Button, StatusBadge } from "../../components/ui";
import { summarizeDocuments } from "../../lib/files";
import { libraryStatusLabel } from "./model";

/**
 * 선택한 보관함 문서 미리보기(spec B-2 selected). 모든 모듈이 같은 모양을 쓴다.
 * 처리 단위가 페이지라서 "PDF 3개 · 21페이지"처럼 페이지 수를 함께 보여준다.
 */
export function LibraryDocumentSelectionPreview(props: {
  documents: LibraryDocument[];
  onClear: () => void;
  className?: string;
  limit?: number;
  /** 행을 누르면(예: 뷰어로 열기) */
  onOpen?: (document: LibraryDocument) => void;
  hint?: string;
}) {
  const limit = props.limit ?? 50;
  const pageCount = props.documents.reduce((sum, document) => sum + (document.page_count || 0), 0);
  const waiting = props.documents.filter((document) => document.status !== "ready").length;
  return (
    <div className={["ui-selection-preview", props.className ?? ""].filter(Boolean).join(" ")}>
      <div className="ui-selection-head">
        <div>
          <strong>{props.documents.length.toLocaleString()}개 문서 선택됨</strong>
          <span className="ui-selection-summary">{summarizeDocuments(props.documents)}</span>
          <small>
            {props.hint ??
              (pageCount
                ? `페이지마다 한 항목으로 처리합니다(${pageCount.toLocaleString()}페이지). `
                : "") + (waiting ? "변환 중인 문서는 준비되면 실행됩니다." : "실행을 누르면 바로 시작합니다.")}
          </small>
        </div>
        <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={props.onClear}>
          선택 해제
        </Button>
      </div>
      <ul className="ui-selection-list">
        {props.documents.slice(0, limit).map((document) => (
          <li key={document.document_id}>
            {props.onOpen ? (
              <button type="button" className="ui-selection-row" onClick={() => props.onOpen?.(document)}>
                <SelectionRow document={document} />
              </button>
            ) : (
              <div className="ui-selection-row">
                <SelectionRow document={document} />
              </div>
            )}
          </li>
        ))}
        {props.documents.length > limit && (
          <li className="muted ui-selection-more">+ {(props.documents.length - limit).toLocaleString()}개 더 있음</li>
        )}
      </ul>
    </div>
  );
}

function SelectionRow({ document }: { document: LibraryDocument }) {
  return (
    <>
      <FileText size={15} aria-hidden />
      <span className="ui-selection-name" title={document.library_path || document.filename}>
        {document.filename}
      </span>
      <small>{document.page_count ? `${document.page_count.toLocaleString()}p` : ""}</small>
      <StatusBadge status={document.status} subject="document" label={libraryStatusLabel(document.status)} />
    </>
  );
}
