import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useWorkspace } from "../context/WorkspaceContext";

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
  const { getThreadRouteData, setActiveThreadId } = useWorkspace();
  const routeData = resolveThreadRouteData(getThreadRouteData, projectId, threadId);

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader title={routeData?.thread.title ?? "Thread not found"} />
      <MessageTimeline messages={routeData?.messages ?? []} />
      {routeData ? (
        <Composer
          mode="thread"
          projectId={routeData.project.id}
          threadId={routeData.thread.id}
          messages={routeData.messages}
        />
      ) : null}
    </div>
  );
}
