// Inspector 공통 조각: 섹션 틀, 검증 목록.
import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { WorkflowIssue } from "../types";

export function InspectorSection(props: { title: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={["wf-inspector-section", props.className ?? ""].filter(Boolean).join(" ")}>
      <header>
        <h4>{props.title}</h4>
        {props.actions}
      </header>
      {props.children}
    </section>
  );
}

/** 검증 문제 목록. 노드에 묶인 문제는 눌러서 그 노드를 선택한다. */
export function InspectorIssueList(props: {
  issues: WorkflowIssue[];
  emptyLabel?: string;
  nodeLabel?: (nodeId: string) => string | undefined;
  onSelectNode?: (nodeId: string) => void;
}) {
  if (!props.issues.length) {
    return (
      <p className="wf-inspector-ok">
        <CheckCircle2 size={14} /> {props.emptyLabel ?? "문제가 없습니다."}
      </p>
    );
  }
  return (
    <ul className="wf-issue-list">
      {props.issues.map((issue, index) => {
        const icon = issue.level === "error" ? <CircleAlert size={14} /> : <AlertTriangle size={14} />;
        const nodeLabel = issue.nodeId ? props.nodeLabel?.(issue.nodeId) : undefined;
        const body = (
          <>
            {icon}
            <span>
              {issue.message}
              {nodeLabel && <small>{nodeLabel}</small>}
            </span>
          </>
        );
        return (
          <li key={`${issue.level}-${issue.nodeId ?? ""}-${index}`} data-level={issue.level}>
            {issue.nodeId && props.onSelectNode ? (
              <button type="button" onClick={() => props.onSelectNode?.(issue.nodeId as string)} title="이 노드 선택">
                {body}
              </button>
            ) : (
              <div>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
