import { useEffect } from "react";
import { useParams } from "react-router-dom";

import { ChatHeader } from "../components/chat/ChatHeader";
import { Composer } from "../components/chat/Composer";
import { MessageTimeline } from "../components/chat/MessageTimeline";
import { useDraftThread } from "../context/DraftThreadContext";
import { useWorkspace } from "../context/WorkspaceContext";

export function DraftThreadPage() {
  const { draftId } = useParams();
  const { getDraftById } = useDraftThread();
  const { setActiveThreadId } = useWorkspace();
  const draft = draftId ? getDraftById(draftId) : null;

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
