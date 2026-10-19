// 한 페이지 위에 여러 영역 상자(색이 다른)를 동시에 그리고 옮기고 크기를 바꾸는 편집기.
// RegionPicker(상자 1개, 모달)의 다중 버전이다. 좌표는 페이지 비율(0~1, 왼쪽 위 원점).
import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { clamp01 } from "../../lib/format";
import {
  MIN_REGION_SIZE as MIN,
  moveRegion,
  normalizeRegion,
  resizeRegion,
  type RatioRegion,
  type RegionHandle
} from "./regionMath";

export type EditableRegion = RatioRegion;

export type RegionBox = {
  id: string;
  label: string;
  /** CSS 색(예: var(--table-region-1)) */
  color: string;
  region: EditableRegion | null;
};

const HANDLES: RegionHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const KEY_STEP = 0.005;

type Drag =
  | { mode: "draw"; id: string; start: { x: number; y: number } }
  | { mode: "move" | RegionHandle; id: string; start: { x: number; y: number }; origin: EditableRegion };

function applyDrag(drag: Exclude<Drag, { mode: "draw" }>, dx: number, dy: number): EditableRegion {
  return drag.mode === "move" ? moveRegion(drag.origin, dx, dy) : resizeRegion(drag.origin, drag.mode, dx, dy);
}

/**
 * 상자를 누르면 선택(onSelect), 몸통을 끌면 이동, 모서리·변 손잡이를 끌면 크기 조절.
 * 선택한 상자에 영역이 없으면(drawId) 빈 곳을 끌어 새로 그린다. 방향키로 선택 상자를 옮긴다(Shift: 크게).
 */
export function MultiRegionEditor(props: {
  imageUrl: string | null;
  imageAlt: string;
  boxes: RegionBox[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onChange: (id: string, region: EditableRegion) => void;
  /** 이 상자 id로 새 영역을 그릴 수 있다(빈 곳 드래그). null이면 그리기 없음. */
  drawId?: string | null;
  /** 이미지 위에 덧그릴 내용(예: 미리보기 행 띠) */
  overlay?: ReactNode;
  emptyText?: ReactNode;
  className?: string;
}) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [drawPreview, setDrawPreview] = useState<EditableRegion | null>(null);

  function pointFromEvent(event: PointerEvent<HTMLElement>) {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height)
    };
  }

  function beginBoxDrag(event: PointerEvent<HTMLElement>, box: RegionBox, mode: "move" | RegionHandle) {
    event.stopPropagation();
    props.onSelect(box.id);
    if (!box.region) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    canvasRef.current?.setPointerCapture?.(event.pointerId);
    setDrag({ mode, id: box.id, start: point, origin: box.region });
  }

  function onCanvasPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!props.drawId) return;
    const point = pointFromEvent(event);
    if (!point) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({ mode: "draw", id: props.drawId, start: point });
    setDrawPreview({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag) return;
    const point = pointFromEvent(event);
    if (!point) return;
    if (drag.mode === "draw") {
      setDrawPreview({
        x: Math.min(drag.start.x, point.x),
        y: Math.min(drag.start.y, point.y),
        width: Math.abs(point.x - drag.start.x),
        height: Math.abs(point.y - drag.start.y)
      });
      return;
    }
    props.onChange(drag.id, applyDrag(drag, point.x - drag.start.x, point.y - drag.start.y));
  }

  function onPointerUp() {
    if (drag?.mode === "draw" && drawPreview && drawPreview.width > MIN && drawPreview.height > MIN) {
      props.onChange(drag.id, normalizeRegion(drawPreview));
    }
    setDrag(null);
    setDrawPreview(null);
  }

  function onBoxKeyDown(event: KeyboardEvent<HTMLDivElement>, box: RegionBox) {
    if (!box.region) return;
    const step = event.shiftKey ? KEY_STEP * 4 : KEY_STEP;
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step]
    };
    const move = delta[event.key];
    if (!move) return;
    event.preventDefault();
    props.onChange(
      box.id,
      applyDrag({ mode: "move", id: box.id, start: { x: 0, y: 0 }, origin: box.region }, move[0], move[1])
    );
  }

  if (!props.imageUrl) {
    return <div className="ui-viewer-placeholder">{props.emptyText ?? "표시할 페이지가 없습니다."}</div>;
  }

  return (
    <div
      ref={canvasRef}
      className={["ui-multi-region-canvas", props.drawId ? "drawing" : "", props.className ?? ""]
        .filter(Boolean)
        .join(" ")}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <img src={props.imageUrl} alt={props.imageAlt} draggable={false} />
      {props.overlay}
      {props.boxes.map((box) => {
        if (!box.region) return null;
        const selected = box.id === props.selectedId;
        const style = {
          "--region-color": box.color,
          left: `${box.region.x * 100}%`,
          top: `${box.region.y * 100}%`,
          width: `${box.region.width * 100}%`,
          height: `${box.region.height * 100}%`
        } as CSSProperties;
        return (
          <div
            key={box.id}
            className={selected ? "ui-multi-region-box selected" : "ui-multi-region-box"}
            style={style}
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            aria-label={`${box.label} 영역`}
            data-region-id={box.id}
            onPointerDown={(event) => beginBoxDrag(event, box, "move")}
            onKeyDown={(event) => onBoxKeyDown(event, box)}
            onFocus={() => props.onSelect(box.id)}
          >
            <span className="ui-multi-region-label">{box.label}</span>
            {selected &&
              HANDLES.map((handle) => (
                <span
                  key={handle}
                  className={`ui-multi-region-handle ${handle}`}
                  aria-hidden
                  onPointerDown={(event) => beginBoxDrag(event, box, handle)}
                />
              ))}
          </div>
        );
      })}
      {drawPreview && drag?.mode === "draw" && (
        <div
          className="ui-multi-region-box drawing-preview"
          style={
            {
              "--region-color": props.boxes.find((box) => box.id === drag.id)?.color ?? "var(--color-accent)",
              left: `${drawPreview.x * 100}%`,
              top: `${drawPreview.y * 100}%`,
              width: `${drawPreview.width * 100}%`,
              height: `${drawPreview.height * 100}%`
            } as CSSProperties
          }
        />
      )}
    </div>
  );
}
