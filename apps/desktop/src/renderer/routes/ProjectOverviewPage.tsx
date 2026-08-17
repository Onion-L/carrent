import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { PanelRight } from "lucide-react";

import { useAppState } from "../context/AppStateContext";
import { ChatHeader } from "../components/chat/ChatHeader";
import { OpenInMenu } from "../components/chat/OpenInMenu";
import { Composer } from "../components/chat/Composer";
import { ConversationDropSurface } from "../components/chat/ConversationDropSurface";
import { EmptyThreadPrompt } from "../components/chat/MessageTimeline";
import { ThreadInspectorPane } from "../components/chat/ThreadInspectorPane";
import { DesktopHeaderPortal } from "../components/DesktopHeaderActions";
import { BrowserWorkspace, useBrowserThread } from "../components/browser/BrowserWorkspace";
import type { AssociationThreadDraftRecord } from "../../shared/workspacePersistence";
import { ProjectDirectoryUnavailable } from "../components/workspace/ProjectDirectoryUnavailable";
import { useChatRun } from "../hooks/useChatRun";
import { RightSurfacePane } from "../components/right-surface/RightSurfacePane";
import { useRightSurface } from "../components/right-surface/useRightSurface";
import { useKeybinding } from "../hooks/useKeybinding";

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
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [rightSurfaceWidth, setRightSurfaceWidth] = useState<number | null>(null);
  useEffect(() => {
    setBrowserFullscreen(false);
  }, [openDraft?.threadId]);

  const activeBrowserState =
    browserTarget &&
    browserState?.projectId === browserTarget.projectId &&
    browserState.threadId === browserTarget.threadId
      ? browserState
      : null;
  const openBrowserSurface = useCallback(() => {
    if (!activeBrowserState?.open || !activeBrowserState.contentOwned) void openBrowser();
  }, [activeBrowserState?.contentOwned, activeBrowserState?.open, openBrowser]);
  const {
    activeSurface,
    selectSurface,
    openRightSurface,
    closeRightSurface: closeSurface,
    setSideContainer,
  } = useRightSurface({
    scopeKey: openDraft?.threadId ?? null,
    openBrowser: openBrowserSurface,
  });
  const handleLastBrowserTabClosed = () => {
    setBrowserFullscreen(false);
    selectSurface("chooser");
  };

  useEffect(() => {
    if (activeSurface !== "browser" || activeBrowserState?.placement !== "side") {
      setBrowserFullscreen(false);
    }
  }, [activeBrowserState?.placement, activeSurface]);

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

  const closeRightSurface = () => {
    setBrowserFullscreen(false);
    closeSurface();
  };
  useKeybinding("toggle-right-panel", () => {
    if (!openDraft) return;
    if (activeSurface) closeRightSurface();
    else openRightSurface();
  });
  useKeybinding("toggle-preview", () => {
    if (!openDraft || !browserTarget) return;
    if (activeSurface === "browser") closeRightSurface();
    else selectSurface("browser");
  });

  if (!workspace) return <Navigate replace to="/" />;
  if (!project || !association) return <Navigate replace to={`/workspace/${workspace.id}`} />;

  const displayName = association.alias ?? project.name;
  const showBrowser =
    activeSurface === "browser" &&
    activeBrowserState?.open === true &&
    activeBrowserState.placement === "side" &&
    activeBrowserState.contentOwned &&
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
          <button
            type="button"
            aria-label={activeSurface ? "Close right panel" : "Open right panel"}
            title={activeSurface ? "Close right panel" : "Open right panel"}
            aria-pressed={activeSurface !== null}
            onClick={() => {
              if (activeSurface) closeRightSurface();
              else openRightSurface();
            }}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface-hover ${
              activeSurface ? "text-fg" : "text-muted hover:text-fg"
            }`}
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </DesktopHeaderPortal>
        <div className="flex h-full min-w-0 flex-1 flex-col">
          <ConversationDropSurface>
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
                    localPathContexts: openDraft.localPathContexts,
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
                      localPathContexts: draft?.localPathContexts,
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
                    (await prepareThreadDraftPromotion({ draftId: openDraft.id, ...input })) !==
                    null
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
          </ConversationDropSurface>
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
              onLastTabClosed={handleLastBrowserTabClosed}
            />
          </div>
        ) : (
          <RightSurfacePane
            activeSurface={activeSurface}
            availability={{ browser: true, terminal: true, changes: false, inspector: false }}
            width={rightSurfaceWidth}
            onWidthChange={setRightSurfaceWidth}
            onSelect={selectSurface}
          >
            {(surface, closing) =>
              surface === "browser" && showBrowser && browserTarget && activeBrowserState ? (
                <BrowserWorkspace
                  target={browserTarget}
                  state={activeBrowserState}
                  setState={setBrowserState}
                  visible={!closing}
                  onToggleFullscreen={() => setBrowserFullscreen(true)}
                  onLastTabClosed={handleLastBrowserTabClosed}
                />
              ) : surface === "terminal" ? (
                <div ref={setSideContainer} className="h-full w-full" />
              ) : surface === "inspector" ? (
                <ThreadInspectorPane
                  embedded
                  messages={[]}
                  projectPath={project.workingDirectory}
                  selectedTaskId={null}
                  onSelectTask={() => {}}
                  onClose={closeRightSurface}
                />
              ) : null
            }
          </RightSurfacePane>
        )}
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
