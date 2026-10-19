// 오른쪽 패널: "속성 | 실행" 탭. 열은 항상 있어서 선택이 바뀌어도 레이아웃이 움직이지 않는다.
// 실행이 시작되면 실행 탭에 점과 개수만 표시하고 탭을 자동으로 바꾸지 않는다.
import { ChevronLeft, ChevronRight, History, SlidersHorizontal } from "lucide-react";
import { useId, type ReactNode } from "react";
import { IconButton } from "../../../components/ui";
import { RIGHT_PANEL_MAX_WIDTH, RIGHT_PANEL_MIN_WIDTH, type RightPanelController, type RightPanelTab } from "./useRightPanelState";

const TABS: { id: RightPanelTab; label: string; icon: ReactNode }[] = [
  { id: "inspect", label: "속성", icon: <SlidersHorizontal size={15} /> },
  { id: "runs", label: "실행", icon: <History size={15} /> }
];

export function WorkflowRightPanel(props: {
  panel: RightPanelController;
  /** 처리 중인 실행 수(탭 점·숫자). */
  activeRunCount: number;
  inspect: ReactNode;
  runs: ReactNode;
}) {
  const { panel } = props;
  const baseId = useId();
  const badge = (tab: RightPanelTab) =>
    tab === "runs" && props.activeRunCount > 0 ? (
      <span className="wf-tab-badge" aria-label={`처리 중 ${props.activeRunCount}개`}>
        <i aria-hidden />
        {props.activeRunCount.toLocaleString()}
      </span>
    ) : null;

  if (panel.collapsed) {
    return (
      <aside className="wf-right-panel wf-right-panel-rail" aria-label="오른쪽 패널(접힘)">
        <IconButton label="패널 펴기 (⌘/Ctrl+\)" size="sm" variant="ghost" onClick={panel.toggleCollapsed}>
          <ChevronLeft size={16} />
        </IconButton>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="wf-rail-tab"
            data-active={panel.tab === tab.id ? "true" : undefined}
            onClick={() => panel.showTab(tab.id)}
            title={`${tab.label} 열기`}
          >
            {tab.icon}
            <span>{tab.label}</span>
            {badge(tab.id)}
          </button>
        ))}
      </aside>
    );
  }

  return (
    <aside className="wf-right-panel" aria-label="오른쪽 패널">
      <div
        className="wf-right-panel-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="오른쪽 패널 너비 조절"
        aria-valuemin={RIGHT_PANEL_MIN_WIDTH}
        aria-valuemax={RIGHT_PANEL_MAX_WIDTH}
        aria-valuenow={panel.width}
        tabIndex={0}
        onPointerDown={panel.startResize}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") panel.nudgeWidth(16);
          if (event.key === "ArrowRight") panel.nudgeWidth(-16);
        }}
      />
      <div className="wf-right-panel-tabs" role="tablist" aria-label="오른쪽 패널">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            id={`${baseId}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={panel.tab === tab.id}
            aria-controls={`${baseId}-panel-${tab.id}`}
            className="wf-right-panel-tab"
            onClick={() => panel.update({ tab: tab.id })}
          >
            {tab.icon}
            {tab.label}
            {badge(tab.id)}
          </button>
        ))}
        <IconButton
          label="패널 접기 (⌘/Ctrl+\)"
          size="sm"
          variant="ghost"
          className="wf-right-panel-collapse"
          onClick={panel.toggleCollapsed}
        >
          <ChevronRight size={16} />
        </IconButton>
      </div>
      {TABS.map((tab) => (
        <div
          key={tab.id}
          id={`${baseId}-panel-${tab.id}`}
          role="tabpanel"
          aria-labelledby={`${baseId}-tab-${tab.id}`}
          className="wf-right-panel-body"
          hidden={panel.tab !== tab.id}
        >
          {panel.tab === tab.id ? (tab.id === "inspect" ? props.inspect : props.runs) : null}
        </div>
      ))}
    </aside>
  );
}
