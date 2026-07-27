import { useAppState } from "../../context/AppStateContext";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { AddProjectButton } from "./AddProjectButton";
import { getWorkspaceProjects } from "../../lib/workspaceProjects";
import { buildProjectPath, buildThreadPath, buildWorkspacePath } from "../../lib/navigation";
import { useWorkspace } from "../../context/WorkspaceContext";
import { useChatRun } from "../../hooks/useChatRun";
import { getThreadDisplayStatus, type ThreadDisplayStatus } from "../../lib/projectThreads";
import type { ThreadSearchScope } from "../../../shared/threadSearch";

const STATUS_LABELS: Record<ThreadDisplayStatus, string> = {
  approval: "Approval",
  question: "Question",
  running: "Running",
  failed: "Failed",
};

export function WorkspaceNavigationPane({
  onOpenSearch,
}: {
  onOpenSearch: (scope: ThreadSearchScope) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { workspaces, projects, associations, threads, activeWorkspaceId, moveAssociation } =
    useAppState();
  const { projects: contentProjects, messages } = useWorkspace();
  const { runningThreadIds, pendingPermissions, pendingQuestions } = useChatRun();
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const workspaceProjects = getWorkspaceProjects(projects, associations, activeWorkspaceId);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-sidebar px-3 py-3">
      {workspace && (
        <div className="flex min-h-7 items-center gap-1">
          <button
            type="button"
            onClick={() => navigate(buildWorkspacePath(workspace.id))}
            className="min-w-0 flex-1 truncate text-left text-app-13 font-semibold text-fg hover:text-muted"
          >
            {workspace.name}
          </button>
          <button
            type="button"
            aria-label={`Search ${workspace.name}`}
            title="Search Workspace"
            onClick={() => onOpenSearch({ kind: "workspace", workspaceId: workspace.id })}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-subtle hover:bg-surface-hover hover:text-fg"
          >
            <Search className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
        {workspaceProjects.map(({ association, project }, index) => {
          const projectPath = buildProjectPath(association.workspaceId, project.id);
          const projectThreads = threads
            .filter(
              (thread) =>
                thread.workspaceId === association.workspaceId &&
                thread.projectId === project.id &&
                !thread.archived,
            )
            .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));

          return (
            <section key={project.id}>
              <div className="flex min-h-8 items-center gap-1 rounded-md hover:bg-surface-hover">
                <button
                  onClick={() => navigate(projectPath)}
                  className={`min-w-0 flex-1 px-2 text-left text-app-12 font-medium hover:text-fg ${
                    location.pathname === projectPath ? "text-fg" : "text-muted"
                  }`}
                >
                  <span className="block truncate">{association.alias ?? project.name}</span>
                </button>
                <button
                  aria-label={`Search ${association.alias ?? project.name}`}
                  title="Search Project"
                  onClick={() =>
                    onOpenSearch({
                      kind: "association",
                      workspaceId: association.workspaceId,
                      projectId: project.id,
                    })
                  }
                  className="flex h-7 w-7 items-center justify-center text-subtle hover:text-fg"
                >
                  <Search className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label={`Move ${association.alias ?? project.name} up`}
                  title="Move up"
                  disabled={index === 0}
                  onClick={() => void moveAssociation(association.workspaceId, project.id, "up")}
                  className="flex h-7 w-7 items-center justify-center text-subtle hover:text-fg disabled:opacity-25"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  aria-label={`Move ${association.alias ?? project.name} down`}
                  title="Move down"
                  disabled={index === workspaceProjects.length - 1}
                  onClick={() => void moveAssociation(association.workspaceId, project.id, "down")}
                  className="flex h-7 w-7 items-center justify-center text-subtle hover:text-fg disabled:opacity-25"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="mt-0.5 space-y-0.5 pl-2">
                {projectThreads.map((thread) => {
                  const threadPath = buildThreadPath(
                    association.workspaceId,
                    project.id,
                    thread.id,
                  );
                  const status = getThreadDisplayStatus({
                    threadId: thread.id,
                    runningThreadIds,
                    pendingApprovals: pendingPermissions,
                    pendingQuestions,
                    messages,
                  });
                  const contentThread = contentProjects
                    .flatMap((item) => item.threads)
                    .find((item) => item.id === thread.id);
                  return (
                    <button
                      key={thread.id}
                      type="button"
                      onClick={() => navigate(threadPath)}
                      className={`flex min-h-7 w-full items-center gap-2 rounded-md px-2 text-left text-app-12 hover:bg-surface-hover hover:text-fg ${
                        location.pathname === threadPath
                          ? "bg-surface-hover text-fg"
                          : "text-subtle"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {contentThread?.title ?? thread.title}
                      </span>
                      {status && (
                        <span className="shrink-0 text-app-10 text-subtle">
                          {STATUS_LABELS[status]}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {workspaceProjects.length === 0 && (
          <p className="px-2 py-1 text-app-12 text-subtle">No Projects</p>
        )}
      </div>
      {workspace && <AddProjectButton compact workspaceId={workspace.id} />}
    </aside>
  );
}
