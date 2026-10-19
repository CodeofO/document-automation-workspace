import { X } from "lucide-react";
import { createContext, useCallback, useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button, IconButton } from "./Button";
import { useFocusTrap } from "./useFocusTrap";

export type DialogSize = "sm" | "md" | "lg";

/**
 * 모달 대화상자. focus trap, Esc 닫기, 백드롭 클릭 닫기(dismissible일 때).
 * 기존 .modal-backdrop/.modal-panel 스타일을 그대로 쓴다.
 */
export function Dialog(props: {
  open: boolean;
  title: ReactNode;
  eyebrow?: ReactNode;
  size?: DialogSize;
  onClose: () => void;
  /** 백드롭 클릭으로 닫을지. 기본 false (입력 중 실수로 닫히지 않게). */
  dismissOnBackdrop?: boolean;
  closeLabel?: string;
  className?: string;
  footer?: ReactNode;
  children?: ReactNode;
}) {
  const panelRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  useFocusTrap(props.open, panelRef, props.onClose);
  if (!props.open) return null;
  return createPortal(
    <div
      className="modal-backdrop ui-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (props.dismissOnBackdrop && event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        ref={panelRef}
        className={["modal-panel ui-dialog", `ui-dialog-${props.size ?? "md"}`, props.className ?? ""].join(" ")}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            {props.eyebrow && <p className="eyebrow">{props.eyebrow}</p>}
            <h2 id={titleId}>{props.title}</h2>
          </div>
          <IconButton label={props.closeLabel ?? "닫기"} size="sm" onClick={props.onClose}>
            <X size={16} />
          </IconButton>
        </div>
        {props.children}
        {props.footer && <div className="ui-dialog-footer">{props.footer}</div>}
      </section>
    </div>,
    document.body
  );
}

type ConfirmOptions = {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type PromptOptions = {
  title: string;
  message?: ReactNode;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
};

type PendingRequest =
  | { kind: "confirm"; options: ConfirmOptions; resolve: (value: boolean) => void }
  | { kind: "prompt"; options: PromptOptions; resolve: (value: string | null) => void };

type DialogApi = {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogApi | null>(null);

/** window.confirm / window.prompt를 대체하는 Promise 기반 대화상자. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingRequest | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ kind: "confirm", options, resolve })),
    []
  );
  const prompt = useCallback(
    (options: PromptOptions) =>
      new Promise<string | null>((resolve) => {
        setPromptValue(options.defaultValue ?? "");
        setPending({ kind: "prompt", options, resolve });
      }),
    []
  );
  const api = useMemo(() => ({ confirm, prompt }), [confirm, prompt]);

  const settle = (accepted: boolean) => {
    if (!pending) return;
    if (pending.kind === "confirm") pending.resolve(accepted);
    else pending.resolve(accepted ? promptValue : null);
    setPending(null);
  };

  return (
    <DialogContext.Provider value={api}>
      {children}
      {pending && (
        <Dialog
          open
          size="sm"
          title={pending.options.title}
          onClose={() => settle(false)}
          footer={
            <>
              <Button size="sm" onClick={() => settle(false)}>
                {(pending.kind === "confirm" && pending.options.cancelLabel) || "취소"}
              </Button>
              <Button
                size="sm"
                variant={pending.kind === "confirm" && pending.options.tone === "danger" ? "danger" : "primary"}
                data-autofocus={pending.kind === "confirm" ? true : undefined}
                onClick={() => settle(true)}
              >
                {pending.options.confirmLabel ?? "확인"}
              </Button>
            </>
          }
        >
          {pending.options.message && <div className="ui-dialog-message">{pending.options.message}</div>}
          {pending.kind === "prompt" && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                settle(true);
              }}
            >
              <label className="ui-dialog-field">
                {pending.options.label && <span>{pending.options.label}</span>}
                <input
                  data-autofocus
                  value={promptValue}
                  placeholder={pending.options.placeholder}
                  onChange={(event) => setPromptValue(event.target.value)}
                />
              </label>
            </form>
          )}
        </Dialog>
      )}
    </DialogContext.Provider>
  );
}

function useDialogApi(): DialogApi {
  const api = useContext(DialogContext);
  if (!api) throw new Error("DialogProvider가 필요합니다.");
  return api;
}

export function useConfirm() {
  return useDialogApi().confirm;
}

export function usePrompt() {
  return useDialogApi().prompt;
}
