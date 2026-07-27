import { FolderPlus } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppState } from "../../context/AppStateContext";

export function AddProjectButton({
  workspaceId,
  compact = false,
}: {
  workspaceId: string;
  compact?: boolean;
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
    <div className={compact ? "" : "flex flex-col items-center"}>
      <button
        aria-label="Add Project"
        onClick={handleAdd}
        className={
          compact
            ? "flex min-h-8 w-full items-center gap-2 rounded-md px-2 text-left text-app-12 font-medium text-muted hover:bg-surface-hover hover:text-fg"
            : "flex min-h-9 items-center gap-2 rounded-md bg-fg px-4 text-app-13 font-semibold text-bg hover:opacity-90"
        }
      >
        <FolderPlus className="h-4 w-4 shrink-0" />
        <span>Add Project</span>
      </button>
      {error && <p className="mt-2 text-app-12 text-danger">{error}</p>}
    </div>
  );
}
