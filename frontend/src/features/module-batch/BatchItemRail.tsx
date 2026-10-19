// 배치 항목 목록(spec B-1 Rail, 260px). 1100px 이하에서는 가로 칩으로 접힌다(CSS).
import { documentPageThumbnailUrl } from "../../api/client";
import { StatusBadge, useVirtualRows } from "../../components/ui";

const ROW_HEIGHT = 56;

export type BatchRailItem = {
  id: string;
  document_id: string;
  label: string;
  status: string;
  page_number?: number | null;
  error_message?: string | null;
};

export function BatchItemRail(props: {
  items: BatchRailItem[];
  activeItemId: string | null;
  onOpen: (itemId: string) => void;
  label?: string;
}) {
  const activeIndex = Math.max(
    0,
    props.items.findIndex((item) => item.id === props.activeItemId)
  );
  const { containerRef, onScroll, start, end, spacerStyle, windowStyle } = useVirtualRows({
    count: props.items.length,
    activeIndex,
    rowHeight: ROW_HEIGHT,
    initialViewportHeight: 480,
    activeKey: props.activeItemId
  });
  const visible = props.items.slice(start, end);
  return (
    <nav className="ui-batch-rail" aria-label={props.label ?? "배치 항목"}>
      <div className="ui-batch-rail-head">
        <span className="eyebrow">항목</span>
        <span>{props.items.length.toLocaleString()}개</span>
      </div>
      <div className="ui-batch-rail-list" ref={containerRef} onScroll={onScroll}>
        <div className="virtual-list-spacer" style={spacerStyle}>
          <div className="virtual-list-window" style={windowStyle}>
            {visible.map((item) => (
              <button
                type="button"
                key={item.id}
                className={item.id === props.activeItemId ? "ui-batch-rail-item active" : "ui-batch-rail-item"}
                aria-current={item.id === props.activeItemId ? "true" : undefined}
                title={item.error_message ?? item.label}
                onClick={() => props.onOpen(item.id)}
              >
                <img
                  src={documentPageThumbnailUrl(item.document_id, item.page_number ?? 1, 64)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                />
                <span className="ui-batch-rail-label">{item.label}</span>
                <StatusBadge status={item.status} />
              </button>
            ))}
          </div>
        </div>
      </div>
    </nav>
  );
}
