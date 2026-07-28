import { FolderPlus, Plus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppState } from "../../context/AppStateContext";

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

  const handleAdd = async () => {
    setError(null);
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

  return (
    <div className={iconOnly ? "relative shrink-0" : "flex flex-col items-center"}>
      <button
        aria-label="Add Project"
        title="Add Project"
        onClick={handleAdd}
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
