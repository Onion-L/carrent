import { X } from "lucide-react";
import { useEffect, useState } from "react";

export function WorkspaceNameDialog({
  title,
  submitLabel,
  initialValue = "",
  onCancel,
  onSubmit,
}: {
  title: string;
  submitLabel: string;
  initialValue?: string;
  onCancel: () => void;
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState(initialValue);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-24"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={onCancel}
    >
      <form
        className="w-full max-w-sm rounded-lg border border-border-strong bg-surface p-4 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setError(await onSubmit(name));
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-app-14 font-semibold text-fg">{title}</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-surface-hover hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-4 block text-app-12 font-medium text-muted" htmlFor="workspace-name">
          Workspace name
        </label>
        <input
          id="workspace-name"
          name="workspaceName"
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          className="mt-1.5 w-full rounded-md border border-border-strong bg-bg px-3 py-2 text-app-13 text-fg outline-none focus-visible:ring-2 focus-visible:ring-fg/25"
        />
        {error && <p className="mt-2 text-app-12 text-danger">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-8 rounded-md px-3 text-app-12 font-medium text-muted hover:bg-surface-hover hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="min-h-8 rounded-md bg-fg px-3 text-app-12 font-medium text-bg hover:opacity-90"
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
