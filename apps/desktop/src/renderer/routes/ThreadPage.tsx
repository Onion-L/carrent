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

function ThreadPageContent() {
  const { projectId, threadId } = useParams();
  const [submitRequest, setSubmitRequest] = useState<ComposerSubmitRequest | undefined>();
  const {
    getThreadRouteData,
    setActiveThreadId,
    setThreadRuntimeMode,
    setThreadRuntimeId,
    setThreadRuntimeModelId,
  } = useWorkspace();
  const routeData = resolveThreadRouteData(getThreadRouteData, projectId, threadId);
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
      mode="thread"
      placement={isEmptyThread ? "centered" : "default"}
      projectId={routeData.project.id}
      threadId={routeData.thread.id}
      messages={routeData.messages}
      runtimeId={routeData.thread.runtimeId ?? DEFAULT_RUNTIME_ID}
      runtimeModelId={routeData.thread.runtimeModelId}
      runtimeMode={routeData.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE}
      submitRequest={submitRequest}
      onRuntimeIdChange={(runtimeId) =>
        setThreadRuntimeId(routeData.project.id, routeData.thread.id, runtimeId)
      }
      onRuntimeModelIdChange={(modelId) =>
        setThreadRuntimeModelId(routeData.project.id, routeData.thread.id, modelId)
      }
      onRuntimeModeChange={(mode) =>
        setThreadRuntimeMode(routeData.project.id, routeData.thread.id, mode)
      }
    />
  ) : null;

  return (
    <div className="flex h-full w-full">
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <ChatHeader title={routeData?.thread.title ?? "Thread not found"} />
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

export function ThreadPage() {
  return (
    <WorkspaceDiffProvider>
      <ThreadPageContent />
    </WorkspaceDiffProvider>
  );
}
