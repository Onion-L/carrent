import { useEffect } from "react";

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
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
        className="relative w-full max-w-lg rounded-lg border border-border bg-surface-raised p-8 shadow-xl"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-md text-muted hover:bg-surface-hover hover:text-fg"
          onClick={onCancel}
          type="button"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="2"
            viewBox="0 0 16 16"
          >
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        <h2 className="pr-8 text-app-18 font-semibold" id="confirm-dialog-title">
          {title}
        </h2>
        <p className="mt-4 text-app-14 leading-6 text-muted">{message}</p>
        <div className="mt-10 flex justify-end gap-3">
          <button
            className="h-10 rounded-md px-4 text-app-14 font-medium text-muted hover:bg-surface-hover hover:text-fg"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-10 rounded-md bg-danger/15 px-4 text-app-14 font-medium text-danger hover:bg-danger/25 disabled:opacity-50"
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
