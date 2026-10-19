import { Save } from "lucide-react";
import { useRef, useState, type PointerEvent } from "react";
import { resolveAssetUrl } from "../../api/client";
import { clamp01 } from "../../lib/format";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";

export type PickerRegion = { id: string; name: string; page: number; x: number; y: number; width: number; height: number };
export type PickerPage = { id: string; page: number; image_url: string };

function round(value: number) {
  return Math.round(clamp01(value) * 10000) / 10000;
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(3) : "-";
}

/**
 * 공용 영역 지정 모달(spec B-5 RegionPicker). 페이지 이미지 위에서 드래그로 상자를 그린다.
 * Schema 필드 영역과 필수항목 영역이 같이 쓴다. 숫자 입력은 호출부의 "고급"에 둔다.
 */
export function RegionPicker(props: {
  pages: PickerPage[];
  region: PickerRegion;
  title?: string;
  onSave: (region: PickerRegion) => void;
  onClose: () => void;
}) {
  const pageCount = Math.max(1, props.pages.length);
  const [pageIndex, setPageIndex] = useState(() => Math.min(pageCount - 1, Math.max(0, props.region.page - 1)));
  const [regionName, setRegionName] = useState(props.region.name);
  const [draft, setDraft] = useState<Omit<PickerRegion, "id" | "name"> | null>(props.region);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const page = props.pages[pageIndex];
  const current = draft ? { ...draft, page: page?.page ?? draft.page } : null;

  function pointFromEvent(event: PointerEvent<HTMLElement>) {
    const rect = imageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return { x: clamp01((event.clientX - rect.left) / rect.width), y: clamp01((event.clientY - rect.top) / rect.height) };
  }

  function updateDraft(start: { x: number; y: number }, point: { x: number; y: number }) {
    setDraft({
      page: page?.page ?? 1,
      x: Math.min(start.x, point.x),
      y: Math.min(start.y, point.y),
      width: Math.max(0.01, Math.abs(point.x - start.x)),
      height: Math.max(0.01, Math.abs(point.y - start.y))
    });
  }

  function save() {
    if (!current) return;
    props.onSave({
      id: props.region.id,
      name: regionName.trim() || props.region.name,
      page: current.page,
      x: round(current.x),
      y: round(current.y),
      width: round(current.width),
      height: round(current.height)
    });
  }

  return (
    <Dialog
      open
      size="lg"
      eyebrow="영역 지정"
      title={props.title ?? (regionName || props.region.name)}
      className="ui-region-picker"
      closeLabel="영역 선택 닫기"
      onClose={props.onClose}
      footer={
        <>
          <Button size="sm" onClick={props.onClose}>
            취소
          </Button>
          <Button size="sm" variant="primary" icon={<Save size={14} />} disabled={!current} onClick={save}>
            영역 저장
          </Button>
        </>
      }
    >
      <div className="ui-region-toolbar">
        <label>
          <span>이름</span>
          <input value={regionName} onChange={(event) => setRegionName(event.target.value)} />
        </label>
        <label>
          <span>페이지</span>
          <select value={pageIndex} onChange={(event) => setPageIndex(Number(event.target.value))}>
            {props.pages.map((item, index) => (
              <option key={item.id} value={index}>
                {item.page}페이지
              </option>
            ))}
          </select>
        </label>
        <div className="ui-region-values" aria-label="영역 좌표">
          <span>x {formatNumber(current?.x)}</span>
          <span>y {formatNumber(current?.y)}</span>
          <span>w {formatNumber(current?.width)}</span>
          <span>h {formatNumber(current?.height)}</span>
        </div>
      </div>
      <p className="ui-region-hint">페이지 위에서 드래그해 영역을 그리세요.</p>
      <div className="ui-region-stage">
        {page ? (
          <div
            className="ui-region-canvas"
            onPointerDown={(event) => {
              const point = pointFromEvent(event);
              if (!point) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragStart(point);
              updateDraft(point, point);
            }}
            onPointerMove={(event) => {
              if (!dragStart) return;
              const point = pointFromEvent(event);
              if (point) updateDraft(dragStart, point);
            }}
            onPointerUp={() => setDragStart(null)}
          >
            <img ref={imageRef} src={resolveAssetUrl(page.image_url)} alt={`${page.page}페이지`} draggable={false} />
            {current && (
              <div
                className="ui-region-box"
                style={{
                  left: `${current.x * 100}%`,
                  top: `${current.y * 100}%`,
                  width: `${current.width * 100}%`,
                  height: `${current.height * 100}%`
                }}
              />
            )}
          </div>
        ) : (
          <div className="ui-viewer-placeholder">문서 이미지가 있어야 영역을 지정할 수 있습니다.</div>
        )}
      </div>
    </Dialog>
  );
}
