import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useDraftThread } from "../context/DraftThreadContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { DEFAULT_RUNTIME_MODE } from "../../shared/runtimeMode";
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
      (draft) => draft.projectId === projectId && draft.promotedToThreadId === threadId,
    ) ?? null
  );
}

export function ThreadPage() {
  const { projectId, threadId } = useParams();
  const { getThreadRouteData, setActiveThreadId, setThreadRuntimeMode } = useWorkspace();
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
      <ChatHeader
        title={routeData?.thread.title ?? "Thread not found"}
        runtimeMode={routeData?.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE}
        onRuntimeModeChange={
          routeData
            ? (mode) => setThreadRuntimeMode(routeData.project.id, routeData.thread.id, mode)
            : undefined
        }
      />
      <MessageTimeline messages={routeData?.messages ?? []} />
      {routeData ? (
        <Composer
          mode="thread"
          projectId={routeData.project.id}
          threadId={routeData.thread.id}
          messages={routeData.messages}
          runtimeMode={routeData.thread.runtimeMode ?? DEFAULT_RUNTIME_MODE}
        />
      ) : null}
    </div>
  );
}
