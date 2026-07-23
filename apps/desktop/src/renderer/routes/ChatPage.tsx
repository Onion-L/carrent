import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer, type ComposerSubmitRequest } from "../components/chat/Composer";
import {
  EmptyThreadPrompt,
  MessageTimeline,
  type UserMessageEditDraft,
} from "../components/chat/MessageTimeline";
import { WorkspaceDiffViewer } from "../components/chat/WorkspaceDiffViewer";
import { useWorkspace } from "../context/WorkspaceContext";
import { WorkspaceDiffProvider, useWorkspaceDiff } from "../context/WorkspaceDiffContext";
import { DEFAULT_RUNTIME_MODE } from "../../shared/runtimeMode";
import { DEFAULT_RUNTIME_ID } from "../../shared/runtimes";

export function resolveChatRouteData(
  getChatRouteData: ReturnType<typeof useWorkspace>["getChatRouteData"],
  threadId?: string,
) {
  if (!threadId) {
    return null;
  }

  return getChatRouteData(threadId);
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

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  useEffect(() => {
    setSubmitRequest(undefined);
  }, [routeData?.thread.id]);

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

  return (
    <div className="flex h-full w-full">
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
              onSubmitUserEdit={handleSubmitUserEdit}
            />
            {composer}
          </>
        )}
      </div>

      {diffState.open && (
        <WorkspaceDiffViewer
          snapshot={diffState.snapshot}
          files={diffState.files}
          onClose={closeDiff}
        />
      )}
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
