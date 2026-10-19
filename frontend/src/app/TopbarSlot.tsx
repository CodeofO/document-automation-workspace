import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** 상단바 안에 화면별 요소(예: KIE 단계 표시)를 끼워 넣는 자리. */
export const TopbarSlotContext = createContext<HTMLElement | null>(null);

export function TopbarSlot({ children }: { children: ReactNode }) {
  const target = useContext(TopbarSlotContext);
  return target ? createPortal(children, target) : null;
}
