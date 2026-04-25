import { useEffect } from "react";

import type { ChatRunEvent } from "../../shared/chat";
import { useDraftThread } from "../context/DraftThreadContext";
import { useWorkspace } from "../context/WorkspaceContext";

export function useDraftThreadPromotion() {
  const { markPromotedDraftThreadByRef } = useDraftThread();
  const { upsertThread } = useWorkspace();

  useEffect(() => {
    return window.carrent.chat.onEvent((event: ChatRunEvent) => {
      if (event.type !== "thread-upserted") {
        return;
      }

      upsertThread(event.projectId, event.thread);
      markPromotedDraftThreadByRef(event.draftId, event.thread.id);
    });
  }, [markPromotedDraftThreadByRef, upsertThread]);
}
