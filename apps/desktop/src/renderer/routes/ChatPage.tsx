import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer, type ComposerSubmitRequest } from "../components/chat/Composer";
import {
  EmptyThreadPrompt,
  MessageTimeline,
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
import { WorkspaceDiffProvider, useWorkspaceDiff } from "../context/WorkspaceDiffContext";
import { DEFAULT_RUNTIME_MODE } from "../../shared/runtimeMode";
import { DEFAULT_RUNTIME_ID } from "../../shared/runtimes";
import type { Message } from "../mock/uiShellData";

export function resolveChatRouteData(
  getChatRouteData: ReturnType<typeof useWorkspace>["getChatRouteData"],
  threadId?: string,
) {
  if (!threadId) {
    return null;
  }

  return getChatRouteData(threadId);
}

// General Chats have no project Git context, so the inspector input carries
// messages only and the Environment section stays hidden.
export function getChatInspectorInput(
  routeData: ReturnType<typeof resolveChatRouteData>,
): { messages: Message[] } | null {
  if (!routeData) {
    return null;
  }

  return { messages: routeData.messages };
}

function ChatPageContent() {
  const { threadId } = useParams();
  const [submitRequest, setSubmitRequest] = useState<ComposerSubmitRequest | undefined>();
  const {
    getChatRouteData,
    setActiveThreadId,
    setChatPlanMode,
    setChatRuntimeMode,
    setChatRuntimeId,
    setChatRuntimeModelId,
  } = useWorkspace();
  const routeData = resolveChatRouteData(getChatRouteData, threadId);
  const { state: diffState, closeDiff } = useWorkspaceDiff();
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const seenTaskIdsRef = useRef<Set<string>>(new Set());
  const inspectorInput = getChatInspectorInput(routeData);
  const inspectorTasks = useMemo(
    () => collectSubagentTasks(inspectorInput?.messages ?? []),
    [inspectorInput?.messages],
  );

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  useEffect(() => {
    setSubmitRequest(undefined);
    setSelectedTaskId(null);
    setInspectorOpen(false);
    seenTaskIdsRef.current = new Set();
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
    setSubmitRequest({
      messageId: draft.messageId,
      content: draft.content,
      attachments: draft.attachments,
      requestId: Date.now(),
    });
  };
  const isEmptyThread = routeData?.messages.length === 0;
  const composer = routeData ? (
    <Composer
      key={routeData.thread.id}
      mode="chat"
      placement={isEmptyThread ? "centered" : "default"}
      threadId={routeData.thread.id}
      messages={routeData.messages}
      runtimeId={routeData.thread.runtimeId ?? DEFAULT_RUNTIME_ID}
      runtimeModelId={routeData.thread.runtimeModelId}
      runtimeMode={routeData.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE}
      planMode={routeData.thread.planMode === true}
      submitRequest={submitRequest}
      onRuntimeIdChange={(runtimeId) => setChatRuntimeId(routeData.thread.id, runtimeId)}
      onRuntimeModelIdChange={(modelId) => setChatRuntimeModelId(routeData.thread.id, modelId)}
      onRuntimeModeChange={(mode) => setChatRuntimeMode(routeData.thread.id, mode)}
      onPlanModeChange={(enabled) => setChatPlanMode(routeData.thread.id, enabled)}
    />
  ) : null;

  const rightPane = resolveRightPane({ diffOpen: diffState.open, inspectorOpen });

  return (
    <div className="relative flex h-full w-full">
      {shouldShowInspectorToggle({
        hasProjectEnvironment: false,
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
        <ChatHeader title={routeData?.thread.title ?? "Chat not found"} />
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
        />
      ) : rightPane === "inspector" ? (
        <div className="absolute bottom-3 right-3 top-3 z-10 w-[24rem]">
          <ThreadInspectorPane
            messages={inspectorInput?.messages ?? []}
            selectedTaskId={selectedTaskId}
            onSelectTask={setSelectedTaskId}
          />
        </div>
      ) : null}
    </div>
  );
}

export function ChatPage() {
  return (
    <WorkspaceDiffProvider>
      <ChatPageContent />
    </WorkspaceDiffProvider>
  );
}
