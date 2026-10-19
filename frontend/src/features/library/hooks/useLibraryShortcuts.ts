import { useEffect, type RefObject } from "react";
import { isEditableShortcutTarget } from "../model";
import { useLatestRef } from "./useLatestRef";

export type LibraryShortcutHandlers = {
  hasSelection: boolean;
  hasClipboard: boolean;
  selectAll: () => void;
  clearSelection: () => void;
  copy: () => void;
  cut: () => void;
  paste: () => void;
  remove: () => void;
};

/**
 * 보관함 단축키: ⌘/Ctrl+A 전체 선택, Esc 선택 해제, ⌘/Ctrl+C·X·V 복사·이동·붙여넣기, Delete/Backspace 삭제.
 * 입력 중이거나, 보관함 바깥의 다른 대화상자(삭제 확인 등)에 포커스가 있으면 무시한다.
 */
export function useLibraryShortcuts(containerRef: RefObject<HTMLElement | null>, handlers: LibraryShortcutHandlers) {
  const latest = useLatestRef(handlers);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isEditableShortcutTarget(event.target)) return;
      if (isInForeignDialog(event.target, containerRef.current)) return;
      const current = latest.current;
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modifier && key === "a") {
        event.preventDefault();
        current.selectAll();
      } else if (!modifier && event.key === "Escape" && current.hasSelection) {
        event.preventDefault();
        current.clearSelection();
      } else if (modifier && key === "c" && current.hasSelection) {
        event.preventDefault();
        current.copy();
      } else if (modifier && key === "x" && current.hasSelection) {
        event.preventDefault();
        current.cut();
      } else if (modifier && key === "v" && current.hasClipboard) {
        event.preventDefault();
        current.paste();
      } else if (!modifier && (event.key === "Delete" || event.key === "Backspace") && current.hasSelection) {
        event.preventDefault();
        current.remove();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [containerRef, latest]);
}

function isInForeignDialog(target: EventTarget | null, container: HTMLElement | null): boolean {
  if (!(target instanceof Element)) return false;
  const dialog = target.closest('[role="dialog"]');
  return Boolean(dialog && !(container && dialog.contains(container)));
}
