import { useAppState } from "../../context/AppStateContext";
import { useNavigate } from "react-router-dom";
import { AddProjectButton } from "./AddProjectButton";

export function WorkspaceNavigationPane() {
  const navigate = useNavigate();
  const { workspaces, projects, associations, activeWorkspaceId } = useAppState();
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId);
  const workspaceProjects = associations
    .filter((association) => association.workspaceId === activeWorkspaceId)
    .sort((left, right) => left.order - right.order)
    .flatMap((association) => {
      const project = projects.find((item) => item.id === association.projectId);
      return project ? [{ association, project }] : [];
    });

  return (
    <aside className="flex h-full min-h-0 flex-col border-r border-border bg-sidebar px-3 py-3">
      <h2 className="truncate text-app-13 font-semibold text-fg">{workspace?.name}</h2>
      <div className="mt-3 min-h-0 flex-1 space-y-1 overflow-y-auto">
        {workspaceProjects.map(({ association, project }) => (
          <button
            key={project.id}
            onClick={() => navigate(`/workspace/${association.workspaceId}/project/${project.id}`)}
            className="flex min-h-8 w-full items-center rounded-md px-2 text-left text-app-12 font-medium text-muted hover:bg-surface-hover hover:text-fg"
          >
            <span className="truncate">{association.alias ?? project.name}</span>
          </button>
        ))}
        {workspaceProjects.length === 0 && (
          <p className="px-2 py-1 text-app-12 text-subtle">No Projects</p>
        )}
      </div>
      {workspace && <AddProjectButton compact workspaceId={workspace.id} />}
    </aside>
  );
}
