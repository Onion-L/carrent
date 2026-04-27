import { useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useDraftThread } from "../context/DraftThreadContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { useDraftThreadPromotion } from "../hooks/useDraftThreadPromotion";
import { DEFAULT_RUNTIME_MODE } from "../../shared/runtimeMode";
import type { DraftThreadRecord } from "../lib/draftThreads";

export function resolvePromotedDraftRoute(draft: DraftThreadRecord | null | undefined) {
  if (!draft?.promotedToThreadId) {
    return null;
  }

  return `/thread/${draft.projectId}/${draft.promotedToThreadId}`;
}

export function DraftThreadPage() {
  const { draftId } = useParams();
  const navigate = useNavigate();
  const { getDraftById, setDraftRuntimeMode } = useDraftThread();
  const { setActiveThreadId } = useWorkspace();
  const draft = draftId ? getDraftById(draftId) : null;
  const promotedRoute = resolvePromotedDraftRoute(draft);

  useDraftThreadPromotion();

  useEffect(() => {
    setActiveThreadId(null);
  }, [draftId, setActiveThreadId]);

  useEffect(() => {
    if (!promotedRoute) {
      return;
    }

    navigate(promotedRoute);
  }, [navigate, promotedRoute]);

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader title={draft?.title ?? "Draft not found"} />
      <MessageTimeline messages={draft?.messages ?? []} />
      {draft ? (
        <Composer
          mode="draft"
          draftId={draft.draftId}
          projectId={draft.projectId}
          title={draft.title}
          preallocatedThreadId={draft.preallocatedThreadId}
          messages={draft.messages}
          runtimeMode={draft.runtimeMode ?? DEFAULT_RUNTIME_MODE}
          onRuntimeModeChange={(mode) => setDraftRuntimeMode(draft.draftId, mode)}
        />
      ) : null}
    </div>
  );
}
