import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import {
  Composer,
  type ComposerSubmitRequest,
} from "../components/chat/Composer";
import {
  MessageTimeline,
  type UserMessageEditDraft,
} from "../components/chat/MessageTimeline";
import { useWorkspace } from "../context/WorkspaceContext";
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

export function ThreadPage() {
  const { projectId, threadId } = useParams();
  const [submitRequest, setSubmitRequest] = useState<
    ComposerSubmitRequest | undefined
  >();
  const {
    getThreadRouteData,
    setActiveThreadId,
    setThreadRuntimeMode,
    setThreadRuntimeId,
    setThreadRuntimeModelId,
  } = useWorkspace();
  const routeData = resolveThreadRouteData(
    getThreadRouteData,
    projectId,
    threadId,
  );

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

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader title={routeData?.thread.title ?? "Thread not found"} />
      <MessageTimeline
        messages={routeData?.messages ?? []}
        onSubmitUserEdit={handleSubmitUserEdit}
      />
      {routeData ? (
        <Composer
          mode="thread"
          projectId={routeData.project.id}
          threadId={routeData.thread.id}
          messages={routeData.messages}
          runtimeId={routeData.thread.runtimeId ?? DEFAULT_RUNTIME_ID}
          runtimeModelId={routeData.thread.runtimeModelId}
          runtimeMode={routeData.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE}
          submitRequest={submitRequest}
          onRuntimeIdChange={(runtimeId) =>
            setThreadRuntimeId(
              routeData.project.id,
              routeData.thread.id,
              runtimeId,
            )
          }
          onRuntimeModelIdChange={(modelId) =>
            setThreadRuntimeModelId(
              routeData.project.id,
              routeData.thread.id,
              modelId,
            )
          }
          onRuntimeModeChange={(mode) =>
            setThreadRuntimeMode(
              routeData.project.id,
              routeData.thread.id,
              mode,
            )
          }
        />
      ) : null}
    </div>
  );
}
