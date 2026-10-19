import { MoreHorizontal } from "lucide-react";
import type { ReactNode } from "react";
import { MenuButton } from "./Menu";

export type PageStep = { label: string; active: boolean; done: boolean };

/**
 * 모듈 화면 상단: eyebrow · 제목 · 설명 · 단계 · [보조 액션] [Primary].
 * collapseActions면 640px 이하에서 액션을 ⋯ 메뉴로 넣는다.
 */
export function PageHeader(props: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  steps?: PageStep[];
  actions?: ReactNode;
  headingLevel?: 1 | 2;
  className?: string;
  /** 640px 이하에서 액션을 ⋯ 메뉴로 접는다. */
  collapseActions?: boolean;
}) {
  const Heading = props.headingLevel === 1 ? "h1" : "h2";
  return (
    <div className={["pane-header ui-page-header", props.className ?? ""].filter(Boolean).join(" ")}>
      <div className="ui-page-header-text">
        {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
        <Heading>{props.title}</Heading>
        {props.description && <small>{props.description}</small>}
      </div>
      {props.steps && <StepPills steps={props.steps} />}
      {props.actions && (
        <div className={["ui-page-header-actions", props.collapseActions ? "collapsible" : ""].join(" ")}>
          {props.actions}
        </div>
      )}
      {props.actions && props.collapseActions && (
        <MenuButton
          className="ui-page-header-more"
          label=""
          icon={<MoreHorizontal size={18} />}
          ariaLabel="더 보기"
          align="right"
        >
          {() => <div className="ui-page-header-menu">{props.actions}</div>}
        </MenuButton>
      )}
    </div>
  );
}

export function StepPills({ steps }: { steps: PageStep[] }) {
  return (
    <div className="ui-step-pills" aria-label="진행 단계">
      {steps.map((step, index) => (
        <span
          key={step.label}
          className={`step-pill ${step.active ? "active" : ""} ${step.done ? "done" : ""}`}
          aria-current={step.active ? "step" : undefined}
        >
          <span className="step-pill-index" aria-hidden>
            {index + 1}
          </span>
          {step.label}
        </span>
      ))}
    </div>
  );
}
