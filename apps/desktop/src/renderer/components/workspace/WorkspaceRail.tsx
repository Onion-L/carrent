import { Plus, Settings } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { useAppState } from "../../context/AppStateContext";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { buildWorkspacePath, getWorkspaceRestorePath } from "../../lib/navigation";

export function WorkspaceRail() {
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
  const isSettingsRoute = location.pathname === "/settings";
  const settingsReturnLocation =
    location.pathname === "/settings" &&
    location.state &&
    typeof location.state === "object" &&
    "settingsReturnLocation" in location.state
      ? (location.state.settingsReturnLocation as {
          pathname?: unknown;
          search?: unknown;
          state?: unknown;
        })
      : null;

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
            // Settings is its own primary-navigation destination; the stored
            // active Workspace is only restore context, not the current page.
            const active = !isSettingsRoute && workspace.id === activeWorkspaceId;
            return (
              <button
                key={workspace.id}
                aria-label={workspace.name}
                aria-current={active ? "page" : undefined}
                title={workspace.name}
                onClick={async () => {
                  if (
                    (await selectWorkspace(workspace.id)) ||
                    (location.pathname === "/settings" && workspace.id === activeWorkspaceId)
                  ) {
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
          aria-current={isSettingsRoute ? "page" : undefined}
          title="Settings"
          onClick={() => {
            if (
              location.pathname === "/settings" &&
              typeof settingsReturnLocation?.pathname === "string"
            ) {
              navigate(
                `${settingsReturnLocation.pathname}${typeof settingsReturnLocation.search === "string" ? settingsReturnLocation.search : ""}`,
                { state: settingsReturnLocation.state },
              );
              return;
            }
            if (location.pathname === "/settings") {
              navigate(
                activeWorkspaceId
                  ? getWorkspaceRestorePath(activeWorkspaceId, threads, lastThreadIdByWorkspace)
                  : "/",
              );
              return;
            }
            navigate("/settings", {
              state: {
                settingsReturnLocation: {
                  pathname: location.pathname,
                  search: location.search,
                  state: location.state,
                },
              },
            });
          }}
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-md transition ${
            isSettingsRoute
              ? "bg-surface-hover text-fg"
              : "text-subtle hover:bg-surface-hover hover:text-fg"
          }`}
        >
          <Settings className="h-4 w-4" />
        </button>
      </aside>

      {isCreating && (
        <CreateWorkspaceDialog
          onCancel={() => setIsCreating(false)}
          onSubmit={async (name, projectDirectories) => {
            const result = await createWorkspace(name, projectDirectories);
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
