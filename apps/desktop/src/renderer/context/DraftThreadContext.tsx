import { createContext, useContext, type ReactNode } from "react";

import { applyMessagePartUpdate, type MessagePartUpdate, useWorkspace } from "./WorkspaceContext";
import {
  buildDraftThreadRecord,
  finalizePromotedDraftThreadByRef as finalizeDraftThreadPromotion,
  markPromotedDraftThreadByRef as markDraftThreadPromotion,
  setDraftThreadRuntimeMode,
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
  createDraft: (projectId: string) => DraftThreadRecord | null;
  appendDraftMessage: (draftId: string, message: Message) => void;
  updateDraftMessage: (draftId: string, messageId: string, content: string) => void;
  updateDraftMessageParts: (draftId: string, messageId: string, update: MessagePartUpdate) => void;
  markPromotedDraftThreadByRef: (draftId: string, realThreadId: string) => void;
  finalizePromotedDraftThreadByRef: (draftId: string) => void;
  getDraftById: (draftId: string) => DraftThreadRecord | null;
  setDraftRuntimeMode: (draftId: string, runtimeMode: import("../../shared/runtimeMode").RuntimeMode) => void;
};

const DraftThreadContext = createContext<DraftThreadContextValue>({
  drafts: [],
  createDraft: () => null,
  appendDraftMessage: () => {},
  updateDraftMessage: () => {},
  updateDraftMessageParts: () => {},
  markPromotedDraftThreadByRef: () => {},
  finalizePromotedDraftThreadByRef: () => {},
  getDraftById: () => null,
  setDraftRuntimeMode: () => {},
});

export function DraftThreadProvider({ children }: { children: ReactNode }) {
  const { drafts, setDrafts } = useWorkspace();

  const updateDrafts = (updater: (currentDrafts: DraftThreadRecord[]) => DraftThreadRecord[]) => {
    setDrafts(updater);
  };

  const createDraft = (projectId: string) => {
    const draft = buildDraftThreadRecord(projectId, "New thread");
    if (!draft) {
      return null;
    }

    updateDrafts((prev) => [...prev, draft]);

    return draft;
  };

  const appendDraftMessage = (draftId: string, message: Message) => {
    updateDrafts((prev) =>
      prev.map((draft) =>
        draft.draftId === draftId ? { ...draft, messages: [...draft.messages, message] } : draft,
      ),
    );
  };

  const updateDraftMessage = (draftId: string, messageId: string, content: string) => {
    updateDrafts((prev) =>
      prev.map((draft) =>
        draft.draftId === draftId
          ? {
              ...draft,
              messages: draft.messages.map((message) =>
                message.id === messageId && message.type !== "changed_files"
                  ? { ...message, content, parts: undefined }
                  : message,
              ),
            }
          : draft,
      ),
    );
  };

  const updateDraftMessageParts = (
    draftId: string,
    messageId: string,
    update: MessagePartUpdate,
  ) => {
    updateDrafts((prev) =>
      prev.map((draft) =>
        draft.draftId === draftId
          ? {
              ...draft,
              messages: draft.messages.map((message) =>
                message.id === messageId ? applyMessagePartUpdate(message, update) : message,
              ),
            }
          : draft,
      ),
    );
  };

  const markPromotedDraftThreadByRef = (draftId: string, realThreadId: string) => {
    updateDrafts((prev) => markDraftThreadPromotion(prev, draftId, realThreadId));
  };

  const finalizePromotedDraftThreadByRef = (draftId: string) => {
    updateDrafts((prev) => finalizeDraftThreadPromotion(prev, draftId));
  };

  const setDraftRuntimeMode = (draftId: string, runtimeMode: import("../../shared/runtimeMode").RuntimeMode) => {
    updateDrafts((current) =>
      setDraftThreadRuntimeMode(current, draftId, runtimeMode),
    );
  };

  const getDraftById = (draftId: string) =>
    drafts.find((draft) => draft.draftId === draftId) ?? getVerificationDraftById(draftId);

  return (
    <DraftThreadContext.Provider
      value={{
        drafts,
        createDraft,
        appendDraftMessage,
        updateDraftMessage,
        updateDraftMessageParts,
        markPromotedDraftThreadByRef,
        finalizePromotedDraftThreadByRef,
        getDraftById,
        setDraftRuntimeMode,
      }}
    >
      {children}
    </DraftThreadContext.Provider>
  );
}

export function useDraftThread() {
  return useContext(DraftThreadContext);
}
