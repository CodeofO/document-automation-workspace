// 결과 칸을 누르면 뜨는 작은 창: 원문·신뢰도·flags + 값 수정.
import { Check, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "../../../components/ui";
import { formatConfidence } from "../../../lib/format";
import { CELL_FLAG_LABELS, cellEditText, confidenceTone } from "../model/results";
import type { TableCell } from "../types";

const WIDTH = 300;

export function CellPopover(props: {
  anchor: DOMRect;
  column: string;
  rowLabel: string;
  cell: TableCell | undefined;
  /** 서버 값(저장 전 수정과 비교해 같으면 수정을 지운다) */
  originalText: string;
  editable: boolean;
  onApply: (value: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState(() => cellEditText(props.cell));
  const [position, setPosition] = useState<{ left: number; top: number }>({
    left: props.anchor.left,
    top: props.anchor.bottom + 6
  });
  const { onClose } = props;

  useLayoutEffect(() => {
    const height = panelRef.current?.offsetHeight ?? 220;
    const left = Math.max(8, Math.min(props.anchor.left, window.innerWidth - WIDTH - 8));
    const below = props.anchor.bottom + 6;
    const top = below + height > window.innerHeight - 8 ? Math.max(8, props.anchor.top - height - 6) : below;
    setPosition({ left, top });
  }, [props.anchor]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const onDown = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [onClose]);

  const cell = props.cell;
  const tone = confidenceTone(cell?.confidence);
  const flags = (cell?.flags ?? []).filter((flag) => flag !== "pending");

  return createPortal(
    <div
      ref={panelRef}
      className="table-cell-popover"
      role="dialog"
      aria-label={`${props.rowLabel} · ${props.column} 칸`}
      style={{ left: position.left, top: position.top, width: WIDTH }}
    >
      <header>
        <div>
          <p className="eyebrow">{props.rowLabel}</p>
          <strong>{props.column}</strong>
        </div>
        <IconButton label="닫기" size="sm" variant="ghost" onClick={props.onClose}>
          <X size={14} />
        </IconButton>
      </header>
      <dl className="table-cell-facts">
        <div>
          <dt>원문</dt>
          <dd>{cell?.raw ?? <span className="muted">(없음)</span>}</dd>
        </div>
        <div>
          <dt>신뢰도</dt>
          <dd data-tone={tone ?? undefined}>{formatConfidence(cell?.confidence)}</dd>
        </div>
      </dl>
      {flags.length > 0 && (
        <ul className="table-cell-flags" aria-label="flags">
          {flags.map((flag) => (
            <li key={flag} title={flag}>
              {CELL_FLAG_LABELS[flag] ?? flag}
            </li>
          ))}
        </ul>
      )}
      {props.editable ? (
        <form
          className="table-cell-edit"
          onSubmit={(event) => {
            event.preventDefault();
            props.onApply(value);
          }}
        >
          <label className="ui-field">
            <span>값</span>
            <input ref={inputRef} aria-label="칸 값" value={value} onChange={(event) => setValue(event.target.value)} />
          </label>
          <div className="table-cell-edit-actions">
            {value !== props.originalText && (
              <Button size="sm" variant="ghost" onClick={() => setValue(props.originalText)}>
                원래 값
              </Button>
            )}
            <Button size="sm" type="submit" variant="primary" icon={<Check size={14} />}>
              적용
            </Button>
          </div>
        </form>
      ) : null}
    </div>,
    document.body
  );
}
