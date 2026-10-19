import { useEffect, useRef, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// 열린 trap 스택. 겹친 대화상자에서는 맨 위 것만 Esc·Tab을 처리한다.
const trapStack: symbol[] = [];

/** 이 trap이 가장 위(마지막에 열린) 대화상자인지. */
function isTopTrap(id: symbol) {
  return trapStack[trapStack.length - 1] === id;
}

/**
 * 열려 있는 동안 Tab 포커스를 컨테이너 안에 가두고, Esc로 onEscape를 부른다.
 * 닫히면 열기 전 포커스로 돌려준다.
 */
export function useFocusTrap(active: boolean, containerRef: RefObject<HTMLElement | null>, onEscape?: () => void) {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!active) return;
    const trapId = Symbol("focus-trap");
    trapStack.push(trapId);
    const previous = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const first = container?.querySelector<HTMLElement>("[data-autofocus]") ?? container?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? container)?.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (!containerRef.current || !isTopTrap(trapId)) return;
      if (event.key === "Escape" && onEscapeRef.current) {
        event.stopPropagation();
        onEscapeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => item.offsetParent !== null || item === document.activeElement
      );
      if (!items.length) return;
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const index = trapStack.indexOf(trapId);
      if (index >= 0) trapStack.splice(index, 1);
      previous?.focus?.({ preventScroll: true });
    };
  }, [active, containerRef]);
}
