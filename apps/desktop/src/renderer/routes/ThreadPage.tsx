import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";

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
import { useThreadContent } from "../context/ThreadContentContext";
import { useAppState } from "../context/AppStateContext";
import { WorkspaceDiffProvider, useThreadContentDiff } from "../context/WorkspaceDiffContext";
import { DEFAULT_RUNTIME_MODE } from "../../shared/runtimeMode";
import { DEFAULT_RUNTIME_ID } from "../../shared/runtimes";
import type { Message } from "../../shared/threadContent";
import { useChatRun } from "../hooks/useChatRun";
import { ProjectDirectoryUnavailable } from "../components/workspace/ProjectDirectoryUnavailable";
import { useToast } from "../components/toast/ToastContext";

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
  const seenTaskIdsRef = useRef<Set<string>>(new Set());
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
              await rollbackThreadRun(appThread.id, input.runId, input.messageId);
            }
          : undefined
      }
    />
  ) : null;

  const rightPane = resolveRightPane({ diffOpen: diffState.open, inspectorOpen });

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
              threadActions={threadActions.filter(
                (action) => action.threadId === routeData?.thread.id,
              )}
              threadId={routeData?.thread.id}
              onSubmitUserEdit={hasLiveRun ? undefined : handleSubmitUserEdit}
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
            onClose={() => setInspectorOpen(false)}
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
