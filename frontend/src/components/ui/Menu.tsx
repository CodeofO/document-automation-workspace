import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { buttonClassName, type ButtonSize, type ButtonVariant } from "./Button";

/**
 * 드롭다운 열림 상태. 바깥 클릭·Esc로 닫는다.
 * (기존 useUploadPickerMenu / useModuleUploadMenu / useWorkflowUploadMenu 3벌을 대체)
 */
export function useMenu<T extends HTMLElement = HTMLDivElement>(options: { fixed?: boolean; placement?: "left" | "right" } = {}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>(undefined);
  const ref = useRef<T | null>(null);
  const { fixed = false, placement = "left" } = options;

  // overflow:hidden 컨테이너 안에서도 보이도록 fixed 위치를 계산한다(워크플로우 화면).
  const updatePosition = useCallback(() => {
    if (!fixed) return;
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const top = Math.round(rect.bottom + 6);
    setMenuStyle(
      placement === "right"
        ? { top, right: Math.max(8, Math.round(window.innerWidth - rect.right)) }
        : { top, left: Math.max(8, Math.round(rect.left)) }
    );
  }, [fixed, placement]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    if (fixed) {
      window.addEventListener("resize", updatePosition);
      window.addEventListener("scroll", updatePosition, true);
    }
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, fixed, updatePosition]);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    updatePosition();
    setOpen((current) => !current);
  }, [updatePosition]);
  return { open, setOpen, ref, close, toggle, menuStyle, fixed };
}

/** 메뉴 안에서 방향키로 항목을 옮긴다. */
function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
  );
  if (!items.length) return;
  event.preventDefault();
  const index = items.findIndex((item) => item === document.activeElement || item.contains(document.activeElement));
  const nextIndex = event.key === "ArrowDown" ? (index + 1) % items.length : (index - 1 + items.length) % items.length;
  const next = items[nextIndex];
  (next.querySelector<HTMLElement>("input") ?? next).focus();
}

export function MenuList(props: {
  align?: "left" | "right";
  className?: string;
  children: ReactNode;
  label?: string;
  fixed?: boolean;
  style?: CSSProperties;
}) {
  return (
    <div
      className={[
        "workflow-upload-menu",
        props.align === "right" ? "workflow-upload-menu-right" : "",
        props.fixed ? "workflow-upload-menu-fixed" : "",
        props.className ?? ""
      ]
        .filter(Boolean)
        .join(" ")}
      style={props.style}
      role="menu"
      aria-label={props.label}
      onKeyDown={onMenuKeyDown}
    >
      {props.children}
    </div>
  );
}

export function MenuItem(props: {
  onSelect?: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  href?: string;
}) {
  if (props.href) {
    return (
      <a
        className="workflow-upload-menu-item"
        role="menuitem"
        href={props.href}
        target="_blank"
        rel="noreferrer"
        onClick={props.onSelect}
      >
        {props.icon} {props.children}
      </a>
    );
  }
  return (
    <button
      type="button"
      className="workflow-upload-menu-item"
      role="menuitem"
      disabled={props.disabled}
      aria-disabled={props.disabled || undefined}
      onClick={props.onSelect}
    >
      {props.icon} {props.children}
    </button>
  );
}

/** 트리거 버튼 + 메뉴. children은 메뉴가 열렸을 때만 그린다. close를 받아 항목에서 닫을 수 있다. */
export function MenuButton(props: {
  label: ReactNode;
  icon?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  triggerClassName?: string;
  align?: "left" | "right";
  disabled?: boolean;
  showCaret?: boolean;
  ariaLabel?: string;
  title?: string;
  fixed?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const { open, ref, toggle, close, menuStyle, fixed } = useMenu({ fixed: props.fixed, placement: props.align });
  return (
    <div className={["workflow-upload-picker unified-upload-picker", props.className ?? ""].join(" ")} ref={ref}>
      <button
        type="button"
        className={props.triggerClassName ?? buttonClassName(props.variant ?? "secondary", props.size ?? "md")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.ariaLabel}
        title={props.title}
        disabled={props.disabled}
        onClick={toggle}
      >
        {props.icon}
        {props.label}
        {props.showCaret && <ChevronDown size={14} />}
      </button>
      {open && !props.disabled && (
        <MenuList align={props.align} fixed={fixed} style={menuStyle}>
          {props.children(close)}
        </MenuList>
      )}
    </div>
  );
}

/** 주 동작 + 보조 메뉴(▾)로 된 분할 버튼. */
export function SplitButton(props: {
  label: ReactNode;
  icon?: ReactNode;
  onClick: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  menuLabel: string;
  align?: "left" | "right";
  children: (close: () => void) => ReactNode;
}) {
  const { open, ref, toggle, close } = useMenu();
  return (
    <div className="workflow-upload-picker ui-split-button" ref={ref}>
      <button
        type="button"
        className={buttonClassName(props.variant ?? "primary", props.size ?? "md")}
        disabled={props.disabled}
        onClick={props.onClick}
      >
        {props.icon}
        {props.label}
      </button>
      <button
        type="button"
        className={buttonClassName(props.variant ?? "primary", props.size ?? "md", "ui-split-button-caret")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={props.menuLabel}
        disabled={props.disabled}
        onClick={toggle}
      >
        <ChevronDown size={14} />
      </button>
      {open && !props.disabled && <MenuList align={props.align}>{props.children(close)}</MenuList>}
    </div>
  );
}
