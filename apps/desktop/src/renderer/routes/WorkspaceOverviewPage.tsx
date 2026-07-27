import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { WorkspaceNameDialog } from "../components/workspace/WorkspaceNameDialog";
import { useAppState } from "../context/AppStateContext";

export function WorkspaceOverviewPage() {
  const { workspaceId } = useParams();
  const { activeWorkspaceId, workspaces, renameWorkspace, selectWorkspace } = useAppState();
  const [isRenaming, setIsRenaming] = useState(false);
  const workspace = workspaces.find((item) => item.id === workspaceId);

  useEffect(() => {
    if (!workspace || workspace.id === activeWorkspaceId) return;
    void selectWorkspace(workspace.id).catch((error) => {
      console.error("[app-state] failed to select Workspace", error);
    });
  }, [activeWorkspaceId, selectWorkspace, workspace]);

  if (!workspace) return <Navigate replace to="/" />;

  return (
    <>
      <div className="flex h-full flex-col px-8 py-7">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
          <h1 className="min-w-0 truncate text-app-22 font-semibold text-fg">{workspace.name}</h1>
          <button
            onClick={() => setIsRenaming(true)}
            className="min-h-8 shrink-0 rounded-md border border-border-strong px-3 text-app-12 font-medium text-muted hover:bg-surface-hover hover:text-fg"
          >
            Rename Workspace
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
          <p className="text-app-14 font-medium text-muted">This Workspace has no Projects yet.</p>
        </div>
      </div>

      {isRenaming && (
        <WorkspaceNameDialog
          title="Rename Workspace"
          submitLabel="Rename"
          initialValue={workspace.name}
          onCancel={() => setIsRenaming(false)}
          onSubmit={async (name) => {
            const result = await renameWorkspace(workspace.id, name);
            if (!result.ok) return result.error;
            setIsRenaming(false);
            return null;
          }}
        />
      )}
    </>
  );
}
