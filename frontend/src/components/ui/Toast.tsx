import { X } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StatusTone } from "../../lib/status";

export type ToastTone = Extract<StatusTone, "info" | "success" | "warning" | "danger">;

type ToastItem = { id: number; tone: ToastTone; message: ReactNode; durationMs: number };

type ToastApi = {
  show: (message: ReactNode, options?: { tone?: ToastTone; durationMs?: number }) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** 전역 토스트. 화면 우하단에 쌓이고 일정 시간 뒤 사라진다. danger는 기본 8초. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((current) => current.filter((item) => item.id !== id)), []);
  const show = useCallback<ToastApi["show"]>((message, options = {}) => {
    const id = nextId.current++;
    const tone = options.tone ?? "info";
    const durationMs = options.durationMs ?? (tone === "danger" ? 8000 : 4000);
    setItems((current) => [...current.slice(-4), { id, tone, message, durationMs }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="ui-toast-region" role="region" aria-label="알림" aria-live="polite">
        {items.map((item) => (
          <ToastView key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (item.durationMs <= 0) return;
    const timer = window.setTimeout(() => onDismiss(item.id), item.durationMs);
    return () => window.clearTimeout(timer);
  }, [item.durationMs, item.id, onDismiss]);
  return (
    <div className="ui-toast" data-tone={item.tone} role={item.tone === "danger" ? "alert" : "status"}>
      <span>{item.message}</span>
      <button type="button" className="ui-toast-close" aria-label="알림 닫기" onClick={() => onDismiss(item.id)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("ToastProvider가 필요합니다.");
  return api;
}
