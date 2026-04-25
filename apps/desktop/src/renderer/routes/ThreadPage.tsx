import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useWorkspace } from "../context/WorkspaceContext";
import type { Message, ProjectRecord, ThreadRecord } from "../mock/uiShellData";

type ThreadRouteData = {
  project: ProjectRecord;
  thread: ThreadRecord;
  messages: Message[];
};

export function resolveThreadRouteData(
  projects: ProjectRecord[],
  messages: Message[],
  projectId?: string,
  threadId?: string,
): ThreadRouteData | null {
  if (!projectId || !threadId) {
    return null;
  }

  const project = projects.find((item) => item.id === projectId);
  const thread = project?.threads.find((item) => item.id === threadId);

  if (!project || !thread) {
    return null;
  }

  return {
    project,
    thread,
    messages: messages.filter((message) => message.threadId === threadId),
  };
}

export function ThreadPage() {
  const { projectId, threadId } = useParams();
  const { projects, messages, setActiveThreadId } = useWorkspace();
  const routeData = resolveThreadRouteData(projects, messages, projectId, threadId);

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader title={routeData?.thread.title ?? "Thread not found"} />
      <MessageTimeline messages={routeData?.messages ?? []} />
      <Composer />
    </div>
  );
}
