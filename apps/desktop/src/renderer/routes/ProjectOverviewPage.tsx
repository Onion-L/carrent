import { useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { PanelRight } from "lucide-react";

import { useAppState } from "../context/AppStateContext";
import { ChatHeader } from "../components/chat/ChatHeader";
import { OpenInMenu } from "../components/chat/OpenInMenu";
import { Composer } from "../components/chat/Composer";
import { EmptyThreadPrompt } from "../components/chat/MessageTimeline";
import {
  ThreadInspectorPane,
  ThreadInspectorToggle,
} from "../components/chat/ThreadInspectorPane";
import { DesktopHeaderPortal } from "../components/DesktopHeaderActions";
import { BrowserWorkspace, useBrowserThread } from "../components/browser/BrowserWorkspace";
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
  const browserTarget =
    openDraft && project ? { projectId: project.id, threadId: openDraft.threadId } : null;
  const {
    state: browserState,
    setState: setBrowserState,
    open: openBrowser,
  } = useBrowserThread(browserTarget);
  const [browserVisible, setBrowserVisible] = useState(false);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [browserWidth, setBrowserWidth] = useState<number | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(false);

  useEffect(() => {
    setBrowserVisible(false);
    setBrowserFullscreen(false);
    setInspectorOpen(false);
  }, [openDraft?.threadId]);

  const activeBrowserState =
    browserTarget &&
    browserState?.projectId === browserTarget.projectId &&
    browserState.threadId === browserTarget.threadId
      ? browserState
      : null;

  useEffect(() => {
    if (!browserVisible || activeBrowserState?.placement !== "side") {
      setBrowserFullscreen(false);
    }
  }, [activeBrowserState?.placement, browserVisible]);
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
  const showBrowser =
    browserVisible &&
    activeBrowserState?.open === true &&
    activeBrowserState.placement === "side" &&
    activeBrowserState.contentOwned &&
    (browserFullscreen || !inspectorOpen) &&
    browserTarget !== null;
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
      <div className="relative flex h-full w-full">
        <DesktopHeaderPortal>
          <OpenInMenu
            workingDirectory={project.workingDirectory}
            disabled={projectDirectoryStatusById[project.id] === "unavailable"}
          />
        </DesktopHeaderPortal>
        <DesktopHeaderPortal>
          <ThreadInspectorToggle
            open={inspectorOpen}
            onToggle={() => setInspectorOpen((open) => !open)}
          />
        </DesktopHeaderPortal>
        <DesktopHeaderPortal>
          <button
            type="button"
            aria-label={showBrowser ? "Hide browser" : "Show browser"}
            title={showBrowser ? "Hide browser" : "Show browser"}
            aria-pressed={showBrowser}
            onClick={() => {
              if (showBrowser) {
                setBrowserVisible(false);
                setBrowserFullscreen(false);
                return;
              }
              setInspectorOpen(false);
              setBrowserVisible(true);
              if (!activeBrowserState?.open || !activeBrowserState.contentOwned) {
                void openBrowser();
              }
            }}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface-hover ${
              showBrowser ? "text-fg" : "text-muted hover:text-fg"
            }`}
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </DesktopHeaderPortal>
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <ChatHeader title="New thread" />
          <div
            data-empty-thread-layout
            className="flex min-h-0 flex-1 items-center justify-center px-6 py-8"
          >
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
                  composerState: openDraft.composerState,
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
                    composerState: draft?.composerState,
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

        {showBrowser && browserFullscreen && browserTarget && activeBrowserState ? (
          <div className="absolute inset-0 z-30 flex min-h-0 min-w-0">
            <BrowserWorkspace
              target={browserTarget}
              state={activeBrowserState}
              setState={setBrowserState}
              visible
              fullscreen
              onToggleFullscreen={() => setBrowserFullscreen(false)}
            />
          </div>
        ) : inspectorOpen ? (
          <div className="absolute bottom-3 right-3 top-3 z-10 w-[24rem]">
            <ThreadInspectorPane
              messages={[]}
              projectPath={project.workingDirectory}
              selectedTaskId={null}
              onSelectTask={() => {}}
              onClose={() => setInspectorOpen(false)}
            />
          </div>
        ) : showBrowser && browserTarget && activeBrowserState ? (
          <div
            className="relative flex h-full min-w-[22rem] max-w-[70%] shrink-0 border-l border-border"
            style={{ width: browserWidth ?? "45%" }}
          >
            <div
              className="absolute bottom-0 left-0 top-0 z-20 w-1 -translate-x-1/2 cursor-col-resize"
              onMouseDown={(event) => {
                event.preventDefault();
                const startX = event.clientX;
                const startWidth =
                  event.currentTarget.parentElement?.getBoundingClientRect().width ?? 520;
                const onMove = (moveEvent: MouseEvent) => {
                  setBrowserWidth(
                    Math.max(
                      352,
                      Math.min(window.innerWidth * 0.7, startWidth + startX - moveEvent.clientX),
                    ),
                  );
                };
                const onUp = () => {
                  document.body.style.userSelect = "";
                  document.removeEventListener("mousemove", onMove);
                  document.removeEventListener("mouseup", onUp);
                };
                document.body.style.userSelect = "none";
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
              }}
            />
            <BrowserWorkspace
              target={browserTarget}
              state={activeBrowserState}
              setState={setBrowserState}
              visible
              onToggleFullscreen={() => {
                setInspectorOpen(false);
                setBrowserVisible(true);
                setBrowserFullscreen(true);
              }}
            />
          </div>
        ) : null}
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
