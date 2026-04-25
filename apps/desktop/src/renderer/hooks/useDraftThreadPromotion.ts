import { useEffect } from "react";

import type { ChatRunEvent } from "../../shared/chat";
import { useDraftThread } from "../context/DraftThreadContext";
import { useWorkspace } from "../context/WorkspaceContext";

export function useDraftThreadPromotion() {
  const { getDraftById, markPromotedDraftThreadByRef } = useDraftThread();
  const { upsertMessages, upsertThread } = useWorkspace();

  useEffect(() => {
    return window.carrent.chat.onEvent((event: ChatRunEvent) => {
      if (event.type !== "thread-upserted") {
        return;
      }

      const draft = getDraftById(event.draftId);

      upsertThread(event.projectId, event.thread);
      if (draft) {
        upsertMessages(draft.messages);
      }
      markPromotedDraftThreadByRef(event.draftId, event.thread.id);
    });
  }, [getDraftById, markPromotedDraftThreadByRef, upsertMessages, upsertThread]);
}
