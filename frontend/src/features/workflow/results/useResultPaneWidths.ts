// 결과 창 3열(목록 | 미리보기 | 결과)의 좌우 너비. 드래그로 바꾸고 localStorage에 남긴다.
import { useCallback, useMemo, useState, type CSSProperties, type PointerEvent } from "react";
import { createStoredNumber } from "../../../lib/storage";

const MIN_LEFT_WIDTH = 220;
const MIN_MIDDLE_WIDTH = 420;
const MIN_RIGHT_WIDTH = 300;
const SPLITTER_WIDTH = 12;

const leftWidthStore = createStoredNumber("digitize_workflow_result_left_width_v1", 280, 1);
const rightWidthStore = createStoredNumber("digitize_workflow_result_right_width_v1", 420, 1);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function useResultPaneWidths() {
  const [leftWidth, setLeftWidth] = useState(() => leftWidthStore.read());
  const [rightWidth, setRightWidth] = useState(() => rightWidthStore.read());

  const startResize = useCallback(
    (event: PointerEvent<HTMLButtonElement>, side: "left" | "right") => {
      event.preventDefault();
      const container = event.currentTarget.closest<HTMLElement>(".workflow-run-workbench-resizable");
      if (!container) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      const update = (clientX: number) => {
        const rect = container.getBoundingClientRect();
        if (side === "left") {
          const maxLeft = Math.max(MIN_LEFT_WIDTH, rect.width - rightWidth - MIN_MIDDLE_WIDTH - SPLITTER_WIDTH * 2);
          const next = clamp(clientX - rect.left, MIN_LEFT_WIDTH, maxLeft);
          setLeftWidth(next);
          leftWidthStore.write(Math.round(next));
        } else {
          const maxRight = Math.max(MIN_RIGHT_WIDTH, rect.width - leftWidth - MIN_MIDDLE_WIDTH - SPLITTER_WIDTH * 2);
          const next = clamp(rect.right - clientX, MIN_RIGHT_WIDTH, maxRight);
          setRightWidth(next);
          rightWidthStore.write(Math.round(next));
        }
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
    [leftWidth, rightWidth]
  );

  // 인라인 grid-template-columns는 CSS 미디어 쿼리(<1100px 세로 쌓기)를 이기므로 CSS 변수로 넘긴다.
  // 좌우 열은 저장한 너비가 상한이고, 창이 좁으면 최소 너비까지 줄어든다(가운데는 MIN_MIDDLE_WIDTH 유지).
  const workbenchStyle = useMemo<CSSProperties>(
    () =>
      ({
        "--wf-result-columns": `minmax(${MIN_LEFT_WIDTH}px, ${Math.max(MIN_LEFT_WIDTH, leftWidth)}px) ${SPLITTER_WIDTH}px minmax(${MIN_MIDDLE_WIDTH}px, 1fr) ${SPLITTER_WIDTH}px minmax(${MIN_RIGHT_WIDTH}px, ${Math.max(MIN_RIGHT_WIDTH, rightWidth)}px)`
      }) as CSSProperties,
    [leftWidth, rightWidth]
  );

  return { workbenchStyle, startResize };
}
