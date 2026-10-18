import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { newId } from "../services/storage";
import { cn } from "../utils/cn";

type ToastTone = "success" | "error" | "warning" | "info";

interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  message?: string;
}

interface ToastContextValue {
  notify: (toast: Omit<Toast, "id">) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const icons: Record<ToastTone, ReactNode> = {
  success: <CheckCircle2 className="size-4 text-forest-600" />,
  error: <XCircle className="size-4 text-danger-600" />,
  warning: <AlertTriangle className="size-4 text-soil-600" />,
  info: <Info className="size-4 text-chain-600" />,
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => setToasts((all) => all.filter((t) => t.id !== id)), []);

  const notify = useCallback(
    (toast: Omit<Toast, "id">) => {
      const id = newId();
      setToasts((all) => [...all.slice(-3), { ...toast, id }]);
      setTimeout(() => dismiss(id), toast.tone === "error" ? 8000 : 5000);
    },
    [dismiss],
  );

  const value = useMemo(() => ({ notify }), [notify]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex animate-fade-in gap-3 rounded-lg border bg-surface px-4 py-3 shadow-[var(--shadow-pop)]",
              t.tone === "error" ? "border-danger-100" : t.tone === "warning" ? "border-soil-100" : "border-line",
            )}
          >
            <div className="mt-0.5">{icons[t.tone]}</div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-ink">{t.title}</p>
              {t.message && <p className="mt-0.5 text-[13px] break-words text-ink-muted">{t.message}</p>}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} aria-label="Dismiss" className="self-start rounded p-0.5 text-ink-faint hover:text-ink">
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside ToastProvider");
  return ctx;
}
