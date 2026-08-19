import { FolderPlus, FolderSearch, Plus } from "lucide-react";
import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppState } from "../../context/AppStateContext";
import { ContextMenuShell, MenuItem } from "./ContextMenu";
import { CreateEmptyProjectDialog } from "./CreateEmptyProjectDialog";

export function AddProjectButton({
  workspaceId,
  iconOnly = false,
}: {
  workspaceId: string;
  iconOnly?: boolean;
}) {
  const navigate = useNavigate();
  const { addProject } = useAppState();
  const [error, setError] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
  const [isCreatingEmpty, setIsCreatingEmpty] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const openMenu = () => {
    setError(null);
    const rect = triggerRef.current?.getBoundingClientRect();
    setMenuAnchor({ x: rect?.left ?? 0, y: (rect?.bottom ?? 0) + 4 });
  };

  const handleOpenExisting = async () => {
    const selection = await window.carrent.dialog.openDirectory();
    const workingDirectory = selection.filePaths[0];
    if (selection.canceled || !workingDirectory) return;

    const result = await addProject(workspaceId, workingDirectory);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    navigate(`/workspace/${workspaceId}/project/${result.project.id}`);
  };

  const handleCreateEmpty = async (
    name: string,
    baseDirectory?: string,
  ): Promise<string | null> => {
    let workingDirectory: string;
    try {
      const created = await window.carrent.projectDirectories.createEmpty({
        name,
        ...(baseDirectory ? { baseDirectory } : {}),
      });
      workingDirectory = created.workingDirectory;
    } catch (createError) {
      return createError instanceof Error ? createError.message : String(createError);
    }

    const result = await addProject(workspaceId, workingDirectory);
    if (!result.ok) {
      // The directory was created but Project state could not be persisted.
      // Keep it on disk and tell the user where it is so it can be imported.
      return (
        `${result.error} The empty directory was kept at ${workingDirectory}; ` +
        "you can add it later with Open Existing Project."
      );
    }
    setIsCreatingEmpty(false);
    navigate(`/workspace/${workspaceId}/project/${result.project.id}`);
    return null;
  };

  return (
    <div className={iconOnly ? "relative shrink-0" : "flex flex-col items-center"}>
      <button
        ref={triggerRef}
        aria-label="Add Project"
        title="Add Project"
        aria-haspopup="menu"
        aria-expanded={menuAnchor !== null}
        onClick={openMenu}
        className={
          iconOnly
            ? "flex h-7 w-7 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg active:scale-95"
            : "flex min-h-9 items-center gap-2 rounded-md bg-fg px-4 text-app-13 font-semibold text-bg hover:opacity-90"
        }
      >
        {iconOnly ? (
          <Plus className="h-4 w-4" />
        ) : (
          <>
            <FolderPlus className="h-4 w-4 shrink-0" />
            <span>Add Project</span>
          </>
        )}
      </button>
      {menuAnchor && (
        <ContextMenuShell anchor={menuAnchor} onClose={() => setMenuAnchor(null)}>
          <div
            role="menu"
            aria-label="Add Project"
            className="w-56 rounded-lg border border-border-strong bg-surface p-1 shadow-xl"
          >
            <MenuItem
              icon={<FolderSearch className="h-4 w-4 shrink-0 text-muted" />}
              label="Open Existing Project..."
              onClick={() => {
                setMenuAnchor(null);
                void handleOpenExisting();
              }}
            />
            <MenuItem
              icon={<FolderPlus className="h-4 w-4 shrink-0 text-muted" />}
              label="Create Empty Project..."
              onClick={() => {
                setMenuAnchor(null);
                setIsCreatingEmpty(true);
              }}
            />
          </div>
        </ContextMenuShell>
      )}
      {isCreatingEmpty && (
        <CreateEmptyProjectDialog
          onCancel={() => setIsCreatingEmpty(false)}
          onSubmit={handleCreateEmpty}
        />
      )}
      {error && (
        <p
          role="alert"
          className={
            iconOnly
              ? "absolute right-0 top-8 z-20 w-56 rounded-lg border border-border-strong bg-surface px-3 py-2 text-app-12 text-danger shadow-xl"
              : "mt-2 text-app-12 text-danger"
          }
        >
          {error}
        </p>
      )}
    </div>
  );
}
