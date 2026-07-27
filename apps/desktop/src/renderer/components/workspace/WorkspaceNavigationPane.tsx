import { useAppState } from "../../context/AppStateContext";
import { ArrowDown, ArrowUp } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { AddProjectButton } from "./AddProjectButton";
import { getWorkspaceProjects } from "../../lib/workspaceProjects";

export function WorkspaceNavigationPane() {
  const navigate = useNavigate();
  const { workspaces, projects, associations, activeWorkspaceId, moveAssociation } = useAppState();
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const workspaceProjects = getWorkspaceProjects(projects, associations, activeWorkspaceId);

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-sidebar px-3 py-3">
      <h2 className="truncate text-app-13 font-semibold text-fg">{workspace?.name}</h2>
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {workspaceProjects.map(({ association, project }, index) => (
          <div
            key={project.id}
            className="flex min-h-8 items-center gap-1 rounded-md hover:bg-surface-hover"
          >
            <button
              onClick={() =>
                navigate(`/workspace/${association.workspaceId}/project/${project.id}`)
              }
              className="min-w-0 flex-1 px-2 text-left text-app-12 font-medium text-muted hover:text-fg"
            >
              <span className="block truncate">{association.alias ?? project.name}</span>
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
        ))}
        {workspaceProjects.length === 0 && (
          <p className="px-2 py-1 text-app-12 text-subtle">No Projects</p>
        )}
      </div>
      {workspace && <AddProjectButton compact workspaceId={workspace.id} />}
    </aside>
  );
}
