import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { PanelRight } from "lucide-react";

import { ChatHeader } from "../components/chat/ChatHeader";
import { OpenInMenu } from "../components/chat/OpenInMenu";
import {
  Composer,
  type ComposerDraftRequest,
  type ComposerSubmitRequest,
} from "../components/chat/Composer";
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
  resolveRightPane,
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
  const appWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);
  const appProject = projects.find((project) => project.id === projectId);
  const appAssociation = associations.find(
    (association) => association.workspaceId === workspaceId && association.projectId === projectId,
  );
  const breadcrumb =
    appWorkspace && appProject && appAssociation && appThread
      ? `${appWorkspace.name} / ${appAssociation.alias ?? appProject.name} / ${appThread.title}`
      : undefined;
  const { state: diffState, closeDiff } = useThreadContentDiff();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const browserTarget =
    appProject && routeData ? { projectId: appProject.id, threadId: routeData.thread.id } : null;
  const {
    state: browserState,
    setState: setBrowserState,
    open: openBrowser,
  } = useBrowserThread(browserTarget);
  const [browserVisible, setBrowserVisible] = useState(false);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);
  const [browserWidth, setBrowserWidth] = useState<number | null>(null);
  const browserFocusSequences = useRef(new Map<string, number>());
  const inspectorInput = getThreadInspectorInput(routeData);
  const inspectorTasks = useMemo(
    () => collectSubagentTasks(inspectorInput?.messages ?? []),
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
    setBrowserVisible(false);
    setBrowserFullscreen(false);
  }, [routeData?.thread.id]);

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
      !activeBrowserState ||
      !recordBrowserFocusSequence(browserFocusSequences.current, activeBrowserState)
    ) {
      return;
    }
    if (activeBrowserState.placement === "side") {
      closeDiff();
      setInspectorOpen(false);
      setBrowserVisible(true);
    }
  }, [
    activeBrowserState?.focusSequence,
    activeBrowserState?.placement,
    activeBrowserState?.projectId,
    activeBrowserState?.threadId,
    closeDiff,
  ]);

  const handleSubmitUserEdit = (draft: UserMessageEditDraft) => {
    if (!routeData) {
      return;
    }

    setSubmitRequest({
      threadId: routeData.thread.id,
      request: {
        messageId: draft.messageId,
        content: draft.content,
        attachments: draft.attachments,
        requestId: Date.now(),
      },
    });
  };

  const handleRuntimeSessionRetry = async (request: RuntimeSessionRetryRequest) => {
    if (!routeData) return;
    const userMessage = routeData.messages.find(
      (message) => message.id === request.userMessageId && message.role === "user",
    );
    if (!userMessage || userMessage.role !== "user") {
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
      request: {
        messageId: userMessage.id,
        content: userMessage.content,
        attachments: userMessage.attachments,
        requestId: Date.now(),
      },
    });
  };
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

  const rightPane = resolveRightPane({ diffOpen: diffState.open, inspectorOpen });
  const showBrowser =
    browserVisible &&
    activeBrowserState?.open === true &&
    activeBrowserState.placement === "side" &&
    activeBrowserState.contentOwned &&
    (browserFullscreen || rightPane === null) &&
    browserTarget !== null;

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
      }) && (
        <DesktopHeaderPortal>
          <ThreadInspectorToggle
            open={inspectorOpen}
            onToggle={() => setInspectorOpen((open) => !open)}
          />
        </DesktopHeaderPortal>
      )}
      {browserTarget ? (
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
              closeDiff();
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
      ) : null}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ChatHeader title={routeData?.thread.title ?? "Thread not found"} breadcrumb={breadcrumb} />
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
            <MessageTimeline
              messages={routeData?.messages ?? []}
              threadActions={threadActions.filter(
                (action) => action.threadId === routeData?.thread.id,
              )}
              threadId={routeData?.thread.id}
              onSubmitUserEdit={hasLiveRun ? undefined : handleSubmitUserEdit}
              onRemoveRuntimeSessionAndRetry={handleRuntimeSessionRetry}
              onSelectSubagent={(taskId) => {
                setSelectedTaskId(taskId);
                setInspectorOpen(true);
              }}
            />
            {composer}
          </>
        )}
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
      ) : rightPane === "diff" && diffState.open ? (
        <WorkspaceDiffViewer
          snapshot={diffState.snapshot}
          files={diffState.files}
          onClose={closeDiff}
          onCreateFollowUp={
            routeData
              ? (content) => {
                  draftRequestIdRef.current += 1;
                  setDraftRequest({
                    threadId: routeData.thread.id,
                    request: { content, requestId: draftRequestIdRef.current },
                  });
                  closeDiff();
                }
              : undefined
          }
        />
      ) : rightPane === "inspector" ? (
        <div className="absolute bottom-3 right-3 top-3 z-10 w-[24rem]">
          <ThreadInspectorPane
            messages={inspectorInput?.messages ?? []}
            projectPath={inspectorInput?.projectPath}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
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
              closeDiff();
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

export function ThreadPage() {
  return (
    <WorkspaceDiffProvider>
      <ThreadPageContent />
    </WorkspaceDiffProvider>
  );
}
