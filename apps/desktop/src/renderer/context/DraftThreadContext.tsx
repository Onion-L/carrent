import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  buildDraftThreadRecord,
  finalizePromotedDraftThreadByRef as finalizeDraftThreadPromotion,
  markPromotedDraftThreadByRef as markDraftThreadPromotion,
  type DraftThreadRecord,
} from "../lib/draftThreads";
import type { Message } from "../mock/uiShellData";

export function getVerificationDraftById(draftId: string) {
  if (draftId !== "foo") {
    return null;
  }

  return {
    draftId: "foo",
    projectId: "project-1",
    title: "Draft thread",
    preallocatedThreadId: "draft-foo-thread",
    createdAt: "2026-04-25T00:00:00.000Z",
    messages: [
      {
        id: "draft-foo-message-1",
        role: "user",
        agentId: "architect",
        timestamp: "09:00",
        threadId: "draft-foo-thread",
        content: "Sketch the draft-first thread flow before promotion.",
      } satisfies Message,
    ],
  } satisfies DraftThreadRecord;
}

export type DraftThreadContextValue = {
  drafts: DraftThreadRecord[];
  createDraft: (projectId: string, title: string) => DraftThreadRecord | null;
  appendDraftMessage: (draftId: string, message: Message) => void;
  updateDraftMessage: (draftId: string, messageId: string, content: string) => void;
  markPromotedDraftThreadByRef: (draftId: string, realThreadId: string) => void;
  finalizePromotedDraftThreadByRef: (draftId: string) => void;
  getDraftById: (draftId: string) => DraftThreadRecord | null;
};

const DraftThreadContext = createContext<DraftThreadContextValue>({
  drafts: [],
  createDraft: () => null,
  appendDraftMessage: () => {},
  updateDraftMessage: () => {},
  markPromotedDraftThreadByRef: () => {},
  finalizePromotedDraftThreadByRef: () => {},
  getDraftById: () => null,
});

export function DraftThreadProvider({ children }: { children: ReactNode }) {
  const [drafts, setDrafts] = useState<DraftThreadRecord[]>([]);
  const draftsRef = useRef<DraftThreadRecord[]>([]);

  const updateDrafts = (
    updater: (currentDrafts: DraftThreadRecord[]) => DraftThreadRecord[],
  ) => {
    const nextDrafts = updater(draftsRef.current);
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    return nextDrafts;
  };

  const createDraft = (projectId: string, title: string) => {
    const draft = buildDraftThreadRecord(projectId, title);
    if (!draft) {
      return null;
    }

    updateDrafts((prev) => [...prev, draft]);

    return draft;
  };

  const appendDraftMessage = (draftId: string, message: Message) => {
    updateDrafts((prev) =>
      prev.map((draft) =>
        draft.draftId === draftId
          ? { ...draft, messages: [...draft.messages, message] }
          : draft,
      ),
    );
  };

  const updateDraftMessage = (
    draftId: string,
    messageId: string,
    content: string,
  ) => {
    updateDrafts((prev) =>
      prev.map((draft) =>
        draft.draftId === draftId
          ? {
              ...draft,
              messages: draft.messages.map((message) =>
                message.id === messageId ? { ...message, content } : message,
              ),
            }
          : draft,
      ),
    );
  };

  const markPromotedDraftThreadByRef = (
    draftId: string,
    realThreadId: string,
  ) => {
    updateDrafts((prev) =>
      markDraftThreadPromotion(prev, draftId, realThreadId),
    );
  };

  const finalizePromotedDraftThreadByRef = (draftId: string) => {
    updateDrafts((prev) => finalizeDraftThreadPromotion(prev, draftId));
  };

  const getDraftById = (draftId: string) =>
    draftsRef.current.find((draft) => draft.draftId === draftId) ??
    getVerificationDraftById(draftId);

  return (
    <DraftThreadContext.Provider
      value={{
        drafts,
        createDraft,
        appendDraftMessage,
        updateDraftMessage,
        markPromotedDraftThreadByRef,
        finalizePromotedDraftThreadByRef,
        getDraftById,
      }}
    >
      {children}
    </DraftThreadContext.Provider>
  );
}

export function useDraftThread() {
  return useContext(DraftThreadContext);
}
