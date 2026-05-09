import { useEffect } from "react";

import type { ChatRunEvent } from "../../shared/chat";
import { useDraftThread } from "../context/DraftThreadContext";
import { useWorkspace } from "../context/WorkspaceContext";
import type { DraftThreadRecord } from "../lib/draftThreads";

type PromotedThreadRecord = Extract<ChatRunEvent, { type: "thread-upserted" }>["thread"] & {
  runtimeModelId?: string;
};

export function buildPromotedThreadRecord(
  thread: PromotedThreadRecord,
  draft: DraftThreadRecord | null,
) {
  return thread.runtimeModelId === undefined && draft?.runtimeModelId
    ? { ...thread, runtimeModelId: draft.runtimeModelId }
    : thread;
}

export function useDraftThreadPromotion() {
  const { getDraftById, markPromotedDraftThreadByRef } = useDraftThread();
  const { upsertMessages, upsertThread } = useWorkspace();

  useEffect(() => {
    return window.carrent.chat.onEvent((event: ChatRunEvent) => {
      if (event.type !== "thread-upserted") {
        return;
      }

      const draft = getDraftById(event.draftId);
      const promotedThread = buildPromotedThreadRecord(event.thread, draft);

      upsertThread(event.projectId, promotedThread);
      if (draft) {
        upsertMessages(draft.messages);
      }
      markPromotedDraftThreadByRef(event.draftId, promotedThread.id);
    });
  }, [getDraftById, markPromotedDraftThreadByRef, upsertMessages, upsertThread]);
}
