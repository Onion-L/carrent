import { Folder, FolderPlus, X } from "lucide-react";
import { useEffect, useState } from "react";

function getDirectoryName(workingDirectory: string) {
  return workingDirectory.split(/[\\/]/).filter(Boolean).at(-1) ?? workingDirectory;
}

export function CreateWorkspaceDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string, projectDirectories: string[]) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [projectDirectories, setProjectDirectories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  const addProject = async () => {
    const selection = await window.carrent.dialog.openDirectory();
    const workingDirectory = selection.filePaths[0];
    if (selection.canceled || !workingDirectory) return;
    setProjectDirectories((current) =>
      current.includes(workingDirectory) ? current : [...current, workingDirectory],
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/45 px-4 pt-20"
      role="dialog"
      aria-modal="true"
      aria-label="Create Workspace"
      onMouseDown={onCancel}
    >
      <form
        className="w-full max-w-lg rounded-lg border border-border-strong bg-surface p-5 shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          setError(await onSubmit(name, projectDirectories));
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-app-18 font-semibold text-fg">Create Workspace</h2>
          <button
            type="button"
            onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <label className="mt-5 block text-app-12 font-medium text-muted" htmlFor="workspace-name">
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
          className="mt-1.5 h-10 w-full rounded-md border border-border-strong bg-bg px-3 text-app-14 text-fg outline-none transition focus-visible:ring-2 focus-visible:ring-fg/25"
        />

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-app-13 font-medium text-fg">Projects</span>
          <span className="text-app-11 text-subtle">Optional</span>
        </div>
        <div className="mt-2 overflow-hidden rounded-md border border-border-strong bg-bg">
          {projectDirectories.map((workingDirectory) => {
            const projectName = getDirectoryName(workingDirectory);
            return (
              <div
                key={workingDirectory}
                className="flex min-h-12 items-center gap-3 border-b border-border px-3"
              >
                <Folder className="h-4 w-4 shrink-0 text-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-app-13 font-medium text-fg">{projectName}</p>
                  <p className="truncate text-app-11 text-subtle">{workingDirectory}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${projectName}`}
                  title={`Remove ${projectName}`}
                  onClick={() =>
                    setProjectDirectories((current) =>
                      current.filter((directory) => directory !== workingDirectory),
                    )
                  }
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            aria-label="Add Project"
            onClick={addProject}
            className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-app-13 font-medium text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
          >
            <FolderPlus className="h-4 w-4 shrink-0 text-muted" />
            Add Project
          </button>
        </div>

        {error && <p className="mt-3 text-app-12 text-danger">{error}</p>}

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
            className="min-h-9 rounded-md bg-fg px-4 text-app-13 font-medium text-bg transition hover:opacity-90"
          >
            Create
          </button>
        </div>
      </form>
    </div>
  );
}
