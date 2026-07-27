import { useEffect, useMemo, useRef, useState } from "react";
import { Archive } from "lucide-react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
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
  updateSeenSubagentTasks,
} from "../components/chat/ThreadInspectorPane";
import { WorkspaceDiffViewer } from "../components/chat/WorkspaceDiffViewer";
import { DesktopHeaderPortal } from "../components/DesktopHeaderActions";
import { useWorkspace } from "../context/WorkspaceContext";
import { useAppState } from "../context/AppStateContext";
import { WorkspaceDiffProvider, useWorkspaceDiff } from "../context/WorkspaceDiffContext";
import { DEFAULT_RUNTIME_MODE } from "../../shared/runtimeMode";
import { DEFAULT_RUNTIME_ID } from "../../shared/runtimes";
import type { Message } from "../mock/uiShellData";
import { useChatRun } from "../hooks/useChatRun";
import { useQueuedMessages } from "../hooks/chatMessageQueue";
import { ProjectDirectoryUnavailable } from "../components/workspace/ProjectDirectoryUnavailable";
import { buildProjectPath, buildThreadPath } from "../lib/navigation";
import { useToast } from "../components/toast/ToastContext";

export function resolveThreadRouteData(
  getThreadRouteData: ReturnType<typeof useWorkspace>["getThreadRouteData"],
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

  return { projectPath: routeData.project.path, messages: routeData.messages };
}

function ThreadPageContent() {
  const { workspaceId, projectId, threadId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [submitRequest, setSubmitRequest] = useState<
    { threadId: string; request: ComposerSubmitRequest } | undefined
  >();
  const [draftRequest, setDraftRequest] = useState<
    { threadId: string; request: ComposerDraftRequest } | undefined
  >();
  const [archiveTargetPath, setArchiveTargetPath] = useState<string | null>(null);
  const draftRequestIdRef = useRef(0);
  const {
    getThreadRouteData,
    contentLoadError,
    retryContentLoad,
    setActiveThreadId,
    setThreadPlanMode,
    setThreadRuntimeMode,
    setThreadRuntimeId,
    setThreadRuntimeModelId,
  } = useWorkspace();
  const {
    workspaces,
    projects,
    associations,
    threads,
    updateThreadConfig,
    recordThreadRun,
    rollbackThreadRun,
    archiveThread,
    projectDirectoryStatusById,
  } = useAppState();
  const { runningThreadIds } = useChatRun();
  const queuedMessages = useQueuedMessages(threadId ?? "");
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
  const { state: diffState, closeDiff } = useWorkspaceDiff();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const seenTaskIdsRef = useRef<Set<string>>(new Set());
  const inspectorInput = getThreadInspectorInput(routeData);
  const inspectorTasks = useMemo(
    () => collectSubagentTasks(inspectorInput?.messages ?? []),
    [inspectorInput?.messages],
  );

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  useEffect(() => {
    setSubmitRequest(undefined);
    setDraftRequest(undefined);
    setSelectedTaskId(null);
    setInspectorOpen(false);
    seenTaskIdsRef.current = new Set();
    closeDiff();
  }, [routeData?.thread.id]);

  // Open the inspector once for each newly seen running task; updates to an
  // already-seen task never reopen it after the user closed it.
  useEffect(() => {
    const { seenTaskIds, shouldOpen } = updateSeenSubagentTasks({
      tasks: inspectorTasks,
      seenTaskIds: seenTaskIdsRef.current,
    });
    seenTaskIdsRef.current = seenTaskIds;
    if (shouldOpen) {
      setInspectorOpen(true);
    }
  }, [inspectorTasks]);

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
        setThreadRuntimeId(routeData.project.id, routeData.thread.id, runtimeId);
        if (appThread) void updateThreadConfig(appThread.id, { runtimeId });
      }}
      onRuntimeModelIdChange={(modelId) => {
        setThreadRuntimeModelId(routeData.project.id, routeData.thread.id, modelId);
        if (appThread) void updateThreadConfig(appThread.id, { runtimeModelId: modelId });
      }}
      onRuntimeModeChange={(mode) => {
        setThreadRuntimeMode(routeData.project.id, routeData.thread.id, mode);
        if (appThread) void updateThreadConfig(appThread.id, { runtimeMode: mode });
      }}
      onPlanModeChange={(enabled) => {
        setThreadPlanMode(routeData.project.id, routeData.thread.id, enabled);
        if (appThread) void updateThreadConfig(appThread.id, { planMode: enabled });
      }}
      onRunPrepared={
        appThread ? (input) => recordThreadRun({ threadId: appThread.id, ...input }) : undefined
      }
      onRunRejected={
        appThread
          ? async (input) => {
              await rollbackThreadRun(appThread.id, input.runId, input.messageId);
            }
          : undefined
      }
    />
  ) : null;

  const rightPane = resolveRightPane({ diffOpen: diffState.open, inspectorOpen });
  const archiveBlockedReason = appThread
    ? runningThreadIds.includes(appThread.id)
      ? "Stop the live Run before archiving"
      : queuedMessages.length > 0
        ? "Remove queued messages before archiving"
        : null
    : null;

  useEffect(() => {
    if (appThread?.archived && archiveTargetPath) {
      navigate(archiveTargetPath);
    }
  }, [appThread?.archived, archiveTargetPath, navigate]);

  const handleArchive = async () => {
    if (!appThread || archiveBlockedReason) return;
    const nextThread = threads
      .filter(
        (thread) =>
          thread.id !== appThread.id &&
          !thread.archived &&
          thread.workspaceId === appThread.workspaceId &&
          thread.projectId === appThread.projectId,
      )
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt))[0];
    setArchiveTargetPath(
      nextThread
        ? buildThreadPath(appThread.workspaceId, appThread.projectId, nextThread.id)
        : buildProjectPath(appThread.workspaceId, appThread.projectId),
    );
    const archived = await archiveThread(appThread.id);
    if (!archived) {
      setArchiveTargetPath(null);
      showToast("Thread could not be archived.", "error");
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

  if (contentLoadError && workspaceId && projectId) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <ChatHeader title={appThread?.title} breadcrumb={breadcrumb} />
        <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
          <div className="max-w-md text-center">
            <h2 className="text-app-15 font-semibold text-fg">{contentLoadError}</h2>
            <p className="mt-2 text-app-12 text-muted">
              Navigation is still available while Carrent retries this content.
            </p>
            <div className="mt-5 flex justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void retryContentLoad().then((loaded) => {
                    if (loaded) {
                      navigate(`${location.pathname}${location.search}`, { replace: true });
                    }
                  });
                }}
                className="min-h-8 rounded-md bg-fg px-3 text-app-12 font-medium text-bg hover:opacity-90"
              >
                Retry
              </button>
              <button
                type="button"
                onClick={() => navigate(`/workspace/${workspaceId}/project/${projectId}`)}
                className="min-h-8 rounded-md border border-border-strong px-3 text-app-12 font-medium text-fg hover:bg-surface-hover"
              >
                Open Project Overview
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full">
      {appThread && !appThread.archived ? (
        <DesktopHeaderPortal>
          <button
            type="button"
            aria-label="Archive Thread"
            title={archiveBlockedReason ?? "Archive Thread"}
            disabled={archiveBlockedReason !== null}
            onClick={() => void handleArchive()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-subtle hover:bg-surface-hover hover:text-fg disabled:cursor-not-allowed disabled:opacity-35"
          >
            <Archive className="h-4 w-4" />
          </button>
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
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ChatHeader title={routeData?.thread.title ?? "Thread not found"} breadcrumb={breadcrumb} />
        {routeData && isEmptyThread ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
            <div className="flex w-full max-w-[56rem] flex-col items-center gap-6">
              <EmptyThreadPrompt />
              {composer}
            </div>
          </div>
        ) : (
          <>
            <MessageTimeline
              messages={routeData?.messages ?? []}
              threadId={routeData?.thread.id}
              onSubmitUserEdit={handleSubmitUserEdit}
              onRemoveRuntimeSessionAndRetry={handleRuntimeSessionRetry}
            />
            {composer}
          </>
        )}
      </div>

      {rightPane === "diff" && diffState.open ? (
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
