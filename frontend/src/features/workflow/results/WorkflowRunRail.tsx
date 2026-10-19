import { useVirtualRows } from "../../../components/ui";
import { statusLabel } from "../../../lib/status";
import { workflowItemLabel, workflowResultFilterOptions } from "../model/resultFilters";
import type { WorkflowClassFilterOption, WorkflowResultFilter, WorkflowRun, WorkflowRunItem } from "../types";

const ROW_HEIGHT = 64;
const OVERSCAN = 8;

/** 결과 창 왼쪽: 상태·분류 필터와 가상 스크롤 문서 목록. */
export function WorkflowRunRail(props: {
  run: WorkflowRun;
  items: WorkflowRunItem[];
  selectedItem: WorkflowRunItem | null;
  statusFilter: WorkflowResultFilter;
  classFilter: string;
  filterCounts: Record<WorkflowResultFilter, number>;
  classFilterOptions: WorkflowClassFilterOption[];
  onStatusFilter: (filter: WorkflowResultFilter) => void;
  onClassFilter: (filter: string) => void;
  onSelectItem: (itemId: string) => void;
}) {
  const activeIndex = Math.max(0, props.items.findIndex((item) => item.id === props.selectedItem?.id));
  const { containerRef, onScroll, start, end, spacerStyle, windowStyle } = useVirtualRows({
    count: props.items.length,
    activeIndex,
    rowHeight: ROW_HEIGHT,
    overscan: OVERSCAN,
    initialViewportHeight: 420,
    activeKey: props.selectedItem?.id ?? null
  });
  const visibleItems = props.items.slice(start, end);

  return (
    <aside className="workflow-run-rail">
      <div className="workflow-run-rail-head">
        <span>
          {props.items.length.toLocaleString()} / {props.run.total_count.toLocaleString()}개 항목
        </span>
        <small>{statusLabel(props.run.status)}</small>
      </div>
      <div className="workflow-run-filter" role="tablist" aria-label="항목 상태 필터">
        {workflowResultFilterOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            className={props.statusFilter === option.value ? "active" : ""}
            onClick={() => props.onStatusFilter(option.value)}
          >
            <span>{option.label}</span>
            <strong>{props.filterCounts[option.value].toLocaleString()}</strong>
          </button>
        ))}
      </div>
      <label className="workflow-class-filter">
        <span>Class</span>
        <select value={props.classFilter} onChange={(event) => props.onClassFilter(event.target.value)}>
          {props.classFilterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} · {option.count.toLocaleString()}
            </option>
          ))}
        </select>
      </label>
      {(props.statusFilter !== "all" || props.classFilter !== "all") && (
        <div className="workflow-active-filters">
          <span>{props.items.length.toLocaleString()}개 표시 중</span>
          <button
            type="button"
            onClick={() => {
              props.onStatusFilter("all");
              props.onClassFilter("all");
            }}
          >
            필터 해제
          </button>
        </div>
      )}
      <div className="workflow-run-list workflow-virtual-list" ref={containerRef} onScroll={onScroll}>
        {props.items.length ? (
          <div className="virtual-list-spacer" style={spacerStyle}>
            <div className="virtual-list-window" style={windowStyle}>
              {visibleItems.map((item) => {
                const result = item.result ?? {};
                const classification = result.classification?.class_name || result.classification?.status || "-";
                const activeNode =
                  item.status === "queued" ? "대기 중" : result.current_node_label || statusLabel(item.status);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={item.id === props.selectedItem?.id ? "active" : ""}
                    onClick={() => props.onSelectItem(item.id)}
                  >
                    <span>
                      <i className={`workflow-status-dot ${item.status}`} />
                      <strong>{workflowItemLabel(item)}</strong>
                    </span>
                    <small>
                      {classification} · {activeNode}
                    </small>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="workflow-run-list-empty">선택한 상태의 문서가 없습니다.</div>
        )}
      </div>
    </aside>
  );
}
