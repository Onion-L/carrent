import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { PanelRight } from "lucide-react";

import { ChatHeader } from "../components/chat/ChatHeader";
import { DebugTimeline } from "../components/chat/DebugTimeline";
import { OpenInMenu } from "../components/chat/OpenInMenu";
import {
  Composer,
  type ComposerDraftRequest,
  type ComposerSubmitRequest,
} from "../components/chat/Composer";
import { ConversationDropSurface } from "../components/chat/ConversationDropSurface";
import {
  EmptyThreadPrompt,
  MessageTimeline,
  type RuntimeSessionRetryRequest,
  type UserMessageEditDraft,
} from "../components/chat/MessageTimeline";
import {
  ThreadInspectorPane,
  ThreadInspectorToggle,
  collectSubagentTasks,
  selectLatestChangedFilesMessage,
  shouldShowInspectorToggle,
} from "../components/chat/ThreadInspectorPane";
import { WorkspaceDiffViewer } from "../components/chat/WorkspaceDiffViewer";
import { DesktopHeaderPortal } from "../components/DesktopHeaderActions";
import { useThreadContent } from "../context/ThreadContentContext";
import { useAppState } from "../context/AppStateContext";
import { WorkspaceDiffProvider, useThreadContentDiff } from "../context/WorkspaceDiffContext";
import { DEFAULT_RUNTIME_MODE } from "../../shared/runtimeMode";
import { DEFAULT_RUNTIME_ID } from "../../shared/runtimes";
import type { BrowserThreadState } from "../../shared/browser";
import type { Message } from "../../shared/threadContent";
import { useChatRun } from "../hooks/useChatRun";
import { ProjectDirectoryUnavailable } from "../components/workspace/ProjectDirectoryUnavailable";
import { useToast } from "../components/toast/ToastContext";
import { BrowserWorkspace, useBrowserThread } from "../components/browser/BrowserWorkspace";
import {
  RightSurfacePane,
  shouldOpenDiffSurface,
} from "../components/right-surface/RightSurfacePane";
import { useRightSurface } from "../components/right-surface/useRightSurface";

export function resolveThreadRouteData(
  getThreadRouteData: ReturnType<typeof useThreadContent>["getThreadRouteData"],
  projectId?: string,
  threadId?: string,
) {
  if (!projectId || !threadId) {
    return null;
  }

  return getThreadRouteData(projectId, threadId);
}

export function getThreadInspectorInput(
  routeData: ReturnType<typeof resolveThreadRouteData>,
): { projectPath: string; messages: Message[] } | null {
  if (!routeData) {
    return null;
  }

  return { projectPath: routeData.project.workingDirectory, messages: routeData.messages };
}

export function recordBrowserFocusSequence(
  seenSequences: Map<string, number>,
  state: Pick<BrowserThreadState, "threadId" | "focusSequence">,
) {
  const previous = seenSequences.get(state.threadId);
  seenSequences.set(state.threadId, state.focusSequence);
  return previous !== undefined && state.focusSequence > previous;
}

export function buildRuntimeSessionRetrySubmitRequest(
  userMessage: Message | undefined,
  requestId: number,
): ComposerSubmitRequest | null {
  if (!userMessage || userMessage.role !== "user") {
    return null;
  }
  return {
    messageId: userMessage.id,
    content: userMessage.content,
    attachments: userMessage.attachments,
    localPathContexts: userMessage.localPathContexts,
    requestId,
  };
}

function ThreadPageContent() {
  const { workspaceId, projectId, threadId } = useParams();
  const { showToast } = useToast();
  const [submitRequest, setSubmitRequest] = useState<
    { threadId: string; request: ComposerSubmitRequest } | undefined
  >();
  const [draftRequest, setDraftRequest] = useState<
    { threadId: string; request: ComposerDraftRequest } | undefined
  >();
  const draftRequestIdRef = useRef(0);
  const { getThreadRouteData, setSelectedThreadId } = useThreadContent();
  const {
    workspaces,
    projects,
    associations,
    threads,
    threadActions,
    updateThreadConfig,
    recordThreadRun,
    rollbackThreadRun,
    projectDirectoryStatusById,
  } = useAppState();
  const { runningThreadIds } = useChatRun();
  const hasLiveRun = threadId ? runningThreadIds.includes(threadId) : false;
  const appThread = workspaceId
    ? threads.find(
        (thread) =>
          thread.id === threadId &&
          thread.workspaceId === workspaceId &&
          thread.projectId === projectId,
      )
    : null;
  const routeData =
    workspaceId && !appThread
      ? null
      : resolveThreadRouteData(getThreadRouteData, projectId, threadId);
  // Timeline message components are memoized on prop identity, so the
  // callbacks they receive must stay referentially stable across the renders
  // a streaming Run produces.
  const routeDataRef = useRef(routeData);
  routeDataRef.current = routeData;
  const appWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const appProject = projects.find((project) => project.id === projectId);
  const appAssociation = associations.find(
    (association) => association.workspaceId === workspaceId && association.projectId === projectId,
  );
  const breadcrumb =
    appWorkspace && appProject && appAssociation && appThread
      ? `${appWorkspace.name} / ${appAssociation.alias ?? appProject.name} / ${appThread.title}`
      : undefined;
  const { state: diffState, openDiff, closeDiff } = useThreadContentDiff();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [debugView, setDebugView] = useState(false);
  const browserTarget =
    appProject && routeData ? { projectId: appProject.id, threadId: routeData.thread.id } : null;
  const {
    state: browserState,
    setState: setBrowserState,
    open: openBrowser,
  } = useBrowserThread(browserTarget);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [rightSurfaceWidth, setRightSurfaceWidth] = useState<number | null>(null);
  const browserFocusSequences = useRef(new Map<string, number>());
  const inspectorInput = getThreadInspectorInput(routeData);
  const inspectorTasks = useMemo(
    () => collectSubagentTasks(inspectorInput?.messages ?? []),
    [inspectorInput?.messages],
  );
  const latestChanges = useMemo(
    () => selectLatestChangedFilesMessage(inspectorInput?.messages ?? []),
    [inspectorInput?.messages],
  );
  useEffect(() => {
    setSelectedThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setSelectedThreadId]);

  useEffect(() => {
    setSubmitRequest(undefined);
    setDraftRequest(undefined);
    setSelectedTaskId(null);
    setInspectorOpen(false);
    closeDiff();
  }, [routeData?.thread.id]);

  useEffect(() => {
    setBrowserFullscreen(false);
  }, [routeData?.thread.id]);

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
    scopeKey: routeData?.thread.id ?? null,
    openBrowser: openBrowserSurface,
  });

  useEffect(() => {
    if (activeSurface !== "browser" || activeBrowserState?.placement !== "side") {
      setBrowserFullscreen(false);
    }
  }, [activeBrowserState?.placement, activeSurface]);

  useEffect(() => {
    if (
      shouldOpenDiffSurface(
        diffState.open ? diffState.scopeKey : null,
        routeData?.thread.id ?? null,
      )
    ) {
      setInspectorOpen(false);
      selectSurface("changes");
    }
  }, [diffState, routeData?.thread.id, selectSurface]);

  useEffect(() => {
    if (
      !activeBrowserState ||
      !recordBrowserFocusSequence(browserFocusSequences.current, activeBrowserState)
    ) {
      return;
    }
    if (activeBrowserState.placement === "side") {
      setInspectorOpen(false);
      selectSurface("browser");
    }
  }, [
    activeBrowserState?.focusSequence,
    activeBrowserState?.placement,
    activeBrowserState?.projectId,
    activeBrowserState?.threadId,
    selectSurface,
  ]);

  const handleSubmitUserEdit = useCallback((draft: UserMessageEditDraft) => {
    const data = routeDataRef.current;
    if (!data) {
      return;
    }

    setSubmitRequest({
      threadId: data.thread.id,
      request: {
        messageId: draft.messageId,
        content: draft.content,
        attachments: draft.attachments,
        localPathContexts: draft.localPathContexts,
        requestId: Date.now(),
      },
    });
  }, []);

  const handleRuntimeSessionRetry = useCallback(
    async (request: RuntimeSessionRetryRequest) => {
      const data = routeDataRef.current;
      if (!data) return;
      const userMessage = data.messages.find(
        (message) => message.id === request.userMessageId && message.role === "user",
      );
      const retrySubmitRequest = buildRuntimeSessionRetrySubmitRequest(userMessage, Date.now());
      if (!retrySubmitRequest) {
        showToast("The original request is unavailable.", "error");
        return;
      }

      try {
        await window.carrent.chat.removeRuntimeSession({
          runtimeId: request.runtimeId,
          threadId: request.threadId,
        });
      } catch (error) {
        showToast(error instanceof Error ? error.message : String(error), "error");
        return;
      }

      setSubmitRequest({
        threadId: request.threadId,
        request: retrySubmitRequest,
      });
    },
    [showToast],
  );

  const handleSelectSubagent = useCallback(
    (taskId: string) => {
      setSelectedTaskId(taskId);
      closeSurface();
      setInspectorOpen(true);
    },
    [closeSurface],
  );
  const isEmptyThread = routeData?.messages.length === 0;
  const composer = routeData ? (
    <Composer
      key={routeData.thread.id}
      mode="thread"
      workspaceId={workspaceId!}
      placement={isEmptyThread ? "centered" : "default"}
      projectId={routeData.project.id}
      threadId={routeData.thread.id}
      messages={routeData.messages}
      runtimeId={appThread?.runtimeId ?? routeData.thread.runtimeId ?? DEFAULT_RUNTIME_ID}
      runtimeModelId={appThread ? appThread.runtimeModelId : routeData.thread.runtimeModelId}
      runtimeMode={appThread?.runtimeMode ?? routeData.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE}
      planMode={appThread?.planMode ?? routeData.thread.planMode === true}
      submitRequest={
        submitRequest?.threadId === routeData.thread.id ? submitRequest.request : undefined
      }
      draftRequest={
        draftRequest?.threadId === routeData.thread.id ? draftRequest.request : undefined
      }
      onRuntimeIdChange={(runtimeId) => {
        if (appThread) void updateThreadConfig(appThread.id, { runtimeId });
      }}
      onRuntimeModelIdChange={(modelId) => {
        if (appThread) void updateThreadConfig(appThread.id, { runtimeModelId: modelId });
      }}
      onRuntimeModeChange={(mode) => {
        if (appThread) void updateThreadConfig(appThread.id, { runtimeMode: mode });
      }}
      onPlanModeChange={(enabled) => {
        if (appThread) void updateThreadConfig(appThread.id, { planMode: enabled });
      }}
      onRunPrepared={
        appThread ? (input) => recordThreadRun({ threadId: appThread.id, ...input }) : undefined
      }
      onRunRejected={
        appThread
          ? async (input) => {
              await rollbackThreadRun(
                appThread.id,
                input.runId,
                input.messageId,
                input.assistantMessageId,
              );
            }
          : undefined
      }
    />
  ) : null;

  const showBrowser =
    activeSurface === "browser" &&
    activeBrowserState?.open === true &&
    activeBrowserState.placement === "side" &&
    activeBrowserState.contentOwned &&
    browserTarget !== null;

  const closeRightSurface = () => {
    closeDiff();
    setBrowserFullscreen(false);
    closeSurface();
  };

  const handleSelectSurface = (surface: Parameters<typeof selectSurface>[0]) => {
    if (surface !== "changes") closeDiff();
    setInspectorOpen(false);
    selectSurface(surface);
    if (surface === "changes" && latestChanges?.snapshot && routeData) {
      openDiff(routeData.thread.id, latestChanges.snapshot, latestChanges.changedFiles);
    }
  };

  if (workspaceId && !appThread) {
    return <Navigate replace to={`/workspace/${workspaceId}/project/${projectId}`} />;
  }

  if (appProject && breadcrumb && projectDirectoryStatusById[appProject.id] === "unavailable") {
    return (
      <ProjectDirectoryUnavailable
        project={appProject}
        breadcrumb={breadcrumb}
        hasLiveRun={threads.some(
          (thread) => thread.projectId === appProject.id && runningThreadIds.includes(thread.id),
        )}
      />
    );
  }

  return (
    <div className="relative flex h-full w-full">
      {appProject ? (
        <DesktopHeaderPortal>
          <OpenInMenu
            workingDirectory={appProject.workingDirectory}
            disabled={projectDirectoryStatusById[appProject.id] === "unavailable"}
          />
        </DesktopHeaderPortal>
      ) : null}
      {shouldShowInspectorToggle({
        hasProjectEnvironment: !!inspectorInput,
        taskCount: inspectorTasks.length,
      }) ? (
        <DesktopHeaderPortal>
          <ThreadInspectorToggle
            open={inspectorOpen}
            onToggle={() => {
              if (inspectorOpen) {
                setInspectorOpen(false);
                return;
              }
              closeRightSurface();
              setInspectorOpen(true);
            }}
          />
        </DesktopHeaderPortal>
      ) : null}
      {browserTarget ? (
        <DesktopHeaderPortal>
          <button
            type="button"
            aria-label={activeSurface ? "Close right panel" : "Open right panel"}
            title={activeSurface ? "Close right panel" : "Open right panel"}
            aria-pressed={activeSurface !== null}
            onClick={() => {
              if (activeSurface) closeRightSurface();
              else {
                setInspectorOpen(false);
                openRightSurface();
              }
            }}
            className={`flex h-7 w-7 items-center justify-center rounded-md transition hover:bg-surface-hover ${
              activeSurface ? "text-fg" : "text-muted hover:text-fg"
            }`}
          >
            <PanelRight className="h-4 w-4" />
          </button>
        </DesktopHeaderPortal>
      ) : null}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ConversationDropSurface>
          <ChatHeader
            title={routeData?.thread.title ?? "Thread not found"}
            leading={
              import.meta.env.DEV ? (
                <div className="no-drag flex items-center gap-0.5 rounded-md border border-border bg-surface p-0.5">
                  {(["chat", "debug"] as const).map((view) => {
                    const active = debugView === (view === "debug");
                    return (
                      <button
                        key={view}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setDebugView(view === "debug")}
                        className={`rounded px-2 py-0.5 text-app-12 transition ${
                          active ? "bg-surface-hover text-fg" : "text-muted hover:text-fg"
                        }`}
                      >
                        {view === "chat" ? "Chat" : "Debug"}
                      </button>
                    );
                  })}
                </div>
              ) : undefined
            }
          />
          {routeData && isEmptyThread ? (
            <div
              data-empty-thread-layout
              className="flex min-h-0 flex-1 items-center justify-center px-6 py-8"
            >
              <div className="flex w-full max-w-[56rem] flex-col items-center gap-6">
                <EmptyThreadPrompt />
                {composer}
              </div>
            </div>
          ) : (
            <>
              {import.meta.env.DEV && debugView ? (
                <DebugTimeline messages={routeData?.messages ?? []} />
              ) : (
                <MessageTimeline
                  messages={routeData?.messages ?? []}
                  threadActions={threadActions.filter(
                    (action) => action.threadId === routeData?.thread.id,
                  )}
                  threadId={routeData?.thread.id}
                  onSubmitUserEdit={hasLiveRun ? undefined : handleSubmitUserEdit}
                  onRemoveRuntimeSessionAndRetry={handleRuntimeSessionRetry}
                  onSelectSubagent={handleSelectSubagent}
                />
              )}
              {composer}
            </>
          )}
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
          />
        </div>
      ) : inspectorOpen ? (
        <div className="absolute bottom-3 right-3 top-3 z-10 w-[24rem]">
          <ThreadInspectorPane
            messages={inspectorInput?.messages ?? []}
            projectPath={inspectorInput?.projectPath}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
            onClose={() => setInspectorOpen(false)}
          />
        </div>
      ) : activeSurface ? (
        <RightSurfacePane
          activeSurface={activeSurface}
          availability={{
            browser: browserTarget !== null,
            terminal: appProject !== undefined,
            changes: latestChanges?.snapshot !== undefined,
            inspector: inspectorTasks.length > 0,
          }}
          width={rightSurfaceWidth}
          onWidthChange={setRightSurfaceWidth}
          onSelect={handleSelectSurface}
        >
          {activeSurface === "browser" && showBrowser && browserTarget && activeBrowserState ? (
            <BrowserWorkspace
              target={browserTarget}
              state={activeBrowserState}
              setState={setBrowserState}
              visible
              onToggleFullscreen={() => setBrowserFullscreen(true)}
            />
          ) : activeSurface === "terminal" ? (
            <div ref={setSideContainer} className="h-full w-full" />
          ) : activeSurface === "changes" && diffState.open ? (
            <WorkspaceDiffViewer
              embedded
              snapshot={diffState.snapshot}
              files={diffState.files}
              onClose={closeRightSurface}
              onCreateFollowUp={
                routeData
                  ? (content) => {
                      draftRequestIdRef.current += 1;
                      setDraftRequest({
                        threadId: routeData.thread.id,
                        request: { content, requestId: draftRequestIdRef.current },
                      });
                      closeRightSurface();
                    }
                  : undefined
              }
            />
          ) : activeSurface === "inspector" ? (
            <ThreadInspectorPane
              embedded
              messages={inspectorInput?.messages ?? []}
              projectPath={inspectorInput?.projectPath}
              selectedTaskId={selectedTaskId}
              onSelectTask={setSelectedTaskId}
              onClose={closeRightSurface}
            />
          ) : null}
        </RightSurfacePane>
      ) : null}
    </div>
  );
}

export function ThreadPage() {
  return (
    <WorkspaceDiffProvider>
      <ThreadPageContent />
    </WorkspaceDiffProvider>
  );
}
