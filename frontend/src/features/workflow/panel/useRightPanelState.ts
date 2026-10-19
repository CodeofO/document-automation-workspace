// 워크플로우 화면 오른쪽 패널(속성 | 실행)의 탭·접힘·너비. localStorage에 남긴다.
// 패널 열은 항상 있다: 선택이 바뀌어도 열리고 닫히지 않으며, 사용자가 접을 때만 40px 레일이 된다.
import { useCallback, useState, type PointerEvent } from "react";
import { createStoredValue } from "../../../lib/storage";

export type RightPanelTab = "inspect" | "runs";
export type RightPanelState = { tab: RightPanelTab; collapsed: boolean; width: number };

export const RIGHT_PANEL_MIN_WIDTH = 320;
export const RIGHT_PANEL_MAX_WIDTH = 560;
export const RIGHT_PANEL_DEFAULT_WIDTH = 360;
export const RIGHT_PANEL_RAIL_WIDTH = 40;

export function clampRightPanelWidth(width: number) {
  return Math.round(Math.min(RIGHT_PANEL_MAX_WIDTH, Math.max(RIGHT_PANEL_MIN_WIDTH, width)));
}

export function parseRightPanelState(raw: unknown): RightPanelState | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Partial<RightPanelState>;
  return {
    tab: value.tab === "runs" ? "runs" : "inspect",
    collapsed: value.collapsed === true,
    width: clampRightPanelWidth(typeof value.width === "number" && Number.isFinite(value.width) ? value.width : RIGHT_PANEL_DEFAULT_WIDTH)
  };
}

const rightPanelStore = createStoredValue<RightPanelState>({
  key: "digitize_workflow_right_panel_v1",
  parse: parseRightPanelState,
  fallback: { tab: "inspect", collapsed: false, width: RIGHT_PANEL_DEFAULT_WIDTH }
});

export function useRightPanelState() {
  const [state, setState] = useState<RightPanelState>(() => rightPanelStore.read());

  const update = useCallback((patch: Partial<RightPanelState>) => {
    setState((current) => {
      const next = { ...current, ...patch, width: clampRightPanelWidth(patch.width ?? current.width) };
      rightPanelStore.write(next);
      return next;
    });
  }, []);

  /** 탭을 열고 패널을 편다(레일 아이콘·검증 바 클릭). */
  const showTab = useCallback((tab: RightPanelTab) => update({ tab, collapsed: false }), [update]);
  const toggleCollapsed = useCallback(() => {
    setState((current) => {
      const next = { ...current, collapsed: !current.collapsed };
      rightPanelStore.write(next);
      return next;
    });
  }, []);

  /** 왼쪽 가장자리 손잡이를 끌어 너비를 바꾼다. 끝날 때 한 번 저장한다. */
  const startResize = useCallback(
    (event: PointerEvent<HTMLElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = state.width;
      let latest = startWidth;
      const onMove = (moveEvent: globalThis.PointerEvent) => {
        latest = clampRightPanelWidth(startWidth + startX - moveEvent.clientX);
        setState((current) => ({ ...current, width: latest }));
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        update({ width: latest });
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [state.width, update]
  );

  /** 키보드로 너비 조절(←/→ 16px). */
  const nudgeWidth = useCallback((delta: number) => update({ width: state.width + delta }), [state.width, update]);

  return { ...state, update, showTab, toggleCollapsed, startResize, nudgeWidth };
}

export type RightPanelController = ReturnType<typeof useRightPanelState>;
