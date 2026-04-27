import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useWorkspace } from "../context/WorkspaceContext";

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
  const { getChatRouteData, setActiveThreadId } = useWorkspace();
  const routeData = resolveChatRouteData(getChatRouteData, threadId);

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader title={routeData?.thread.title ?? "Chat not found"} />
      <MessageTimeline messages={routeData?.messages ?? []} />
      {routeData ? (
        <Composer mode="chat" threadId={routeData.thread.id} messages={routeData.messages} />
      ) : null}
    </div>
  );
}
