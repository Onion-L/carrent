import { useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

import { useAppState } from "../context/AppStateContext";
import { runtimeIds, runtimeNameMap, type RuntimeId } from "../../shared/runtimes";
import { type RuntimeMode } from "../../shared/runtimeMode";

export function ProjectOverviewPage() {
  const { workspaceId, projectId } = useParams();
  const {
    workspaces,
    projects,
    associations,
    activeWorkspaceId,
    selectWorkspace,
    setProjectAlias,
    renameSharedProject,
    setAssociationDefaults,
  } = useAppState();
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const project = projects.find((item) => item.id === projectId);
  const association = associations.find(
    (item) => item.workspaceId === workspaceId && item.projectId === projectId,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  useEffect(() => {
    if (!workspace || workspace.id === activeWorkspaceId) return;
    void selectWorkspace(workspace.id);
  }, [activeWorkspaceId, selectWorkspace, workspace]);

  if (!workspace) return <Navigate replace to="/" />;
  if (!project || !association) return <Navigate replace to={`/workspace/${workspace.id}`} />;

  const displayName = association.alias ?? project.name;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-7">
      <div className="border-b border-border pb-5">
        <p className="text-app-12 text-subtle">{workspace.name}</p>
        <h1 className="mt-1 text-app-22 font-semibold text-fg">{displayName}</h1>
        <p className="mt-2 break-all text-app-12 text-muted">{project.workingDirectory}</p>
      </div>

      <div className="grid max-w-2xl gap-8 py-7">
        {saveError && <p className="text-app-12 text-danger">{saveError}</p>}
        <section>
          <h2 className="text-app-14 font-semibold text-fg">Workspace alias</h2>
          <form
            className="mt-3 flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              setSaveError(null);
              const data = new FormData(event.currentTarget);
              const saved = await setProjectAlias(
                workspace.id,
                project.id,
                String(data.get("projectAlias") ?? ""),
              );
              if (!saved) setSaveError("Project settings could not be saved.");
            }}
          >
            <input
              name="projectAlias"
              aria-label="Project alias"
              defaultValue={association.alias ?? ""}
              className="min-h-9 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-app-13 text-fg outline-none focus:border-fg/50"
            />
            <button
              type="submit"
              className="min-h-9 rounded-md border border-border-strong px-3 text-app-12 font-medium text-fg hover:bg-surface-hover"
            >
              Save Alias
            </button>
          </form>
        </section>

        <section>
          <h2 className="text-app-14 font-semibold text-fg">Shared Project name</h2>
          <p className="mt-1 text-app-12 text-muted">
            Renaming this Project affects every associated Workspace.
          </p>
          <form
            className="mt-3 flex gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              setSaveError(null);
              const data = new FormData(event.currentTarget);
              const saved = await renameSharedProject(
                project.id,
                String(data.get("sharedProjectName") ?? ""),
              );
              if (!saved) setSaveError("Project settings could not be saved.");
            }}
          >
            <input
              name="sharedProjectName"
              aria-label="Shared Project name"
              defaultValue={project.name}
              className="min-h-9 min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-app-13 text-fg outline-none focus:border-fg/50"
            />
            <button
              type="submit"
              className="min-h-9 rounded-md border border-border-strong px-3 text-app-12 font-medium text-fg hover:bg-surface-hover"
            >
              Save Shared Name
            </button>
          </form>
        </section>

        <section>
          <h2 className="text-app-14 font-semibold text-fg">New Thread defaults</h2>
          <form
            className="mt-3"
            onSubmit={async (event) => {
              event.preventDefault();
              setSaveError(null);
              const data = new FormData(event.currentTarget);
              const saved = await setAssociationDefaults(workspace.id, project.id, {
                runtimeId: String(data.get("defaultRuntimeId")) as RuntimeId,
                runtimeModelId: String(data.get("defaultRuntimeModelId") ?? ""),
                runtimeMode: String(data.get("defaultRuntimeMode")) as RuntimeMode,
              });
              if (!saved) setSaveError("Project settings could not be saved.");
            }}
          >
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-app-12 text-muted">
                Runtime
                <select
                  name="defaultRuntimeId"
                  defaultValue={association.defaultRuntimeId}
                  className="min-h-9 rounded-md border border-border-strong bg-surface px-3 text-app-13 text-fg"
                >
                  {runtimeIds.map((id) => (
                    <option key={id} value={id}>
                      {runtimeNameMap[id]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-app-12 text-muted">
                Model
                <input
                  name="defaultRuntimeModelId"
                  defaultValue={association.defaultRuntimeModelId ?? ""}
                  placeholder="Runtime default"
                  className="min-h-9 rounded-md border border-border-strong bg-surface px-3 text-app-13 text-fg outline-none focus:border-fg/50"
                />
              </label>
              <label className="col-span-2 grid gap-1 text-app-12 text-muted">
                Run mode
                <select
                  name="defaultRuntimeMode"
                  defaultValue={association.defaultRuntimeMode}
                  className="min-h-9 rounded-md border border-border-strong bg-surface px-3 text-app-13 text-fg"
                >
                  <option value="approval-required">Approval required</option>
                  <option value="auto-accept-edits">Auto-accept edits</option>
                  <option value="full-access">Full access</option>
                </select>
              </label>
            </div>
            <button
              type="submit"
              className="mt-3 min-h-9 rounded-md bg-fg px-4 text-app-12 font-semibold text-bg hover:opacity-90"
            >
              Save Thread Defaults
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
