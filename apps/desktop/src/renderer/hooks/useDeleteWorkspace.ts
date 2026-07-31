import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import type { AppThreadRecord } from "../../shared/workspacePersistence";
import { useAppState } from "../context/AppStateContext";
import { useThreadContent } from "../context/ThreadContentContext";
import { useToast } from "../components/toast/ToastContext";

export function getWorkspaceDeleteBlockedReason(
  threads: AppThreadRecord[],
  runningThreadIds: string[],
  workspaceId: string,
): string | null {
  return threads.some(
    (thread) => thread.workspaceId === workspaceId && runningThreadIds.includes(thread.id),
  )
    ? "Stop the affected live Run before deleting"
    : null;
}

// Compares path segments exactly so a Workspace id that prefixes another
// ("abc" vs "abc-def") cannot trigger a false match.
export function isWorkspaceRoutePath(pathname: string, workspaceId: string): boolean {
  const workspaceRoute = `/workspace/${workspaceId}`;
  return pathname === workspaceRoute || pathname.startsWith(`${workspaceRoute}/`);
}

// Deletes a Workspace and, when the deleted Workspace is on screen, navigates
// to the next one. Returns whether the deletion committed so callers can
// reopen their confirm dialog on failure.
export function useDeleteWorkspace() {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaces, deleteWorkspace, setDeletionNavigation } = useAppState();
  const { deleteThreads } = useThreadContent();
  const { showToast } = useToast();

  return useCallback(
    async (workspaceId: string): Promise<boolean> => {
      const workspace = workspaces.find((item) => item.id === workspaceId);
      if (!workspace) return false;
      const orderedWorkspaces = [...workspaces].sort((left, right) => left.order - right.order);
      const workspaceIndex = orderedWorkspaces.findIndex((item) => item.id === workspace.id);
      const nextWorkspace =
        orderedWorkspaces[workspaceIndex + 1] ?? orderedWorkspaces[workspaceIndex - 1] ?? null;
      // Deleting the Workspace on screen briefly leaves this route stale; the
      // route guard would otherwise report it as missing. This flow navigates
      // itself once the deletion commits.
      const viewingDeleted = isWorkspaceRoutePath(location.pathname, workspace.id);
      if (viewingDeleted) setDeletionNavigation({ sourcePath: location.pathname });
      let deleted = false;
      let deletionError: string | null = null;
      try {
        deleted = await deleteWorkspace(workspace.id, (threadIds, snapshots) =>
          deleteThreads(threadIds, snapshots),
        );
      } catch (error) {
        console.error("[workspaces] deletion rollback failed", error);
        deletionError = error instanceof Error ? error.message : String(error);
      }
      if (!deleted) {
        if (viewingDeleted) setDeletionNavigation(null);
        showToast(
          deletionError
            ? `Workspace could not be deleted: ${deletionError}`
            : "Workspace could not be deleted.",
          "error",
        );
        return false;
      }
      showToast(`Workspace "${workspace.name}" deleted.`, "success");
      if (viewingDeleted) {
        navigate(nextWorkspace ? `/workspace/${nextWorkspace.id}` : "/");
      }
      return true;
    },
    [
      workspaces,
      deleteWorkspace,
      setDeletionNavigation,
      deleteThreads,
      showToast,
      location.pathname,
      navigate,
    ],
  );
}
