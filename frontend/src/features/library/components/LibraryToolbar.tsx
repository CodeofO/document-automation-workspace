import { Search } from "lucide-react";
import type { DragEvent } from "react";
import { FileSourceMenu } from "../../../components/ui";
import { filesFromDataTransfer } from "../../../lib/files";
import { LIBRARY_FILE_ACCEPT, LIBRARY_STATUS_FILTERS } from "../model";

/**
 * 검색·상태 필터·문서 추가(파일/폴더 메뉴). 툴바에 끌어다 놓아도 업로드된다.
 * 문서 추가는 DocumentInput과 같은 메뉴(FileSourceMenu)를 쓰고, 결과는 보관함의 업로드 큐로 들어간다.
 */
export function LibraryToolbar(props: {
  totalCount: number;
  pendingUploadCount: number;
  query: string;
  status: string;
  /** picker 대화상자에서는 제목을 보여준다(화면에서는 PageHeader가 그린다). */
  showTitle?: boolean;
  onQueryChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onFiles: (files: File[], label: string) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
}) {
  return (
    <div className="document-library-toolbar" onDragOver={(event) => event.preventDefault()} onDrop={props.onDrop}>
      <div className="document-library-title">
        {props.showTitle && <p className="eyebrow">문서 보관함</p>}
        <span>
          {props.totalCount.toLocaleString()}개 문서
          {props.pendingUploadCount ? ` · 업로드 대기 ${props.pendingUploadCount}건` : ""}
        </span>
      </div>
      <div className="document-library-controls">
        <label className="library-search ui-search-field">
          <Search size={15} aria-hidden />
          <input
            value={props.query}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder="파일명 또는 경로 검색"
            aria-label="파일명 또는 경로 검색"
          />
        </label>
        <select value={props.status} onChange={(event) => props.onStatusChange(event.target.value)} aria-label="상태 필터">
          {LIBRARY_STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <FileSourceMenu
          label="문서 추가"
          variant="primary"
          accept={LIBRARY_FILE_ACCEPT}
          onFiles={(files) => props.onFiles(Array.from(files ?? []), "선택한 파일")}
          onDropFiles={(dataTransfer) => {
            void filesFromDataTransfer(dataTransfer).then((files) => props.onFiles(files, "드래그한 항목"));
          }}
        />
      </div>
    </div>
  );
}
