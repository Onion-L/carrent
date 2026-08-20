import { FolderOpen, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { validateNewProjectName } from "../../../shared/emptyProject";
import { useNewProjectBase } from "../../hooks/useNewProjectBase";

/**
 * Asks for a Project name and shows the full path of the empty directory that
 * will be created. The base defaults to the configured New Project location
 * (itself defaulting to ~/CarrentProjects); "Choose Folder..." sets a
 * per-creation override. Nothing is created until submit.
 */
export function CreateEmptyProjectDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string, baseDirectory?: string) => Promise<string | null>;
}) {
  const { resolveBase } = useNewProjectBase();
  const [name, setName] = useState("");
  const [baseOverride, setBaseOverride] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const effectiveBase = resolveBase(baseOverride);
  const trimmedName = name.trim();
  const targetPath = useMemo(() => {
    if (!effectiveBase) return null;
    return trimmedName ? `${effectiveBase}/${trimmedName}` : `${effectiveBase}/`;
  }, [effectiveBase, trimmedName]);

  const chooseFolder = async () => {
    const selection = await window.carrent.dialog.openDirectory();
    const directory = selection.filePaths[0];
    if (selection.canceled || !directory) return;
    setBaseOverride(directory);
    setError(null);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-20"
      role="dialog"
      aria-modal="true"
      aria-label="Create Empty Project"
      onMouseDown={(event) => {
        // May be nested inside another modal (Create Workspace); never let the
        // backdrop click close the parent dialog too.
        event.stopPropagation();
        onCancel();
      }}
    >
      <form
        className="w-full max-w-lg rounded-lg border border-border-strong bg-surface p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          const validation = validateNewProjectName(name);
          if (!validation.ok) {
            setError(validation.error);
            return;
          }
          setIsSubmitting(true);
          try {
            setError(await onSubmit(validation.name, baseOverride ?? undefined));
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-app-18 font-semibold text-fg">Create Empty Project</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-5 block text-app-12 font-medium text-muted" htmlFor="project-name">
          Project name
        </label>
        <input
          id="project-name"
          name="projectName"
          autoFocus
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setError(null);
          }}
          className="mt-1.5 h-10 w-full rounded-md border border-border-strong bg-surface-raised px-3 text-app-14 text-fg outline-none transition focus-visible:ring-2 focus-visible:ring-fg/25"
        />

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-app-12 font-medium text-muted">Location</span>
          <button
            type="button"
            onClick={() => void chooseFolder()}
            className="flex min-h-7 items-center gap-1.5 rounded-md border border-border-strong px-2.5 text-app-12 font-medium text-muted transition hover:bg-surface-hover hover:text-fg"
          >
            <FolderOpen className="h-3.5 w-3.5" />
            Choose Folder...
          </button>
        </div>
        <p
          aria-label="Project path"
          className="mt-1.5 truncate rounded-md border border-border bg-bg px-3 py-2 text-app-12 text-subtle"
        >
          {targetPath ?? "…"}
        </p>

        {error && (
          <p role="alert" className="mt-3 text-app-12 text-danger">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-9 rounded-md px-3 text-app-13 font-medium text-muted transition hover:bg-surface-hover hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-9 rounded-md bg-fg px-4 text-app-13 font-medium text-bg transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
