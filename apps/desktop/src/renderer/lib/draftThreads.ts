import type { Message } from "../mock/uiShellData";
import { DEFAULT_RUNTIME_MODE, type RuntimeMode } from "../../shared/runtimeMode";
import { DEFAULT_RUNTIME_ID, type RuntimeId } from "../../shared/runtimes";

export type DraftThreadRecord = {
  draftId: string;
  projectId: string;
  title: string;
  preallocatedThreadId: string;
  createdAt: string;
  runtimeId?: RuntimeId;
  runtimeModelId?: string;
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

export function buildDraftThreadRecord(
  projectId: string,
  title: string,
  runtimeId: RuntimeId = DEFAULT_RUNTIME_ID,
  runtimeModelId?: string,
): DraftThreadRecord | null {
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
    runtimeId,
    runtimeModelId,
    runtimeMode: DEFAULT_RUNTIME_MODE,
    messages: [],
  };
}

export function createDraftThread(
  drafts: DraftThreadRecord[],
  projectId: string,
  title: string,
  runtimeId: RuntimeId = DEFAULT_RUNTIME_ID,
  runtimeModelId?: string,
): CreateDraftThreadResult {
  const draft = buildDraftThreadRecord(projectId, title, runtimeId, runtimeModelId);
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
  return drafts.map((draft) => (draft.draftId === draftId ? { ...draft, runtimeMode } : draft));
}

export function setDraftThreadRuntimeId(
  drafts: DraftThreadRecord[],
  draftId: string,
  runtimeId: RuntimeId,
) {
  return drafts.map((draft) => (draft.draftId === draftId ? { ...draft, runtimeId } : draft));
}

export function setDraftThreadRuntimeModelId(
  drafts: DraftThreadRecord[],
  draftId: string,
  runtimeModelId: string | undefined,
) {
  return drafts.map((draft) => (draft.draftId === draftId ? { ...draft, runtimeModelId } : draft));
}
