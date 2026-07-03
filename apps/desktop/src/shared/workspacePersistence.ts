import type { DraftThreadRecord } from "../renderer/lib/draftThreads";
import type { Message, ProjectRecord, ThreadRecord } from "../renderer/mock/uiShellData";
import type { ImageAttachmentMetadata } from "./chat";
import { normalizeRuntimeMode } from "./runtimeMode";
import { normalizeRuntimeId } from "./runtimes";

export const WORKSPACE_SNAPSHOT_VERSION = 1;

export type WorkspaceSnapshot = {
  version: typeof WORKSPACE_SNAPSHOT_VERSION;
  projects: ProjectRecord[];
  chats: ThreadRecord[];
  messages: Message[];
  activeThreadId: string | null;
  drafts: DraftThreadRecord[];
};

export type ProviderSessionSnapshot = {
  version: 1;
  sessions: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeImageAttachmentMetadata(value: unknown): ImageAttachmentMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.name !== "string") return null;
  if (typeof value.mimeType !== "string") return null;
  if (typeof value.size !== "number") return null;
  if (typeof value.storageKey !== "string") return null;

  return {
    id: value.id,
    name: value.name,
    mimeType: value.mimeType,
    size: value.size,
    storageKey: value.storageKey,
    ...(typeof value.width === "number" ? { width: value.width } : {}),
    ...(typeof value.height === "number" ? { height: value.height } : {}),
  };
}

function normalizeMessageRecord(message: Message): Message {
  const record = message as Message & { attachments?: unknown };
  if (!Array.isArray(record.attachments)) {
    return message;
  }

  return {
    ...message,
    attachments: record.attachments
      .map((attachment) => normalizeImageAttachmentMetadata(attachment))
      .filter((attachment): attachment is ImageAttachmentMetadata => attachment !== null),
  } as Message;
}

export function normalizeWorkspaceSnapshot(value: unknown): WorkspaceSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== WORKSPACE_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(value.projects)) return null;
  if (!Array.isArray(value.messages)) return null;
  if (!Array.isArray(value.drafts)) return null;
  if (typeof value.activeThreadId !== "string" && value.activeThreadId !== null) return null;

  const chats = value.chats === undefined ? [] : value.chats;
  if (!Array.isArray(chats)) return null;

  const snapshot = value as WorkspaceSnapshot;
  function normalizeThreadRecord(
    thread: ThreadRecord & { runtimeId?: unknown; runtimeMode?: unknown; runtimeModelId?: unknown },
  ): ThreadRecord {
    const runtimeModelId = normalizeOptionalString(thread.runtimeModelId);
    const { runtimeModelId: _runtimeModelId, ...rest } = thread;

    return {
      ...(rest as Omit<ThreadRecord, "runtimeId" | "runtimeMode" | "runtimeModelId">),
      runtimeId: normalizeRuntimeId(thread.runtimeId),
      runtimeMode: normalizeRuntimeMode(thread.runtimeMode),
      ...(runtimeModelId ? { runtimeModelId } : {}),
    };
  }

  return {
    ...snapshot,
    projects: snapshot.projects.map((project) => ({
      ...project,
      threads: project.threads.map(normalizeThreadRecord),
    })),
    chats: chats.map(normalizeThreadRecord),
    messages: snapshot.messages.map(normalizeMessageRecord),
    drafts: snapshot.drafts.map((draft) => {
      const runtimeModelId = normalizeOptionalString(draft.runtimeModelId);
      const { runtimeModelId: _runtimeModelId, ...rest } = draft;

      return {
        ...(rest as Omit<DraftThreadRecord, "runtimeId" | "runtimeMode" | "runtimeModelId">),
        runtimeId: normalizeRuntimeId(draft.runtimeId),
        runtimeMode: normalizeRuntimeMode(draft.runtimeMode),
        messages: draft.messages.map(normalizeMessageRecord),
        ...(runtimeModelId ? { runtimeModelId } : {}),
      } satisfies DraftThreadRecord;
    }),
  };
}

export function normalizeProviderSessionSnapshot(value: unknown): ProviderSessionSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (!isRecord(value.sessions)) return null;

  const sessions: Record<string, string> = {};
  for (const [key, sessionId] of Object.entries(value.sessions)) {
    if (typeof sessionId === "string") {
      sessions[key] = sessionId;
    }
  }

  return { version: 1, sessions };
}
