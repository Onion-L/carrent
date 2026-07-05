import { AlertCircle, CheckCircle2, Info, X } from "lucide-react";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useRef,
  useEffect,
  type ReactNode,
} from "react";

export type Toast = {
  id: string;
  message: string;
  type?: "success" | "error" | "info";
};

export type ToastContextValue = {
  showToast: (message: string, type?: Toast["type"]) => void;
};

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

const AUTO_DISMISS_MS = 3000;
const TRANSITION_DURATION_MS = 300;

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [exiting, setExiting] = useState(false);
  const autoDismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exitRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const enterTimeout = setTimeout(() => setVisible(true), 10);
    autoDismissRef.current = setTimeout(() => setExiting(true), AUTO_DISMISS_MS);

    return () => {
      clearTimeout(enterTimeout);
      if (autoDismissRef.current) {
        clearTimeout(autoDismissRef.current);
      }
      if (exitRef.current) {
        clearTimeout(exitRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (exiting) {
      exitRef.current = setTimeout(() => onRemove(toast.id), TRANSITION_DURATION_MS);
      return () => {
        if (exitRef.current) {
          clearTimeout(exitRef.current);
        }
      };
    }
  }, [exiting, onRemove, toast.id]);

  const handleDismiss = () => {
    if (autoDismissRef.current) {
      clearTimeout(autoDismissRef.current);
    }
    setExiting(true);
  };

  const Icon =
    toast.type === "error" ? AlertCircle : toast.type === "success" ? CheckCircle2 : Info;
  const iconClassName =
    toast.type === "error"
      ? "text-danger"
      : toast.type === "success"
        ? "text-fg"
        : "text-muted";

  return (
    <div
      className={`pointer-events-auto flex w-[calc(100vw-2rem)] max-w-[34rem] items-start gap-3 rounded-lg border border-border-strong bg-surface-raised px-3.5 py-3 text-[13px] leading-5 text-fg shadow-xl transition-all duration-300 ease-out ${
        visible && !exiting
          ? "opacity-100 translate-y-0 scale-100"
          : "opacity-0 -translate-y-3 scale-95"
      }`}
      role={toast.type === "error" ? "alert" : "status"}
      aria-live={toast.type === "error" ? "assertive" : "polite"}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconClassName}`} />
      <span className="min-w-0 flex-1 break-words">{toast.message}</span>
      <button
        onClick={handleDismiss}
        className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
        aria-label="Dismiss toast"
        title="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type?: Toast["type"]) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const toast: Toast = { id, message, type };
    setToasts((prev) => [...prev, toast]);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center justify-start gap-2 p-4">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onRemove={removeToast} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
