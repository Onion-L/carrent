import { Plus, Settings } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppState } from "../../context/AppStateContext";
import { WorkspaceNameDialog } from "./WorkspaceNameDialog";

function workspacePath(workspaceId: string) {
  return `/workspace/${workspaceId}`;
}

export function WorkspaceRail() {
  const navigate = useNavigate();
  const { workspaces, activeWorkspaceId, createWorkspace, selectWorkspace } = useAppState();
  const [isCreating, setIsCreating] = useState(false);

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col items-center bg-sidebar px-1.5 py-1">
        <button
          aria-label="Create Workspace"
          title="Create Workspace"
          onClick={() => setIsCreating(true)}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-border bg-bg text-muted transition hover:border-border-strong hover:text-fg"
        >
          <Plus className="h-4 w-4" />
        </button>

        <div className="mt-1 min-h-0 flex-1 space-y-1 overflow-y-auto py-1">
          {workspaces.map((workspace) => {
            const active = workspace.id === activeWorkspaceId;
            return (
              <button
                key={workspace.id}
                aria-label={workspace.name}
                aria-current={active ? "page" : undefined}
                title={workspace.name}
                onClick={async () => {
                  if (await selectWorkspace(workspace.id)) navigate(workspacePath(workspace.id));
                }}
                className={`flex h-11 w-11 items-center justify-center rounded-md border text-app-13 font-semibold transition ${
                  active
                    ? "border-fg/60 bg-surface-hover text-fg"
                    : "border-border bg-bg text-muted hover:border-border-strong hover:text-fg"
                }`}
              >
                {workspace.name.slice(0, 1).toUpperCase()}
              </button>
            );
          })}
        </div>

        <button
          aria-label="Settings"
          title="Settings"
          onClick={() => navigate("/settings")}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
        >
          <Settings className="h-4 w-4" />
        </button>
      </aside>

      {isCreating && (
        <WorkspaceNameDialog
          title="Create Workspace"
          submitLabel="Create"
          onCancel={() => setIsCreating(false)}
          onSubmit={async (name) => {
            const result = await createWorkspace(name);
            if (!result.ok) return result.error;
            setIsCreating(false);
            navigate(workspacePath(result.workspace.id));
            return null;
          }}
        />
      )}
    </>
  );
}
