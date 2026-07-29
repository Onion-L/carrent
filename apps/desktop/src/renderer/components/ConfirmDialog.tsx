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
        className="w-full max-w-sm rounded-md border border-border bg-surface-raised p-5 shadow-xl"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-app-16 font-semibold" id="confirm-dialog-title">
          {title}
        </h2>
        <p className="mt-3 text-app-13 leading-5 text-muted">{message}</p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            className="h-9 rounded-md border border-border px-3 text-app-13 font-medium hover:bg-surface-hover"
            onClick={onCancel}
            type="button"
          >
            Cancel
          </button>
          <button
            className="h-9 rounded-md bg-danger px-3 text-app-13 font-medium text-white disabled:opacity-50"
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
