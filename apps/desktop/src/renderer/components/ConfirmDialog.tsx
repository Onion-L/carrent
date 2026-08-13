import { useEffect, type ReactNode } from "react";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
  children,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
      onMouseDown={onCancel}
    >
      <section
        aria-labelledby="confirm-dialog-title"
        aria-modal="true"
        className="relative w-full max-w-md rounded-lg border border-border bg-surface-raised p-4 shadow-xl"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Close"
          className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
          onClick={onCancel}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 16 16"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        <h2 className="pr-7 text-app-16 font-semibold" id="confirm-dialog-title">
          {title}
        </h2>
        <p className="mt-2 text-app-13 leading-6 text-muted">{message}</p>
        {children}
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="h-8 rounded-md px-3 text-app-13 font-medium text-muted hover:bg-surface-hover hover:text-fg"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-8 rounded-md bg-danger/15 px-3 text-app-13 font-medium text-danger hover:bg-danger/25 disabled:opacity-50"
            onClick={onConfirm}
            type="button"
          >
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
