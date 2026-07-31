import { useState } from "react";

import { useAppState } from "../context/AppStateContext";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { WorkspaceNameDialog } from "../components/workspace/WorkspaceNameDialog";
import { useDeleteWorkspace } from "./useDeleteWorkspace";

// Shared rename/delete dialog flow for Workspace surfaces (rail, switcher).
// `requestRename`/`requestDelete` open the matching dialog; render `dialogs`
// once alongside the trigger UI.
export function useWorkspaceActionDialogs() {
  const { workspaces, threads, renameWorkspace } = useAppState();
  const deleteWorkspaceWithNavigation = useDeleteWorkspace();
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const renamingWorkspace = renamingWorkspaceId
    ? (workspaces.find((workspace) => workspace.id === renamingWorkspaceId) ?? null)
    : null;
  const confirmingDeleteWorkspace = confirmingDeleteId
    ? (workspaces.find((workspace) => workspace.id === confirmingDeleteId) ?? null)
    : null;
  const confirmingDeleteThreadCount = confirmingDeleteWorkspace
    ? threads.filter((thread) => thread.workspaceId === confirmingDeleteWorkspace.id).length
    : 0;

  const handleDeleteConfirm = (workspaceId: string) => {
    setConfirmingDeleteId(null);
    void deleteWorkspaceWithNavigation(workspaceId).then((deleted) => {
      if (!deleted) setConfirmingDeleteId(workspaceId);
    });
  };

  const dialogs = (
    <>
      {renamingWorkspace && (
        <WorkspaceNameDialog
          title="Rename Workspace"
          submitLabel="Rename"
          initialValue={renamingWorkspace.name}
          onCancel={() => setRenamingWorkspaceId(null)}
          onSubmit={async (name) => {
            const result = await renameWorkspace(renamingWorkspace.id, name);
            if (!result.ok) return result.error;
            setRenamingWorkspaceId(null);
            return null;
          }}
        />
      )}

      {confirmingDeleteWorkspace && (
        <ConfirmDialog
          title="Delete Workspace?"
          message={`Delete "${confirmingDeleteWorkspace.name}" and permanently delete ${confirmingDeleteThreadCount} ${confirmingDeleteThreadCount === 1 ? "Thread" : "Threads"}?`}
          confirmLabel="Delete"
          onCancel={() => setConfirmingDeleteId(null)}
          onConfirm={() => handleDeleteConfirm(confirmingDeleteWorkspace.id)}
        />
      )}
    </>
  );

  return {
    requestRename: setRenamingWorkspaceId,
    requestDelete: setConfirmingDeleteId,
    dialogs,
  };
}
