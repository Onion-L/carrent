import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useWorkspace } from "../context/WorkspaceContext";
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

export function ChatPage() {
  const { threadId } = useParams();
  const {
    getChatRouteData,
    setActiveThreadId,
    setChatRuntimeMode,
    setChatRuntimeId,
    setChatRuntimeModelId,
  } = useWorkspace();
  const routeData = resolveChatRouteData(getChatRouteData, threadId);

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader title={routeData?.thread.title ?? "Chat not found"} />
      <MessageTimeline messages={routeData?.messages ?? []} />
      {routeData ? (
        <Composer
          mode="chat"
          threadId={routeData.thread.id}
          messages={routeData.messages}
          runtimeId={routeData.thread.runtimeId ?? DEFAULT_RUNTIME_ID}
          runtimeModelId={routeData.thread.runtimeModelId}
          runtimeMode={routeData.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE}
          onRuntimeIdChange={(runtimeId) => setChatRuntimeId(routeData.thread.id, runtimeId)}
          onRuntimeModelIdChange={(modelId) =>
            setChatRuntimeModelId(routeData.thread.id, modelId)
          }
          onRuntimeModeChange={(mode) => setChatRuntimeMode(routeData.thread.id, mode)}
        />
      ) : null}
    </div>
  );
}
