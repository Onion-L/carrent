import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useWorkspace } from "../context/WorkspaceContext";
import { DEFAULT_RUNTIME_MODE } from "../../shared/runtimeMode";

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
  const { getChatRouteData, setActiveThreadId, setChatRuntimeMode } = useWorkspace();
  const routeData = resolveChatRouteData(getChatRouteData, threadId);

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader
        title={routeData?.thread.title ?? "Chat not found"}
        runtimeMode={routeData?.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE}
        onRuntimeModeChange={
          routeData ? (mode) => setChatRuntimeMode(routeData.thread.id, mode) : undefined
        }
      />
      <MessageTimeline messages={routeData?.messages ?? []} />
      {routeData ? (
        <Composer
          mode="chat"
          threadId={routeData.thread.id}
          messages={routeData.messages}
          runtimeMode={routeData.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE}
        />
      ) : null}
    </div>
  );
}
