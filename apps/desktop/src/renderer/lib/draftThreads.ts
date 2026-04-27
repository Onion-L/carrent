import type { Message } from "../mock/uiShellData";
import {
  DEFAULT_RUNTIME_MODE,
  type RuntimeMode,
} from "../../shared/runtimeMode";

export type DraftThreadRecord = {
  draftId: string;
  projectId: string;
  title: string;
  preallocatedThreadId: string;
  createdAt: string;
  runtimeMode?: RuntimeMode;
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

export function buildDraftThreadRecord(projectId: string, title: string): DraftThreadRecord | null {
  const nextTitle = title.trim();
  if (!nextTitle) {
    return null;
  }

  return {
    draftId: createId("draft"),
    projectId,
    title: nextTitle,
    preallocatedThreadId: createId("thread"),
    createdAt: new Date().toISOString(),
    runtimeMode: DEFAULT_RUNTIME_MODE,
    messages: [],
  };
}

export function createDraftThread(
  drafts: DraftThreadRecord[],
  projectId: string,
  title: string,
): CreateDraftThreadResult {
  const draft = buildDraftThreadRecord(projectId, title);
  if (!draft) {
    return {
      drafts,
      draft: null,
    };
  }

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

export function finalizePromotedDraftThreadByRef(drafts: DraftThreadRecord[], draftId: string) {
  return drafts.filter(
    (draft) => draft.draftId !== draftId || typeof draft.promotedToThreadId !== "string",
  );
}

export function setDraftThreadRuntimeMode(
  drafts: DraftThreadRecord[],
  draftId: string,
  runtimeMode: RuntimeMode,
) {
  return drafts.map((draft) =>
    draft.draftId === draftId ? { ...draft, runtimeMode } : draft,
  );
}
