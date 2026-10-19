import { ChevronLeft, ChevronRight, Maximize2, Minus, Plus } from "lucide-react";
import { useCallback, useRef, useState, type PointerEvent } from "react";
import { resolveAssetUrl } from "../../../api/client";
import type { WorkflowDocument, WorkflowDocumentPage, WorkflowRunItem } from "../types";

function workflowDocumentPageSrc(page: WorkflowDocumentPage) {
  return `${resolveAssetUrl(page.image_url)}?v=${page.width}x${page.height}-r${page.rotation_applied ?? 0}`;
}

type PanStart = { pointerId: number; startX: number; startY: number; originX: number; originY: number };

/**
 * 결과 창 가운데: 문서 페이지 미리보기(확대·이동).
 * 문서나 페이지가 바뀌면 부모가 key를 바꿔 확대 상태를 초기화한다.
 */
export function WorkflowDocumentPreview(props: {
  document: WorkflowDocument | null;
  loading: boolean;
  activePage: number;
  item: WorkflowRunItem | null;
  onPage: (page: number) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const panStartRef = useRef<PanStart | null>(null);

  const setPreviewZoom = useCallback((nextZoom: number) => {
    const clamped = Math.min(3, Math.max(0.5, Number(nextZoom.toFixed(2))));
    setZoom(clamped);
    if (clamped <= 1) setPan({ x: 0, y: 0 });
  }, []);

  const resetPreview = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setIsPanning(false);
    panStartRef.current = null;
  }, []);

  const onPreviewPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (zoom <= 1) return;
      panStartRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: pan.x,
        originY: pan.y
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsPanning(true);
    },
    [pan.x, pan.y, zoom]
  );

  const onPreviewPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    setPan({ x: start.originX + event.clientX - start.startX, y: start.originY + event.clientY - start.startY });
  }, []);

  const stopPreviewPan = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const start = panStartRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    panStartRef.current = null;
    setIsPanning(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }, []);

  if (props.loading) {
    return (
      <section className="workflow-preview-pane">
        <div className="workflow-preview-empty">문서 preview를 불러오는 중입니다.</div>
      </section>
    );
  }
  if (!props.document) {
    return (
      <section className="workflow-preview-pane">
        <div className="workflow-preview-empty">문서를 선택하면 이미지가 표시됩니다.</div>
      </section>
    );
  }
  const document = props.document;
  const safePage = Math.min(Math.max(0, props.activePage), Math.max(0, document.page_count - 1));
  const page = document.pages[safePage];
  return (
    <section className="workflow-preview-pane">
      <div className="workflow-preview-toolbar">
        <div className="workflow-preview-status">
          {props.item?.result.current_node_label && <strong>{props.item.result.current_node_label} 진행 중</strong>}
        </div>
        <div className="workflow-preview-page-controls">
          <button type="button" onClick={() => props.onPage(Math.max(0, safePage - 1))} disabled={safePage <= 0} aria-label="이전 페이지">
            <ChevronLeft size={15} />
          </button>
          <span>
            {safePage + 1} / {document.page_count}
          </span>
          <button
            type="button"
            onClick={() => props.onPage(Math.min(document.page_count - 1, safePage + 1))}
            disabled={safePage >= document.page_count - 1}
            aria-label="다음 페이지"
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <div className="workflow-preview-zoom-controls">
          <button type="button" onClick={() => setPreviewZoom(zoom - 0.25)} disabled={zoom <= 0.5} aria-label="축소" title="축소">
            <Minus size={15} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setPreviewZoom(zoom + 0.25)} disabled={zoom >= 3} aria-label="확대" title="확대">
            <Plus size={15} />
          </button>
          <button type="button" onClick={resetPreview} aria-label="전체 보기" title="전체 보기">
            <Maximize2 size={15} />
          </button>
        </div>
      </div>
      <div
        className={`workflow-preview-stage ${zoom > 1 ? "can-pan" : ""} ${isPanning ? "is-panning" : ""}`}
        onPointerDown={onPreviewPointerDown}
        onPointerMove={onPreviewPointerMove}
        onPointerUp={stopPreviewPan}
        onPointerCancel={stopPreviewPan}
      >
        <div className="workflow-preview-image-wrap" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          {page && <img src={workflowDocumentPageSrc(page)} alt={`${document.filename} ${safePage + 1}페이지`} draggable={false} />}
        </div>
      </div>
    </section>
  );
}
