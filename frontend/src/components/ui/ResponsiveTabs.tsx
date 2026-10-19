import { useState, type ReactNode } from "react";

/**
 * 980px 초과: 패널을 모두 세로로 쌓아 보여준다. 980px 이하: 탭으로 하나씩 보여준다(spec B-1 반응형).
 */
export function ResponsiveTabs(props: {
  tabs: { id: string; label: string; content: ReactNode; hidden?: boolean }[];
  label: string;
  className?: string;
  defaultTab?: string;
}) {
  const visible = props.tabs.filter((tab) => !tab.hidden);
  const [active, setActive] = useState(props.defaultTab ?? visible[0]?.id ?? "");
  const activeId = visible.some((tab) => tab.id === active) ? active : visible[0]?.id;
  return (
    <div className={["ui-responsive-tabs", props.className ?? ""].filter(Boolean).join(" ")}>
      {visible.length > 1 && (
        <div className="ui-responsive-tablist" role="tablist" aria-label={props.label}>
          {visible.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeId}
              className={tab.id === activeId ? "active" : ""}
              onClick={() => setActive(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      {visible.map((tab) => (
        <div key={tab.id} className="ui-responsive-panel" data-active={tab.id === activeId}>
          {tab.content}
        </div>
      ))}
    </div>
  );
}
