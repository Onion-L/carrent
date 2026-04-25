import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useDraftThread } from "../context/DraftThreadContext";
import { useWorkspace } from "../context/WorkspaceContext";
import type { DraftThreadRecord } from "../lib/draftThreads";
import type { Message } from "../mock/uiShellData";

function buildVerificationDraft(draftId: string): DraftThreadRecord | null {
  if (draftId !== "foo") {
    return null;
  }

  const messages: Message[] = [
    {
      id: "draft-foo-message-1",
      role: "user",
      agentId: "architect",
      timestamp: "09:00",
      threadId: "draft-foo-thread",
      content: "Sketch the draft-first thread flow before promotion.",
    },
  ];

  return {
    draftId,
    projectId: "project-1",
    title: "Draft thread",
    preallocatedThreadId: "draft-foo-thread",
    createdAt: "2026-04-25T00:00:00.000Z",
    messages,
  };
}

export function resolveDraftRouteData(
  drafts: DraftThreadRecord[],
  draftId?: string,
) {
  if (!draftId) {
    return null;
  }

  return (
    drafts.find((draft) => draft.draftId === draftId) ??
    buildVerificationDraft(draftId)
  );
}

export function DraftThreadPage() {
  const { draftId } = useParams();
  const { drafts } = useDraftThread();
  const { setActiveThreadId } = useWorkspace();
  const draft = resolveDraftRouteData(drafts, draftId);

  useEffect(() => {
    setActiveThreadId(null);
  }, [draftId, setActiveThreadId]);

  return (
    <div className="flex h-full w-full flex-col">
      <ChatHeader title={draft?.title ?? "Draft not found"} />
      <MessageTimeline messages={draft?.messages ?? []} />
      <Composer />
    </div>
  );
}
