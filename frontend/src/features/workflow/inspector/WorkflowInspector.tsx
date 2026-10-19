// 선택이 없을 때의 Inspector: 워크플로우 이름·설명, 검증 요약, 실행 문서, 단축키 안내.
import { FileJson, X } from "lucide-react";
import { Button } from "../../../components/ui";
import { statusLabel } from "../../../lib/status";
import type { LibraryDocument } from "../../library";
import type { WorkflowIssue } from "../types";
import { InspectorIssueList, InspectorSection } from "./InspectorParts";

const SHORTCUTS: [string, string][] = [
  ["클릭 / Shift+클릭", "선택 / 여러 개 선택"],
  ["Enter", "에셋 편집 열기"],
  ["Delete", "선택 삭제"],
  ["⌘/Ctrl+D", "복제"],
  ["⌘/Ctrl+S", "저장"],
  ["⌘/Ctrl+\\", "패널 접기/펴기"],
  ["F", "화면에 맞추기"],
  ["Esc", "선택 해제"]
];

export function WorkflowInspector(props: {
  workflowName: string;
  description: string;
  onDescriptionChange: (value: string) => void;
  nodeCount: number;
  edgeCount: number;
  issues: WorkflowIssue[];
  nodeLabel: (nodeId: string) => string | undefined;
  onSelectNode: (nodeId: string) => void;
  files: File[];
  libraryDocuments: LibraryDocument[];
  onClearDocuments: () => void;
}) {
  const errorCount = props.issues.filter((issue) => issue.level === "error").length;
  const warningCount = props.issues.length - errorCount;
  const documentCount = props.files.length || props.libraryDocuments.length;
  const visibleDocuments = props.libraryDocuments.slice(0, 5);
  // 실행은 페이지마다 항목 하나다. 보관 문서는 페이지 수를 알 수 있어 함께 보여준다.
  const pageCount = props.files.length ? 0 : props.libraryDocuments.reduce((sum, document) => sum + (document.page_count || 0), 0);
  const documentSummary = documentCount
    ? `문서 ${documentCount.toLocaleString()}개${pageCount ? ` · ${pageCount.toLocaleString()}페이지` : ""}`
    : "";
  return (
    <div className="wf-inspector" role="region" aria-label="워크플로우 속성">
      <header className="wf-inspector-head">
        <div>
          <p className="eyebrow">워크플로우</p>
          <h3 title={props.workflowName}>{props.workflowName}</h3>
          <small>
            노드 {props.nodeCount.toLocaleString()} · 연결 {props.edgeCount.toLocaleString()}
          </small>
        </div>
      </header>

      <InspectorSection title="설명">
        <textarea
          className="wf-inspector-textarea"
          value={props.description}
          onChange={(event) => props.onDescriptionChange(event.target.value)}
          placeholder="이 워크플로우가 처리하는 문서와 목적을 적어 두세요."
          aria-label="워크플로우 설명"
          rows={3}
        />
      </InspectorSection>

      <InspectorSection
        title={
          <>
            검증{" "}
            <span className="wf-inspector-counts">
              {errorCount > 0 && <span data-tone="danger">오류 {errorCount}</span>}
              {warningCount > 0 && <span data-tone="warning">경고 {warningCount}</span>}
            </span>
          </>
        }
      >
        <InspectorIssueList
          issues={props.issues}
          emptyLabel="실행할 수 있는 상태입니다."
          nodeLabel={props.nodeLabel}
          onSelectNode={props.onSelectNode}
        />
      </InspectorSection>

      <InspectorSection
        title={documentSummary ? `실행 문서 · ${documentSummary}` : "실행 문서"}
        actions={
          documentCount > 0 ? (
            <Button size="sm" variant="ghost" icon={<X size={14} />} onClick={props.onClearDocuments}>
              비우기
            </Button>
          ) : undefined
        }
      >
        {documentCount === 0 ? (
          <p className="wf-inspector-muted">툴바의 업로드 또는 문서 보관함 버튼으로 실행할 문서를 고르세요.</p>
        ) : props.files.length ? (
          <p className="wf-inspector-muted">
            업로드할 파일 {props.files.length.toLocaleString()}개 · 실행하면 문서 보관함에 먼저 올립니다.
          </p>
        ) : (
          <ul className="wf-document-list" aria-label="선택된 보관 문서">
            {visibleDocuments.map((document) => (
              <li key={document.document_id}>
                <FileJson size={14} />
                <span title={document.filename}>{document.filename}</span>
                <small data-status={document.status}>{statusLabel(document.status, "document")}</small>
              </li>
            ))}
            {props.libraryDocuments.length > visibleDocuments.length && (
              <li className="wf-document-more">+ {(props.libraryDocuments.length - visibleDocuments.length).toLocaleString()}개 더</li>
            )}
          </ul>
        )}
      </InspectorSection>

      <InspectorSection title="단축키" className="wf-inspector-shortcuts">
        <dl>
          {SHORTCUTS.map(([keys, label]) => (
            <div key={keys}>
              <dt>{keys}</dt>
              <dd>{label}</dd>
            </div>
          ))}
        </dl>
      </InspectorSection>
    </div>
  );
}
