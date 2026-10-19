import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Loader2 } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-outline" | "danger-ghost" | "plain";
export type ButtonSize = "md" | "sm";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** 앞쪽 아이콘. loading이면 스피너로 바뀐다. */
  icon?: ReactNode;
  loading?: boolean;
};

/** 기존 전역 클래스(.primary/.secondary/.compact/...)를 그대로 쓰는 공용 버튼. */
export function buttonClassName(variant: ButtonVariant = "secondary", size: ButtonSize = "md", extra?: string) {
  const variantClass =
    variant === "danger-outline"
      ? "secondary danger-outline"
      : variant === "danger-ghost"
        ? "ui-button-danger-ghost ghost"
        : variant === "plain"
          ? ""
          : `ui-button-${variant} ${variant}`;
  return ["ui-button", variantClass, size === "sm" ? "compact" : "", extra ?? ""].filter(Boolean).join(" ");
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", icon, loading, className, children, type = "button", disabled, ...rest },
  ref
) {
  const iconSize = size === "sm" ? 14 : 16;
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClassName(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 size={iconSize} className="spin" /> : icon}
      {children}
    </button>
  );
});

export type IconButtonProps = Omit<ButtonProps, "children" | "aria-label"> & {
  /** 접근성 이름. 필수. */
  label: string;
  children: ReactNode;
};

/** 아이콘만 있는 버튼. aria-label을 강제한다. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = "secondary", size = "md", className, children, type = "button", title, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={title ?? label}
      className={buttonClassName(variant, size, ["icon-only", className].filter(Boolean).join(" "))}
      {...rest}
    >
      {children}
    </button>
  );
});
