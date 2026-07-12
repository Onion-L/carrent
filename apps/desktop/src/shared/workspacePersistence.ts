import type {
  ChangedFile,
  ChangedFilesMessage,
  Message,
  ProjectRecord,
  ThreadRecord,
} from "../renderer/mock/uiShellData";
import type { ImageAttachmentMetadata } from "./chat";
import { normalizeRuntimeMode } from "./runtimeMode";
import { normalizeRuntimeId } from "./runtimes";

export const WORKSPACE_SNAPSHOT_VERSION = 1;

const MAX_PATCH_BYTES = 256 * 1024;

export type WorkspaceSnapshot = {
  version: typeof WORKSPACE_SNAPSHOT_VERSION;
  projects: ProjectRecord[];
  chats: ThreadRecord[];
  messages: Message[];
  activeThreadId: string | null;
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

function normalizeChangedFile(value: unknown): ChangedFile | null {
  if (!isRecord(value)) return null;
  if (typeof value.path !== "string") return null;
  if (typeof value.additions !== "number" || !Number.isFinite(value.additions)) return null;
  if (typeof value.deletions !== "number" || !Number.isFinite(value.deletions)) return null;
  if (value.binary !== undefined && typeof value.binary !== "boolean") return null;
  if (value.untracked !== undefined && typeof value.untracked !== "boolean") return null;

  const file: ChangedFile = {
    path: value.path,
    additions: value.additions,
    deletions: value.deletions,
    binary: value.binary === true,
    untracked: value.untracked === true,
  };

  if (value.omitted === true) {
    file.omitted = true;
  }

  if (typeof value.isFolder === "boolean") {
    file.isFolder = value.isFolder;
  }

  if (
    value.fileType === "swift" ||
    value.fileType === "markdown" ||
    value.fileType === "other"
  ) {
    file.fileType = value.fileType;
  }

  return file;
}

function normalizeChangedFilesSnapshot(
  value: unknown,
): ChangedFilesMessage["snapshot"] | null {
  if (!isRecord(value)) return null;
  if (typeof value.baseRevision !== "string") return null;
  if (typeof value.capturedAt !== "string") return null;
  if (typeof value.patch !== "string") return null;
  if (typeof value.truncated !== "boolean") return null;

  const patchBytes = new TextEncoder().encode(value.patch).length;
  if (patchBytes > MAX_PATCH_BYTES) return null;

  return {
    baseRevision: value.baseRevision,
    capturedAt: value.capturedAt,
    patch: value.patch,
    truncated: value.truncated,
  };
}

function normalizeMessageRecord(message: Message): Message {
  const record = message as Message & { attachments?: unknown };

  if (record.type === "changed_files") {
    const changedFilesRecord = record as ChangedFilesMessage & { changedFiles?: unknown };
    const normalizedFiles = Array.isArray(changedFilesRecord.changedFiles)
      ? changedFilesRecord.changedFiles
          .map((file) => normalizeChangedFile(file))
          .filter((file): file is ChangedFile => file !== null)
      : [];

    const normalizedSnapshot = normalizeChangedFilesSnapshot(changedFilesRecord.snapshot);
    const { snapshot: _oldSnapshot, ...recordWithoutSnapshot } = changedFilesRecord;

    const normalized: ChangedFilesMessage = {
      ...recordWithoutSnapshot,
      changedFiles: normalizedFiles,
      ...(normalizedSnapshot ? { snapshot: normalizedSnapshot } : {}),
    };

    return normalized as Message;
  }

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
  if (typeof value.activeThreadId !== "string" && value.activeThreadId !== null) return null;

  const chats = value.chats === undefined ? [] : value.chats;
  if (!Array.isArray(chats)) return null;

  const snapshot = value as WorkspaceSnapshot;
  function normalizeThreadRecord(
    thread: ThreadRecord & {
      runtimeId?: unknown;
      runtimeMode?: unknown;
      runtimeModelId?: unknown;
      lastActivityAt?: unknown;
    },
  ): ThreadRecord {
    const runtimeModelId = normalizeOptionalString(thread.runtimeModelId);
    const lastActivityAt = normalizeOptionalString(thread.lastActivityAt);
    const validLastActivityAt =
      lastActivityAt && !Number.isNaN(Date.parse(lastActivityAt)) ? lastActivityAt : undefined;
    const { runtimeModelId: _runtimeModelId, lastActivityAt: _lastActivityAt, ...rest } = thread;

    return {
      ...(rest as Omit<ThreadRecord, "runtimeId" | "runtimeMode" | "runtimeModelId">),
      runtimeId: normalizeRuntimeId(thread.runtimeId),
      runtimeMode: normalizeRuntimeMode(thread.runtimeMode),
      ...(runtimeModelId ? { runtimeModelId } : {}),
      ...(validLastActivityAt ? { lastActivityAt: validLastActivityAt } : {}),
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
