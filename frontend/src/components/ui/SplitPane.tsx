import { GripVertical } from "lucide-react";
import { useCallback, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { createStoredNumber } from "../../lib/storage";

/** 모듈 화면들이 공유하는 좌우 분할 비율(기존 키 유지). */
export const SHARED_SPLIT_STORAGE_KEY = "digitize_left_pane_percent_v1";

const KEYBOARD_STEP = 2;

/**
 * 좌우 분할 비율(%)을 저장·복원하고, 분할 바 드래그·키보드(←/→)를 처리한다.
 * scopeSelector: 비율을 계산할 기준 컨테이너(가장 가까운 조상). 기본 ".resize-scope, .workspace".
 */
export function useSplitPane(
  options: {
    storageKey?: string;
    defaultPercent?: number;
    minPercent?: number;
    maxPercent?: number;
    minLeftPx?: number;
    minRightPx?: number;
    splitterPx?: number;
  } = {}
) {
  const {
    storageKey = SHARED_SPLIT_STORAGE_KEY,
    defaultPercent = 50,
    minPercent = 28,
    maxPercent = 78,
    minLeftPx = 320,
    minRightPx = 380,
    splitterPx = 12
  } = options;
  const [stored] = useState(() => createStoredNumber(storageKey, defaultPercent, Math.min(35, minPercent), maxPercent));
  const [percent, setPercent] = useState(() => stored.read());

  const commit = useCallback(
    (next: number) => {
      setPercent(next);
      stored.write(next);
    },
    [stored]
  );

  const startResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const scope =
        event.currentTarget.closest<HTMLElement>(".resize-scope") ?? event.currentTarget.closest<HTMLElement>(".workspace");
      if (!scope) return;
      const rect = scope.getBoundingClientRect();
      event.currentTarget.setPointerCapture?.(event.pointerId);

      const update = (clientX: number) => {
        const raw = ((clientX - rect.left) / rect.width) * 100;
        const lower = Math.max(minPercent, (minLeftPx / rect.width) * 100);
        const upper = Math.min(maxPercent, ((rect.width - splitterPx - minRightPx) / rect.width) * 100);
        const next = Math.min(Math.max(lower, upper), Math.max(Math.min(lower, upper), raw));
        commit(next);
      };

      update(event.clientX);
      const onMove = (moveEvent: globalThis.PointerEvent) => update(moveEvent.clientX);
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [commit, maxPercent, minLeftPx, minPercent, minRightPx, splitterPx]
  );

  /** 키보드로 비율을 옮긴다(←/→ 2%, Home/End 최소·최대). */
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      let next: number | null = null;
      if (event.key === "ArrowLeft") next = percent - KEYBOARD_STEP;
      else if (event.key === "ArrowRight") next = percent + KEYBOARD_STEP;
      else if (event.key === "Home") next = minPercent;
      else if (event.key === "End") next = maxPercent;
      if (next === null) return;
      event.preventDefault();
      commit(Math.min(maxPercent, Math.max(minPercent, next)));
    },
    [commit, maxPercent, minPercent, percent]
  );

  /** grid-template-columns 값: 왼쪽 % | 분할 바 | 오른쪽 */
  const columns = `minmax(${minLeftPx}px, ${percent}%) ${splitterPx}px minmax(${minRightPx}px, 1fr)`;
  return { percent, columns, startResize, onKeyDown };
}

/** 분할 바 버튼. 드래그와 키보드(←/→)로 너비를 조절한다. */
export function SplitPaneHandle(props: {
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  percent?: number;
}) {
  return (
    <button
      className="splitter ui-split-handle"
      type="button"
      title="영역 너비 조절"
      aria-label="영역 너비 조절"
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={props.percent === undefined ? undefined : Math.round(props.percent)}
      aria-valuemin={0}
      aria-valuemax={100}
      onPointerDown={props.onPointerDown}
      onKeyDown={props.onKeyDown}
    >
      <GripVertical size={18} />
    </button>
  );
}

/**
 * 모듈 본문 좌우 분할(왼쪽 문서 · 오른쪽 정의/결과). 비율은 storageKey로 저장된다.
 * 980px 이하에서는 세로로 쌓인다(CSS).
 */
export function SplitPane(props: {
  left: ReactNode;
  right: ReactNode;
  storageKey?: string;
  defaultPercent?: number;
  minLeftPx?: number;
  minRightPx?: number;
  className?: string;
  leftLabel?: string;
  rightLabel?: string;
}) {
  const split = useSplitPane({
    storageKey: props.storageKey,
    defaultPercent: props.defaultPercent,
    minLeftPx: props.minLeftPx ?? 360,
    minRightPx: props.minRightPx ?? 400
  });
  return (
    <div
      className={["ui-split-pane resize-scope", props.className ?? ""].filter(Boolean).join(" ")}
      style={{ "--split-columns": split.columns } as CSSProperties}
    >
      <section className="ui-split-pane-main" aria-label={props.leftLabel}>
        {props.left}
      </section>
      <SplitPaneHandle onPointerDown={split.startResize} onKeyDown={split.onKeyDown} percent={split.percent} />
      <aside className="ui-split-pane-side" aria-label={props.rightLabel}>
        {props.right}
      </aside>
    </div>
  );
}
