import type {
  ChangedFile,
  ChangedFilesMessage,
  Message,
  MessagePart,
  ProjectRecord,
  ThreadRecord,
} from "../renderer/mock/uiShellData";
import type { AttachmentKind, AttachmentMetadata } from "./chat";
import { isSupportedImageMimeType, MAX_ATTACHMENT_COUNT } from "./attachment";
import type { ChatPermissionOption } from "./chatPermissions";
import { normalizeRuntimeMode } from "./runtimeMode";
import { normalizeRuntimeId } from "./runtimes";

export const WORKSPACE_SNAPSHOT_VERSION = 1;

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_PLAN_REVIEW_BYTES = 256 * 1024;
const MAX_PLAN_REVIEW_OPTIONS = 5;
const MAX_THREAD_WORK_TEXT_BYTES = 256 * 1024;
const MAX_THREAD_WORK_QUEUE_ITEMS = 50;

export type ThreadWorkDraftSnapshot = {
  content: string;
  attachedSkillNames: string[];
  attachments: AttachmentMetadata[];
};

export type ThreadWorkQueuedMessage = {
  id: string;
  content: string;
  attachments?: AttachmentMetadata[];
  requiresConfirmation?: boolean;
};

export type ThreadWorkSnapshot = {
  draft?: ThreadWorkDraftSnapshot;
  queuedMessages: ThreadWorkQueuedMessage[];
};

export type WorkspaceSnapshot = {
  version: typeof WORKSPACE_SNAPSHOT_VERSION;
  projects: ProjectRecord[];
  chats: ThreadRecord[];
  messages: Message[];
  activeThreadId: string | null;
  threadWork?: Record<string, ThreadWorkSnapshot>;
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

function normalizeAttachmentMetadata(value: unknown): AttachmentMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.name !== "string") return null;
  if (typeof value.mimeType !== "string") return null;
  if (typeof value.size !== "number") return null;
  if (typeof value.storageKey !== "string") return null;

  let kind: AttachmentKind;
  if (value.kind === "image" || value.kind === "file") {
    kind = value.kind;
  } else if (isSupportedImageMimeType(value.mimeType)) {
    // Legacy snapshots predate `kind`; only the original image types backfill.
    kind = "image";
  } else {
    return null;
  }

  return {
    id: value.id,
    kind,
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

  if (value.fileType === "swift" || value.fileType === "markdown" || value.fileType === "other") {
    file.fileType = value.fileType;
  }

  return file;
}

function normalizeChangedFilesSnapshot(value: unknown): ChangedFilesMessage["snapshot"] | null {
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

function normalizePlanReviewPart(
  value: unknown,
): Extract<MessagePart, { type: "plan_review" }> | null {
  if (!isRecord(value) || value.type !== "plan_review") return null;
  if (typeof value.id !== "string" || typeof value.permissionId !== "string") return null;
  if (typeof value.content !== "string") return null;
  if (new TextEncoder().encode(value.content).length > MAX_PLAN_REVIEW_BYTES) return null;
  if (!Array.isArray(value.options) || value.options.length > MAX_PLAN_REVIEW_OPTIONS) return null;

  const options: ChatPermissionOption[] = value.options.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.optionId !== "string" || typeof item.name !== "string") return [];
    if (item.kind !== "allow_once" && item.kind !== "allow_always" && item.kind !== "reject_once") {
      return [];
    }
    return [{ optionId: item.optionId, name: item.name, kind: item.kind }];
  });
  if (options.length !== value.options.length) return null;

  const validStatus =
    value.status === "pending" ||
    value.status === "approved" ||
    value.status === "revision-requested" ||
    value.status === "rejected" ||
    value.status === "interrupted";
  if (!validStatus) return null;
  const status: Extract<MessagePart, { type: "plan_review" }>["status"] =
    value.status === "pending"
      ? "interrupted"
      : (value.status as Extract<MessagePart, { type: "plan_review" }>["status"]);

  return {
    type: "plan_review",
    id: value.id,
    permissionId: value.permissionId,
    content: value.content,
    status,
    options,
    ...(typeof value.selectedOptionId === "string"
      ? { selectedOptionId: value.selectedOptionId }
      : {}),
    ...(typeof value.selectedOptionName === "string"
      ? { selectedOptionName: value.selectedOptionName }
      : {}),
  };
}

function normalizeMessageParts(value: unknown): MessagePart[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const parts = value.flatMap((item) => {
    if (isRecord(item) && item.type === "plan_review") {
      const normalized = normalizePlanReviewPart(item);
      return normalized ? [normalized] : [];
    }
    return [item as MessagePart];
  });
  return parts.length > 0 ? parts : undefined;
}

function normalizeMessageRecord(message: Message): Message {
  const record = message as Message & { attachments?: unknown; parts?: unknown };

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

  const normalizedParts = normalizeMessageParts(record.parts);
  const normalizedAttachments = Array.isArray(record.attachments)
    ? record.attachments
        .map((attachment) => normalizeAttachmentMetadata(attachment))
        .filter((attachment): attachment is AttachmentMetadata => attachment !== null)
    : undefined;

  const { parts: _parts, attachments: _attachments, ...rest } = record;

  return {
    ...rest,
    ...(normalizedParts ? { parts: normalizedParts } : {}),
    ...(normalizedAttachments ? { attachments: normalizedAttachments } : {}),
  } as Message;
}

function utf8ByteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

function normalizeThreadWorkAttachments(value: unknown): AttachmentMetadata[] | null {
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENT_COUNT) return null;
  const attachments = value.map((item) => normalizeAttachmentMetadata(item));
  if (attachments.some((attachment) => attachment === null)) return null;
  return attachments as AttachmentMetadata[];
}

function normalizeThreadWorkDraft(value: unknown): ThreadWorkDraftSnapshot | null {
  if (!isRecord(value)) return null;
  if (typeof value.content !== "string") return null;
  if (utf8ByteLength(value.content) > MAX_THREAD_WORK_TEXT_BYTES) return null;
  if (!Array.isArray(value.attachedSkillNames)) return null;
  if (!value.attachedSkillNames.every((name) => typeof name === "string")) return null;

  const attachments = normalizeThreadWorkAttachments(value.attachments ?? []);
  if (!attachments) return null;

  return {
    content: value.content,
    attachedSkillNames: [...value.attachedSkillNames],
    attachments,
  };
}

function normalizeThreadWorkQueuedMessage(value: unknown): ThreadWorkQueuedMessage | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.content !== "string") return null;
  if (utf8ByteLength(value.content) > MAX_THREAD_WORK_TEXT_BYTES) return null;

  const attachments =
    value.attachments === undefined ? undefined : normalizeThreadWorkAttachments(value.attachments);
  if (attachments === null) return null;

  // Every queue item recovered from disk requires an explicit Send/Steer; it
  // must never auto-send after a restart.
  return {
    id: value.id,
    content: value.content,
    ...(attachments && attachments.length > 0 ? { attachments } : {}),
    requiresConfirmation: true,
  };
}

function normalizeThreadWork(value: unknown): Record<string, ThreadWorkSnapshot> | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return {};

  const threadWork: Record<string, ThreadWorkSnapshot> = {};
  for (const [threadId, entry] of Object.entries(value)) {
    if (!isRecord(entry)) continue;

    const draft = entry.draft === undefined ? null : normalizeThreadWorkDraft(entry.draft);
    const queuedMessages = Array.isArray(entry.queuedMessages)
      ? entry.queuedMessages
          .map((item) => normalizeThreadWorkQueuedMessage(item))
          .filter((item): item is ThreadWorkQueuedMessage => item !== null)
          .slice(0, MAX_THREAD_WORK_QUEUE_ITEMS)
      : [];

    threadWork[threadId] = {
      ...(draft ? { draft } : {}),
      queuedMessages,
    };
  }
  return threadWork;
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
      planMode?: unknown;
    },
  ): ThreadRecord {
    const runtimeModelId = normalizeOptionalString(thread.runtimeModelId);
    const lastActivityAt = normalizeOptionalString(thread.lastActivityAt);
    const validLastActivityAt =
      lastActivityAt && !Number.isNaN(Date.parse(lastActivityAt)) ? lastActivityAt : undefined;
    const {
      runtimeModelId: _runtimeModelId,
      lastActivityAt: _lastActivityAt,
      planMode: _planMode,
      ...rest
    } = thread;

    return {
      ...(rest as Omit<ThreadRecord, "runtimeId" | "runtimeMode" | "runtimeModelId">),
      runtimeId: normalizeRuntimeId(thread.runtimeId),
      runtimeMode: normalizeRuntimeMode(thread.runtimeMode),
      planMode: thread.planMode === true,
      ...(runtimeModelId ? { runtimeModelId } : {}),
      ...(validLastActivityAt ? { lastActivityAt: validLastActivityAt } : {}),
    };
  }

  const threadWork = normalizeThreadWork(value.threadWork);

  return {
    ...snapshot,
    projects: snapshot.projects.map((project) => ({
      ...project,
      threads: project.threads.map(normalizeThreadRecord),
    })),
    chats: chats.map(normalizeThreadRecord),
    messages: snapshot.messages.map(normalizeMessageRecord),
    ...(threadWork ? { threadWork } : {}),
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
