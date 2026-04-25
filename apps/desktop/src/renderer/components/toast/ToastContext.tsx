import {
  createContext,
  useContext,
  useState,
  useCallback,
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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type?: Toast["type"]) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
    const toast: Toast = { id, message, type };
    setToasts((prev) => [...prev, toast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="pointer-events-none fixed right-4 top-12 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto flex items-center gap-2 rounded-lg border px-4 py-2.5 text-[13px] shadow-lg transition-all ${
              toast.type === "error"
                ? "border-red-900/40 bg-[#2a1a1a] text-red-300"
                : toast.type === "success"
                  ? "border-emerald-900/40 bg-[#1a2a1a] text-emerald-300"
                  : "border-[#333] bg-[#252525] text-[#ccc]"
            }`}
          >
            {toast.type === "success" && (
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
            )}
            {toast.type === "error" && (
              <span className="h-2 w-2 rounded-full bg-red-400" />
            )}
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
