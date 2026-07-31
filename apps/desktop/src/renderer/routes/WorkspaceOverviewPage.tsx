import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { WorkspaceNameDialog } from "../components/workspace/WorkspaceNameDialog";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { AddProjectButton } from "../components/workspace/AddProjectButton";
import { useAppState } from "../context/AppStateContext";
import { useNavigate } from "react-router-dom";
import { getWorkspaceProjects } from "../lib/workspaceProjects";
import {
  getWorkspaceDeleteBlockedReason,
  useDeleteWorkspace,
} from "../hooks/useDeleteWorkspace";
import { useChatRun } from "../hooks/useChatRun";

export function WorkspaceOverviewPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const { activeWorkspaceId, workspaces, projects, associations, threads, renameWorkspace, selectWorkspace } =
    useAppState();
  const { runningThreadIds } = useChatRun();
  const deleteWorkspaceWithNavigation = useDeleteWorkspace();
  const [isRenaming, setIsRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const workspaceProjects = getWorkspaceProjects(projects, associations, workspaceId);
  const deleteBlockedReason = workspace
    ? getWorkspaceDeleteBlockedReason(threads, runningThreadIds, workspace.id)
    : null;

  useEffect(() => {
    if (!workspace || workspace.id === activeWorkspaceId) return;
    void selectWorkspace(workspace.id).catch((error) => {
      console.error("[app-state] failed to select Workspace", error);
    });
  }, [activeWorkspaceId, selectWorkspace, workspace]);

  if (!workspace) return <Navigate replace to="/" />;

  const threadCount = threads.filter((thread) => thread.workspaceId === workspace.id).length;

  const handleDeleteWorkspace = async () => {
    setConfirmingDelete(false);
    const deleted = await deleteWorkspaceWithNavigation(workspace.id);
    if (!deleted) setConfirmingDelete(true);
  };

  return (
    <>
      <div className="flex h-full flex-col px-8 py-7">
        <div className="flex items-center justify-between gap-4 border-b border-border pb-5">
          <h1 className="min-w-0 truncate text-app-22 font-semibold text-fg">{workspace.name}</h1>
          <div className="flex shrink-0 gap-2">
            <button
              onClick={() => setIsRenaming(true)}
              className="min-h-8 rounded-md border border-border-strong px-3 text-app-12 font-medium text-muted hover:bg-surface-hover hover:text-fg"
            >
              Rename Workspace
            </button>
            <button
              type="button"
              disabled={deleteBlockedReason !== null}
              title={deleteBlockedReason ?? undefined}
              onClick={() => setConfirmingDelete(true)}
              className="min-h-8 rounded-md border border-danger/50 px-3 text-app-12 font-medium text-danger hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Delete Workspace
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
          {workspaceProjects.length === 0 ? (
            <>
              <p className="text-app-14 font-medium text-muted">
                This Workspace has no Projects yet.
              </p>
              <p className="mt-2 text-app-12 text-subtle">
                Carrent never moves or copies the selected directory.
              </p>
              <div className="mt-5">
                <AddProjectButton workspaceId={workspace.id} />
              </div>
            </>
          ) : (
            <div className="w-full max-w-xl text-left">
              <div className="divide-y divide-border border-y border-border">
                {workspaceProjects.map(({ project, association }) => (
                  <button
                    key={project.id}
                    onClick={() => navigate(`/workspace/${workspace.id}/project/${project.id}`)}
                    className="flex min-h-14 w-full items-center justify-between gap-4 px-2 text-left hover:bg-surface-hover"
                  >
                    <span className="truncate text-app-13 font-medium text-fg">
                      {association.alias ?? project.name}
                    </span>
                    <span className="truncate text-app-12 text-subtle">
                      {project.workingDirectory}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-4 flex justify-center">
                <AddProjectButton workspaceId={workspace.id} />
              </div>
            </div>
          )}
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

      {confirmingDelete && (
        <ConfirmDialog
          title="Delete Workspace?"
          message={`Delete "${workspace.name}" and permanently delete ${threadCount} ${threadCount === 1 ? "Thread" : "Threads"}?`}
          confirmLabel="Delete"
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => void handleDeleteWorkspace()}
        />
      )}
    </>
  );
}
