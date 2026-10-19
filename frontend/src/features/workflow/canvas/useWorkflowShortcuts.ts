// 워크플로우 화면 단축키.
// - Esc: 선택 해제(Drawer가 열려 있으면 Drawer가 먼저 Esc를 받아 닫힌다 — useFocusTrap)
// - Delete/Backspace: React Flow deleteKeyCode가 처리한다(입력 중에는 React Flow가 무시)
// - ⌘/Ctrl+D 복제, ⌘/Ctrl+S 저장, ⌘/Ctrl+\ 오른쪽 패널 접기/펴기, F fitView, Enter 에셋 편집 열기
// 입력란·버튼에 포커스가 있거나 대화상자가 열려 있으면 글자 단축키는 쓰지 않는다. ⌘S·⌘\는 입력 중에도 동작한다.
import { useEffect, useRef } from "react";

export type WorkflowShortcutHandlers = {
  /** 모달(Drawer·AI 초안 대화상자)이 열려 있으면 true. 이때는 ⌘S 말고는 아무것도 하지 않는다. */
  modalOpen: boolean;
  onEscape: () => void;
  onDuplicate: () => void;
  onSave: () => void;
  onTogglePanel: () => void;
  onFitView: () => void;
  /** 처리했으면 true. */
  onEnter: () => boolean;
};

export function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isInteractiveTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest("button, a[href], [role='menuitem'], [role='tab']"));
}

export function useWorkflowShortcuts(handlers: WorkflowShortcutHandlers) {
  const ref = useRef(handlers);
  useEffect(() => {
    ref.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const current = ref.current;
      if (event.defaultPrevented || event.isComposing) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (mod && key === "s") {
        event.preventDefault();
        current.onSave();
        return;
      }
      if (current.modalOpen) return;
      if (mod && (event.key === "\\" || event.code === "Backslash")) {
        event.preventDefault();
        current.onTogglePanel();
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (mod && key === "d") {
        event.preventDefault();
        current.onDuplicate();
        return;
      }
      if (mod || event.altKey) return;
      if (event.key === "Escape") {
        current.onEscape();
        return;
      }
      if (isInteractiveTarget(event.target)) return;
      if (key === "f") {
        event.preventDefault();
        current.onFitView();
        return;
      }
      if (event.key === "Enter" && current.onEnter()) {
        // Drawer가 열리며 포커스가 Drawer 안 버튼으로 옮겨진다. 같은 Enter의 기본 동작(버튼 클릭)이 Drawer를 바로 닫지 않게 막는다.
        event.preventDefault();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
