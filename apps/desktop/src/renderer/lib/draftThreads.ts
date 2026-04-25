import type { Message } from "../mock/uiShellData";

export type DraftThreadRecord = {
  draftId: string;
  projectId: string;
  title: string;
  preallocatedThreadId: string;
  createdAt: string;
  promotedToThreadId?: string;
  messages: Message[];
};

type CreateDraftThreadResult = {
  drafts: DraftThreadRecord[];
  draft: DraftThreadRecord | null;
};

function createId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export function createDraftThread(
  drafts: DraftThreadRecord[],
  projectId: string,
  title: string,
): CreateDraftThreadResult {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return {
      drafts,
      draft: null,
    };
  }

  const draft: DraftThreadRecord = {
    draftId: createId("draft"),
    projectId,
    title: nextTitle,
    preallocatedThreadId: createId("thread"),
    createdAt: new Date().toISOString(),
    messages: [],
  };

  return {
    drafts: [...drafts, draft],
    draft,
  };
}

export function markPromotedDraftThreadByRef(
  drafts: DraftThreadRecord[],
  draftId: string,
  realThreadId: string,
) {
  return drafts.map((draft) =>
    draft.draftId === draftId
      ? {
          ...draft,
          promotedToThreadId: realThreadId,
        }
      : draft,
  );
}

export function finalizePromotedDraftThreadByRef(
  drafts: DraftThreadRecord[],
  draftId: string,
) {
  return drafts.filter(
    (draft) =>
      draft.draftId !== draftId || typeof draft.promotedToThreadId !== "string",
  );
}
