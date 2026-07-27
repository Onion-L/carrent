import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { useAppState } from "../context/AppStateContext";
import { Composer } from "../components/chat/Composer";
import { runtimeIds, runtimeNameMap, type RuntimeId } from "../../shared/runtimes";
import { type RuntimeMode } from "../../shared/runtimeMode";
import type { AssociationThreadDraftRecord } from "../../shared/workspacePersistence";

export function ProjectOverviewPage() {
  const { workspaceId, projectId } = useParams();
  const navigate = useNavigate();
  const {
    workspaces,
    projects,
    associations,
    threadDrafts,
    activeWorkspaceId,
    selectWorkspace,
    setProjectAlias,
    renameSharedProject,
    setAssociationDefaults,
    openThreadDraft,
    updateThreadDraft,
    updateThreadDraftConfig,
    discardThreadDraft,
    prepareThreadDraftPromotion,
    commitThreadDraftPromotion,
    rollbackThreadDraftPromotion,
  } = useAppState();
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const project = projects.find((item) => item.id === projectId);
  const association = associations.find(
    (item) => item.workspaceId === workspaceId && item.projectId === projectId,
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [openDraft, setOpenDraft] = useState<AssociationThreadDraftRecord | null>(null);
  useEffect(() => {
    if (!workspace || workspace.id === activeWorkspaceId) return;
    void selectWorkspace(workspace.id);
  }, [activeWorkspaceId, selectWorkspace, workspace]);

  if (!workspace) return <Navigate replace to="/" />;
  if (!project || !association) return <Navigate replace to={`/workspace/${workspace.id}`} />;

  const displayName = association.alias ?? project.name;
  const existingDraft = threadDrafts.find(
    (draft) => draft.workspaceId === workspace.id && draft.projectId === project.id,
  );
  if (openDraft) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-start justify-between border-b border-border px-8 py-5">
          <div>
            <p className="text-app-12 text-subtle">
              {workspace.name} / {displayName}
            </p>
            <h1 className="mt-1 text-app-18 font-semibold text-fg">Thread Draft</h1>
          </div>
          <button
            type="button"
            onClick={async () => {
              if (await discardThreadDraft(openDraft.id)) setOpenDraft(null);
            }}
            className="min-h-8 rounded-md border border-border-strong px-3 text-app-12 text-muted hover:bg-surface-hover hover:text-fg"
          >
            Discard Draft
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <div className="w-full max-w-[56rem]">
            <Composer
              key={openDraft.id}
              mode="association-draft"
              placement="centered"
              workspaceId={workspace.id}
              projectId={project.id}
              projectName={project.name}
              projectPath={project.workingDirectory}
              draftId={openDraft.id}
              threadId={openDraft.threadId}
              initialDraft={{
                content: openDraft.content,
                attachedSkillNames: openDraft.attachedSkillNames,
                attachments: openDraft.attachments,
              }}
              messages={[]}
              runtimeId={openDraft.runtimeId}
              runtimeModelId={openDraft.runtimeModelId}
              runtimeMode={openDraft.runtimeMode}
              planMode={openDraft.planMode}
              onDraftChange={(draft) => {
                setOpenDraft({
                  ...openDraft,
                  content: draft?.content ?? "",
                  attachedSkillNames: draft?.attachedSkillNames ?? [],
                  attachments: draft?.attachments ?? [],
                });
                void updateThreadDraft(openDraft.id, draft);
              }}
              onRuntimeIdChange={(runtimeId) => {
                setOpenDraft({ ...openDraft, runtimeId, runtimeModelId: undefined });
                void updateThreadDraftConfig(openDraft.id, {
                  runtimeId,
                  runtimeModelId: undefined,
                  runtimeMode: openDraft.runtimeMode,
                  planMode: openDraft.planMode,
                });
              }}
              onRuntimeModelIdChange={(runtimeModelId) => {
                setOpenDraft({ ...openDraft, runtimeModelId });
                void updateThreadDraftConfig(openDraft.id, {
                  runtimeId: openDraft.runtimeId,
                  runtimeModelId,
                  runtimeMode: openDraft.runtimeMode,
                  planMode: openDraft.planMode,
                });
              }}
              onRuntimeModeChange={(runtimeMode) => {
                setOpenDraft({ ...openDraft, runtimeMode });
                void updateThreadDraftConfig(openDraft.id, {
                  runtimeId: openDraft.runtimeId,
                  runtimeModelId: openDraft.runtimeModelId,
                  runtimeMode,
                  planMode: openDraft.planMode,
                });
              }}
              onPlanModeChange={(planMode) => {
                setOpenDraft({ ...openDraft, planMode });
                void updateThreadDraftConfig(openDraft.id, {
                  runtimeId: openDraft.runtimeId,
                  runtimeModelId: openDraft.runtimeModelId,
                  runtimeMode: openDraft.runtimeMode,
                  planMode,
                });
              }}
              onPromote={async (input) =>
                (await prepareThreadDraftPromotion({ draftId: openDraft.id, ...input })) !== null
              }
              onPromotionAccepted={async (runId) =>
                (await commitThreadDraftPromotion(openDraft.id, runId)) !== null
              }
              onPromotionRejected={async (draft) => {
                const restoredDraft = { ...openDraft, ...draft };
                if (await rollbackThreadDraftPromotion(restoredDraft)) {
                  setOpenDraft(restoredDraft);
                }
              }}
              onPromoted={(threadId) =>
                navigate(`/workspace/${workspace.id}/project/${project.id}/thread/${threadId}`)
              }
            />
          </div>
        </div>
      </div>
    );
  }

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
          <h2 className="text-app-14 font-semibold text-fg">Threads</h2>
          <p className="mt-1 text-app-12 text-muted">
            A Thread is created only when its first message is sent.
          </p>
          <button
            type="button"
            onClick={async () => {
              const draft = await openThreadDraft(workspace.id, project.id);
              if (draft) setOpenDraft(draft);
              else setSaveError("Thread Draft could not be saved.");
            }}
            className="mt-3 min-h-9 rounded-md bg-fg px-4 text-app-12 font-semibold text-bg hover:opacity-90"
          >
            {existingDraft ? "Resume Draft" : "New Thread"}
          </button>
        </section>
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
