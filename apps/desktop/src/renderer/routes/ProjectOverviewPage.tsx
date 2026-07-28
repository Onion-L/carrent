import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { useAppState } from "../context/AppStateContext";
import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { EmptyThreadPrompt } from "../components/chat/MessageTimeline";
import type { AssociationThreadDraftRecord } from "../../shared/workspacePersistence";
import { ProjectDirectoryUnavailable } from "../components/workspace/ProjectDirectoryUnavailable";
import { useChatRun } from "../hooks/useChatRun";

export function ProjectOverviewPage() {
  const { workspaceId, projectId } = useParams();
  const navigate = useNavigate();
  const {
    workspaces,
    projects,
    associations,
    threads,
    threadDrafts,
    activeWorkspaceId,
    selectWorkspace,
    projectDirectoryStatusById,
    openThreadDraft,
    updateThreadDraft,
    updateThreadDraftConfig,
    prepareThreadDraftPromotion,
    rollbackThreadDraftPromotion,
  } = useAppState();
  const { runningThreadIds } = useChatRun();
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const project = projects.find((item) => item.id === projectId);
  const association = associations.find(
    (item) => item.workspaceId === workspaceId && item.projectId === projectId,
  );
  const [openDraft, setOpenDraft] = useState<AssociationThreadDraftRecord | null>(null);
  useEffect(() => {
    if (
      !workspaceId ||
      !projectId ||
      !association ||
      openDraft ||
      projectDirectoryStatusById[projectId] === "unavailable"
    ) {
      return;
    }

    const existingDraft = threadDrafts.find(
      (draft) => draft.workspaceId === workspaceId && draft.projectId === projectId,
    );
    if (existingDraft) {
      setOpenDraft(existingDraft);
      return;
    }

    let cancelled = false;
    void openThreadDraft(workspaceId, projectId).then((draft) => {
      if (!cancelled && draft) setOpenDraft(draft);
    });

    return () => {
      cancelled = true;
    };
  }, [
    association,
    openDraft,
    openThreadDraft,
    projectId,
    projectDirectoryStatusById,
    threadDrafts,
    workspaceId,
  ]);
  useEffect(() => {
    if (!workspace || workspace.id === activeWorkspaceId) return;
    void selectWorkspace(workspace.id);
  }, [activeWorkspaceId, selectWorkspace, workspace]);

  if (!workspace) return <Navigate replace to="/" />;
  if (!project || !association) return <Navigate replace to={`/workspace/${workspace.id}`} />;

  const displayName = association.alias ?? project.name;
  if (projectDirectoryStatusById[project.id] === "unavailable") {
    return (
      <ProjectDirectoryUnavailable
        project={project}
        breadcrumb={`${workspace.name} / ${displayName}`}
        hasLiveRun={threads.some(
          (thread) => thread.projectId === project.id && runningThreadIds.includes(thread.id),
        )}
      />
    );
  }
  if (openDraft) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatHeader title="New thread" />
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <div className="flex w-full max-w-[56rem] flex-col items-center gap-6">
            <EmptyThreadPrompt projectName={displayName} />
            <Composer
              key={openDraft.id}
              mode="association-draft"
              placement="centered"
              workspaceId={workspace.id}
              projectId={project.id}
              projectName={project.name}
              projectPath={project.workingDirectory}
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
    <div className="flex min-h-0 flex-1 flex-col">
      <ChatHeader title="New thread" />
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
        <EmptyThreadPrompt projectName={displayName} />
      </div>
    </div>
  );
}
