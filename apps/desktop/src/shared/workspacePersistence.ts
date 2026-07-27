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
import { isRuntimeMode, normalizeRuntimeMode, type RuntimeMode } from "./runtimeMode";
import { normalizeRuntimeId } from "./runtimes";
import { runtimeIds, type RuntimeId } from "./runtimes";
import {
  normalizeRunChecklistEntries,
  type RunChecklistOutcome,
  type ThreadRunChecklist,
} from "./runChecklist";

export const WORKSPACE_SNAPSHOT_VERSION = 1;
export const APP_STATE_SNAPSHOT_VERSION = 1;

export type WorkspaceRecord = {
  id: string;
  name: string;
  order: number;
};

export type AppProjectRecord = {
  id: string;
  name: string;
  workingDirectory: string;
};

export type WorkspaceProjectAssociationRecord = {
  workspaceId: string;
  projectId: string;
  alias?: string;
  order: number;
  defaultRuntimeId: RuntimeId;
  defaultRuntimeModelId?: string;
  defaultRuntimeMode: RuntimeMode;
};

export type AppStateSnapshot = {
  version: typeof APP_STATE_SNAPSHOT_VERSION;
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  activeWorkspaceId: string | null;
};

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_PLAN_REVIEW_BYTES = 256 * 1024;
const MAX_PLAN_REVIEW_OPTIONS = 5;
const MAX_QUESTION_ITEMS = 10;
const MAX_QUESTION_TEXT_BYTES = 8 * 1024;
export const MAX_SUBAGENT_TASK_TEXT_LENGTH = 12_000;
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

export function normalizeProjectWorkingDirectory(value: string): string {
  const withForwardSlashes = value.replace(/\\/g, "/");
  const drive = withForwardSlashes.match(/^([A-Za-z]:)(?:\/|$)/)?.[1] ?? "";
  const isUnc = withForwardSlashes.startsWith("//");
  const isAbsolute = isUnc || withForwardSlashes.startsWith("/") || Boolean(drive);
  const segments: string[] = [];

  for (const segment of withForwardSlashes.slice(drive.length).split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length > 0 && segments.at(-1) !== "..") {
        segments.pop();
      } else if (!isAbsolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }

  const prefix = drive ? `${drive}/` : isUnc ? "//" : isAbsolute ? "/" : "";
  return `${prefix}${segments.join("/")}` || (isAbsolute ? prefix : "");
}

export function getProjectWorkingDirectoryIdentity(workingDirectory: string): string {
  const normalized = normalizeProjectWorkingDirectory(workingDirectory);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("//")
    ? normalized.toLocaleLowerCase()
    : normalized;
}

export function normalizeAppStateSnapshot(value: unknown): AppStateSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== APP_STATE_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(value.workspaces)) return null;
  if (value.projects !== undefined && !Array.isArray(value.projects)) return null;
  if (value.associations !== undefined && !Array.isArray(value.associations)) return null;
  if (typeof value.activeWorkspaceId !== "string" && value.activeWorkspaceId !== null) {
    return null;
  }

  const workspaces: WorkspaceRecord[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const orders = new Set<number>();

  for (const workspace of value.workspaces) {
    if (!isRecord(workspace)) return null;
    if (typeof workspace.id !== "string" || workspace.id.trim() !== workspace.id || !workspace.id) {
      return null;
    }
    if (
      typeof workspace.name !== "string" ||
      workspace.name.trim() !== workspace.name ||
      !workspace.name
    ) {
      return null;
    }
    const order = workspace.order;
    if (typeof order !== "number" || !Number.isInteger(order) || order < 0) return null;

    const normalizedName = workspace.name.toLocaleLowerCase();
    if (ids.has(workspace.id) || names.has(normalizedName) || orders.has(order)) {
      return null;
    }

    ids.add(workspace.id);
    names.add(normalizedName);
    orders.add(order);
    workspaces.push({
      id: workspace.id,
      name: workspace.name,
      order,
    });
  }

  if (orders.size > 0 && Math.max(...orders) !== orders.size - 1) return null;
  if (value.activeWorkspaceId !== null && !ids.has(value.activeWorkspaceId)) return null;

  const projects: AppProjectRecord[] = [];
  const projectIds = new Set<string>();
  const workingDirectories = new Set<string>();
  for (const project of value.projects ?? []) {
    if (!isRecord(project)) return null;
    if (typeof project.id !== "string" || project.id.trim() !== project.id || !project.id) {
      return null;
    }
    if (typeof project.name !== "string" || project.name.trim() !== project.name || !project.name) {
      return null;
    }
    if (typeof project.workingDirectory !== "string" || !project.workingDirectory) return null;

    const workingDirectory = normalizeProjectWorkingDirectory(project.workingDirectory);
    const workingDirectoryIdentity = getProjectWorkingDirectoryIdentity(workingDirectory);
    const isAbsoluteWorkingDirectory =
      workingDirectory.startsWith("/") || /^[A-Za-z]:\//.test(workingDirectory);
    if (
      !workingDirectory ||
      !isAbsoluteWorkingDirectory ||
      projectIds.has(project.id) ||
      workingDirectories.has(workingDirectoryIdentity)
    ) {
      return null;
    }

    projectIds.add(project.id);
    workingDirectories.add(workingDirectoryIdentity);
    projects.push({ id: project.id, name: project.name, workingDirectory });
  }

  const associations: WorkspaceProjectAssociationRecord[] = [];
  const associationKeys = new Set<string>();
  const associationOrders = new Map<string, Set<number>>();
  const associatedProjectIds = new Set<string>();
  for (const association of value.associations ?? []) {
    if (!isRecord(association)) return null;
    if (
      typeof association.workspaceId !== "string" ||
      !ids.has(association.workspaceId) ||
      typeof association.projectId !== "string" ||
      !projectIds.has(association.projectId)
    ) {
      return null;
    }
    if (
      association.alias !== undefined &&
      (typeof association.alias !== "string" ||
        association.alias.trim() !== association.alias ||
        !association.alias)
    ) {
      return null;
    }
    if (
      typeof association.order !== "number" ||
      !Number.isInteger(association.order) ||
      association.order < 0 ||
      !runtimeIds.includes(association.defaultRuntimeId as RuntimeId) ||
      !isRuntimeMode(association.defaultRuntimeMode)
    ) {
      return null;
    }
    if (
      association.defaultRuntimeModelId !== undefined &&
      (typeof association.defaultRuntimeModelId !== "string" ||
        association.defaultRuntimeModelId.trim() !== association.defaultRuntimeModelId ||
        !association.defaultRuntimeModelId)
    ) {
      return null;
    }

    const key = `${association.workspaceId}\u0000${association.projectId}`;
    const orders = associationOrders.get(association.workspaceId) ?? new Set<number>();
    if (associationKeys.has(key) || orders.has(association.order)) return null;

    associationKeys.add(key);
    orders.add(association.order);
    associationOrders.set(association.workspaceId, orders);
    associatedProjectIds.add(association.projectId);
    associations.push({
      workspaceId: association.workspaceId,
      projectId: association.projectId,
      ...(association.alias ? { alias: association.alias } : {}),
      order: association.order,
      defaultRuntimeId: association.defaultRuntimeId as RuntimeId,
      ...(association.defaultRuntimeModelId
        ? { defaultRuntimeModelId: association.defaultRuntimeModelId }
        : {}),
      defaultRuntimeMode: association.defaultRuntimeMode,
    });
  }

  for (const orders of associationOrders.values()) {
    if (orders.size > 0 && Math.max(...orders) !== orders.size - 1) return null;
  }
  if (projects.some((project) => !associatedProjectIds.has(project.id))) return null;

  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: workspaces.sort((left, right) => left.order - right.order),
    projects,
    associations,
    activeWorkspaceId: value.activeWorkspaceId,
  };
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeThreadRunChecklist(value: unknown): ThreadRunChecklist | null {
  if (!isRecord(value)) return null;
  if (typeof value.runId !== "string" || !value.runId.trim()) return null;
  if (!runtimeIds.includes(value.runtimeId as ThreadRunChecklist["runtimeId"])) return null;
  if (typeof value.expanded !== "boolean") return null;
  if (
    value.outcome !== "running" &&
    value.outcome !== "completed" &&
    value.outcome !== "failed" &&
    value.outcome !== "cancelled"
  ) {
    return null;
  }
  const entries = normalizeRunChecklistEntries(value.entries);
  if (!entries || entries.length === 0) return null;

  return {
    runId: value.runId,
    runtimeId: value.runtimeId as ThreadRunChecklist["runtimeId"],
    outcome: value.outcome as RunChecklistOutcome,
    expanded: value.expanded,
    entries,
  };
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

function normalizeQuestionPart(value: unknown): Extract<MessagePart, { type: "question" }> | null {
  if (!isRecord(value) || value.type !== "question") return null;
  if (typeof value.id !== "string" || typeof value.questionId !== "string") return null;
  if (!Array.isArray(value.questions) || value.questions.length > MAX_QUESTION_ITEMS) return null;

  const questions = value.questions.flatMap((item) => {
    if (!isRecord(item)) return [];
    if (typeof item.header !== "string" || typeof item.question !== "string") return [];
    if (
      new TextEncoder().encode(item.header).length > MAX_QUESTION_TEXT_BYTES ||
      new TextEncoder().encode(item.question).length > MAX_QUESTION_TEXT_BYTES
    ) {
      return [];
    }
    return [{ header: item.header, question: item.question }];
  });
  if (questions.length !== value.questions.length) return null;

  const validStatus =
    value.status === "pending" ||
    value.status === "answered" ||
    value.status === "skipped" ||
    value.status === "interrupted";
  if (!validStatus) return null;
  const status: Extract<MessagePart, { type: "question" }>["status"] =
    value.status === "pending"
      ? "interrupted"
      : (value.status as Extract<MessagePart, { type: "question" }>["status"]);

  let answers: Extract<MessagePart, { type: "question" }>["answers"];
  if (value.answers !== undefined) {
    if (!Array.isArray(value.answers)) return null;
    const normalized = value.answers.flatMap((item) => {
      if (!isRecord(item)) return [];
      if (
        typeof item.questionIndex !== "number" ||
        !Number.isInteger(item.questionIndex) ||
        item.questionIndex < 0 ||
        !Array.isArray(item.labels) ||
        item.labels.length > MAX_QUESTION_ITEMS ||
        item.labels.some((label) => typeof label !== "string")
      ) {
        return [];
      }
      if (
        item.customText !== undefined &&
        (typeof item.customText !== "string" ||
          new TextEncoder().encode(item.customText).length > MAX_QUESTION_TEXT_BYTES)
      ) {
        return [];
      }
      return [
        {
          questionIndex: item.questionIndex,
          labels: item.labels as string[],
          ...(typeof item.customText === "string" ? { customText: item.customText } : {}),
        },
      ];
    });
    if (normalized.length !== value.answers.length) return null;
    answers = normalized;
  }

  return {
    type: "question",
    id: value.id,
    questionId: value.questionId,
    status,
    questions,
    ...(answers ? { answers } : {}),
  };
}

function normalizeSubagentTaskPart(
  value: unknown,
): Extract<MessagePart, { type: "subagent_task" }> | null {
  if (!isRecord(value) || value.type !== "subagent_task") return null;
  if (typeof value.id !== "string" || !value.id) return null;
  if (value.runtimeId !== "kimi") return null;
  if (value.source !== "agent" && value.source !== "agent-swarm") return null;
  if (typeof value.description !== "string") return null;
  if (value.description.length > MAX_SUBAGENT_TASK_TEXT_LENGTH) return null;
  if (typeof value.background !== "boolean") return null;
  if (
    value.status !== "running" &&
    value.status !== "completed" &&
    value.status !== "failed" &&
    value.status !== "interrupted" &&
    value.status !== "detached"
  ) {
    return null;
  }
  if (
    typeof value.startedAt !== "number" ||
    !Number.isFinite(value.startedAt) ||
    value.startedAt < 0
  ) {
    return null;
  }
  if (
    value.finishedAt !== undefined &&
    (typeof value.finishedAt !== "number" ||
      !Number.isFinite(value.finishedAt) ||
      value.finishedAt < value.startedAt)
  ) {
    return null;
  }
  if (
    value.agentCount !== undefined &&
    (typeof value.agentCount !== "number" ||
      !Number.isInteger(value.agentCount) ||
      value.agentCount <= 0)
  ) {
    return null;
  }

  const optionalStrings = ["runtimeAgentId", "agentType", "prompt", "summary"] as const;
  for (const key of optionalStrings) {
    if (value[key] !== undefined && typeof value[key] !== "string") return null;
  }
  if (
    (typeof value.prompt === "string" && value.prompt.length > MAX_SUBAGENT_TASK_TEXT_LENGTH) ||
    (typeof value.summary === "string" && value.summary.length > MAX_SUBAGENT_TASK_TEXT_LENGTH)
  ) {
    return null;
  }

  const status: Extract<MessagePart, { type: "subagent_task" }>["status"] =
    value.status === "running"
      ? "interrupted"
      : (value.status as Extract<MessagePart, { type: "subagent_task" }>["status"]);

  return {
    type: "subagent_task",
    id: value.id,
    runtimeId: "kimi",
    source: value.source,
    description: value.description,
    background: value.background,
    status,
    startedAt: value.startedAt,
    ...(typeof value.runtimeAgentId === "string" ? { runtimeAgentId: value.runtimeAgentId } : {}),
    ...(typeof value.agentType === "string" ? { agentType: value.agentType } : {}),
    ...(typeof value.agentCount === "number" ? { agentCount: value.agentCount } : {}),
    ...(typeof value.prompt === "string" ? { prompt: value.prompt } : {}),
    ...(typeof value.summary === "string" ? { summary: value.summary } : {}),
    ...(typeof value.finishedAt === "number" ? { finishedAt: value.finishedAt } : {}),
  };
}

function normalizeMessageParts(value: unknown): MessagePart[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const parts = value.flatMap((item) => {
    if (isRecord(item) && item.type === "plan_review") {
      const normalized = normalizePlanReviewPart(item);
      return normalized ? [normalized] : [];
    }
    if (isRecord(item) && item.type === "question") {
      const normalized = normalizeQuestionPart(item);
      return normalized ? [normalized] : [];
    }
    if (isRecord(item) && item.type === "subagent_task") {
      const normalized = normalizeSubagentTaskPart(item);
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
      runChecklist?: unknown;
    },
  ): ThreadRecord {
    const runtimeModelId = normalizeOptionalString(thread.runtimeModelId);
    const lastActivityAt = normalizeOptionalString(thread.lastActivityAt);
    const validLastActivityAt =
      lastActivityAt && !Number.isNaN(Date.parse(lastActivityAt)) ? lastActivityAt : undefined;
    const runChecklist = normalizeThreadRunChecklist(thread.runChecklist);
    const {
      runtimeModelId: _runtimeModelId,
      lastActivityAt: _lastActivityAt,
      planMode: _planMode,
      runChecklist: _runChecklist,
      ...rest
    } = thread;

    return {
      ...(rest as Omit<ThreadRecord, "runtimeId" | "runtimeMode" | "runtimeModelId">),
      runtimeId: normalizeRuntimeId(thread.runtimeId),
      runtimeMode: normalizeRuntimeMode(thread.runtimeMode),
      planMode: thread.planMode === true,
      ...(runtimeModelId ? { runtimeModelId } : {}),
      ...(validLastActivityAt ? { lastActivityAt: validLastActivityAt } : {}),
      ...(runChecklist ? { runChecklist } : {}),
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
