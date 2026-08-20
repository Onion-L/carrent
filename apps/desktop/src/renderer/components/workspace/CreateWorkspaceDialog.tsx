import { Folder, FolderPlus, FolderSearch, X } from "lucide-react";
import { useEffect, useState } from "react";

import { useNewProjectBase } from "../../hooks/useNewProjectBase";
import { CreateEmptyProjectDialog } from "./CreateEmptyProjectDialog";

function getDirectoryName(workingDirectory: string) {
  return workingDirectory.split(/[\\/]/).filter(Boolean).at(-1) ?? workingDirectory;
}

type StagedProject =
  | { kind: "existing"; directory: string }
  | { kind: "empty"; name: string; baseDirectory?: string; targetPath: string };

function getStagedPath(project: StagedProject) {
  return project.kind === "existing" ? project.directory : project.targetPath;
}

export function CreateWorkspaceDialog({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void;
  onSubmit: (name: string, projectDirectories: string[]) => Promise<string | null>;
}) {
  const { resolveBase } = useNewProjectBase();
  const [name, setName] = useState("");
  const [stagedProjects, setStagedProjects] = useState<StagedProject[]>([]);
  const [isStagingEmptyProject, setIsStagingEmptyProject] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // The nested Create Empty Project staging dialog handles Escape itself.
      if (event.key === "Escape" && !isStagingEmptyProject) onCancel();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isStagingEmptyProject, onCancel]);

  const stageProject = (project: StagedProject) => {
    const path = getStagedPath(project);
    setStagedProjects((current) =>
      current.some((item) => getStagedPath(item) === path) ? current : [...current, project],
    );
  };

  const addExistingProject = async () => {
    const selection = await window.carrent.dialog.openDirectory();
    const workingDirectory = selection.filePaths[0];
    if (selection.canceled || !workingDirectory) return;
    stageProject({ kind: "existing", directory: workingDirectory });
  };

  const stageEmptyProject = async (
    projectName: string,
    baseDirectory?: string,
  ): Promise<string | null> => {
    const base = resolveBase(baseDirectory ?? null);
    if (!base) return "New Project location is not available yet. Try again.";
    stageProject({
      kind: "empty",
      name: projectName,
      ...(baseDirectory ? { baseDirectory } : {}),
      targetPath: `${base}/${projectName}`,
    });
    setIsStagingEmptyProject(false);
    return null;
  };

  const removeStagedProject = (path: string) =>
    setStagedProjects((current) => current.filter((project) => getStagedPath(project) !== path));

  const handleSubmit = async (): Promise<string | null> => {
    // Empty Project directories are created only now, on final Create. If
    // anything fails, remove only the directories this run created that are
    // still empty; pre-existing directories are never touched.
    const createdDirectories: string[] = [];
    const rollback = async () => {
      for (const directory of createdDirectories) {
        try {
          await window.carrent.projectDirectories.removeEmpty(directory);
        } catch {
          // Best-effort rollback; a directory that gained content stays.
        }
      }
    };

    for (const project of stagedProjects) {
      if (project.kind !== "empty") continue;
      try {
        const created = await window.carrent.projectDirectories.createEmpty({
          name: project.name,
          ...(project.baseDirectory ? { baseDirectory: project.baseDirectory } : {}),
        });
        createdDirectories.push(created.workingDirectory);
      } catch (createError) {
        await rollback();
        return createError instanceof Error ? createError.message : String(createError);
      }
    }

    const submitError = await onSubmit(name, [
      ...stagedProjects
        .filter((project) => project.kind === "existing")
        .map((project) => project.directory),
      ...createdDirectories,
    ]);
    if (submitError) await rollback();
    return submitError;
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
          setError(await handleSubmit());
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
          className="mt-1.5 h-10 w-full rounded-md border border-border-strong bg-surface-raised px-3 text-app-14 text-fg outline-none transition focus-visible:ring-2 focus-visible:ring-fg/25"
        />

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-app-13 font-medium text-fg">Projects</span>
          <span className="text-app-11 text-subtle">Optional</span>
        </div>
        <div className="mt-2 overflow-hidden rounded-md border border-border-strong bg-bg">
          {stagedProjects.map((project) => {
            const path = getStagedPath(project);
            const projectName =
              project.kind === "empty" ? project.name : getDirectoryName(project.directory);
            return (
              <div
                key={path}
                className="flex min-h-12 items-center gap-3 border-b border-border px-3"
              >
                {project.kind === "empty" ? (
                  <FolderPlus className="h-4 w-4 shrink-0 text-muted" />
                ) : (
                  <Folder className="h-4 w-4 shrink-0 text-muted" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-app-13 font-medium text-fg">{projectName}</p>
                  <p className="truncate text-app-11 text-subtle">{path}</p>
                </div>
                <button
                  type="button"
                  aria-label={`Remove ${projectName}`}
                  title={`Remove ${projectName}`}
                  onClick={() => removeStagedProject(path)}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })}
          <button
            type="button"
            aria-label="Open Existing Project"
            onClick={() => void addExistingProject()}
            className="flex min-h-11 w-full items-center gap-3 border-b border-border px-3 text-left text-app-13 font-medium text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
          >
            <FolderSearch className="h-4 w-4 shrink-0 text-muted" />
            Open Existing Project...
          </button>
          <button
            type="button"
            aria-label="Create Empty Project"
            onClick={() => setIsStagingEmptyProject(true)}
            className="flex min-h-11 w-full items-center gap-3 px-3 text-left text-app-13 font-medium text-fg transition hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-fg/25"
          >
            <FolderPlus className="h-4 w-4 shrink-0 text-muted" />
            Create Empty Project...
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

      {isStagingEmptyProject && (
        <CreateEmptyProjectDialog
          onCancel={() => setIsStagingEmptyProject(false)}
          onSubmit={stageEmptyProject}
        />
      )}
    </div>
  );
}
