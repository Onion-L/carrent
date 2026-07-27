import { CircleAlert, Plus, Settings } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAppState } from "../../context/AppStateContext";
import { WorkspaceNameDialog } from "./WorkspaceNameDialog";
import { buildWorkspacePath, getWorkspaceRestorePath } from "../../lib/navigation";
import { getAttentionViewState } from "./AttentionPane";

export function WorkspaceRail({ attentionCount }: { attentionCount: number }) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    workspaces,
    threads,
    lastThreadIdByWorkspace,
    activeWorkspaceId,
    createWorkspace,
    selectWorkspace,
  } = useAppState();
  const [isCreating, setIsCreating] = useState(false);

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col items-center bg-sidebar px-1.5 py-1">
        <button
          aria-label="Attention"
          aria-pressed={getAttentionViewState(location.state) !== null}
          title="Attention"
          onClick={() => {
            if (getAttentionViewState(location.state)) return;
            navigate(`${location.pathname}${location.search}`, {
              state: {
                ...(location.state && typeof location.state === "object" ? location.state : {}),
                attentionView: { scrollTop: 0, selectedThreadId: null, groups: null },
              },
            });
          }}
          className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-subtle transition hover:bg-surface-hover hover:text-fg"
        >
          <CircleAlert className="h-4 w-4" />
          <span className="absolute right-0.5 top-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 text-white">
            {attentionCount}
          </span>
        </button>

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
                  if (await selectWorkspace(workspace.id)) {
                    navigate(
                      getWorkspaceRestorePath(workspace.id, threads, lastThreadIdByWorkspace),
                    );
                  }
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
            navigate(buildWorkspacePath(result.workspace.id));
            return null;
          }}
        />
      )}
    </>
  );
}
