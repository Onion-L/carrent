import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useDraftThread } from "../context/DraftThreadContext";
import { useWorkspace } from "../context/WorkspaceContext";
import type { DraftThreadRecord } from "../lib/draftThreads";

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

export function findPromotedDraftToFinalize(
  drafts: DraftThreadRecord[],
  projectId?: string,
  threadId?: string,
) {
  if (!projectId || !threadId) {
    return null;
  }

  return (
    drafts.find(
      (draft) =>
        draft.projectId === projectId && draft.promotedToThreadId === threadId,
    ) ?? null
  );
}

export function ThreadPage() {
  const { projectId, threadId } = useParams();
  const { getThreadRouteData, setActiveThreadId } = useWorkspace();
  const { drafts, finalizePromotedDraftThreadByRef } = useDraftThread();
  const routeData = resolveThreadRouteData(getThreadRouteData, projectId, threadId);
  const promotedDraft = findPromotedDraftToFinalize(drafts, projectId, threadId);

  useEffect(() => {
    setActiveThreadId(routeData?.thread.id ?? null);
  }, [routeData?.thread.id, setActiveThreadId]);

  useEffect(() => {
    if (!promotedDraft) {
      return;
    }

    finalizePromotedDraftThreadByRef(promotedDraft.draftId);
  }, [finalizePromotedDraftThreadByRef, promotedDraft]);

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
