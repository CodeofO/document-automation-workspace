import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type UIEvent } from "react";

/**
 * 고정 높이 행의 가상 스크롤. 활성 행이 화면 밖이면 스크롤해 보여준다.
 * activeKey를 주면 그 값이 바뀔 때만 자동 스크롤한다(폴링 중 위치가 튀지 않게).
 * (App·ModuleWorkspace·WorkflowBuilder의 3벌을 대체)
 */
export function useVirtualRows(options: {
  count: number;
  activeIndex: number;
  rowHeight: number;
  overscan?: number;
  initialViewportHeight?: number;
  activeKey?: string | null;
}) {
  const { count, activeIndex, rowHeight, overscan = 8, initialViewportHeight = 480, activeKey } = options;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(initialViewportHeight);
  const previousActiveKeyRef = useRef<string | null | undefined>(undefined);
  const trackActiveKey = activeKey !== undefined;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const updateHeight = () => setViewportHeight(element.clientHeight || initialViewportHeight);
    updateHeight();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateHeight);
      return () => window.removeEventListener("resize", updateHeight);
    }
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [initialViewportHeight]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || activeIndex < 0 || count <= 0) return;
    if (trackActiveKey) {
      if (previousActiveKeyRef.current === activeKey) return;
      previousActiveKeyRef.current = activeKey;
    }
    const rowTop = activeIndex * rowHeight;
    const rowBottom = rowTop + rowHeight;
    const viewTop = element.scrollTop;
    const viewBottom = viewTop + element.clientHeight;
    if (rowTop < viewTop) {
      element.scrollTop = Math.max(0, rowTop - rowHeight * 2);
      setScrollTop(element.scrollTop);
    } else if (rowBottom > viewBottom) {
      element.scrollTop = Math.max(0, rowBottom - element.clientHeight + rowHeight * 2);
      setScrollTop(element.scrollTop);
    }
  }, [activeIndex, activeKey, count, rowHeight, trackActiveKey]);

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setScrollTop(event.currentTarget.scrollTop);
  }, []);

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const visibleCount = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(count, start + visibleCount);
  const spacerStyle = useMemo<CSSProperties>(() => ({ height: Math.max(1, count) * rowHeight }), [count, rowHeight]);
  const windowStyle = useMemo<CSSProperties>(
    () => ({ transform: `translateY(${start * rowHeight}px)` }),
    [start, rowHeight]
  );

  return { containerRef, onScroll, start, end, spacerStyle, windowStyle };
}
