import type { ChangedFile, ChangedFilesMessage, Message, MessagePart } from "./threadContent";
import type { AttachmentKind, AttachmentMetadata } from "./chat";
import {
  isSupportedImageMimeType,
  isValidAttachmentSha256,
  MAX_ATTACHMENT_COUNT,
} from "./attachment";
import type { ChatPermissionOption } from "./chatPermissions";
import { isRuntimeMode, type RuntimeMode } from "./runtimeMode";
import { runtimeIds, type RuntimeId } from "./runtimes";
import {
  normalizeRunChecklistEntries,
  type RunChecklistOutcome,
  type ThreadRunChecklist,
} from "./runChecklist";

const LEGACY_WORKSPACE_SNAPSHOT_VERSION = 1;
export const APP_STATE_SNAPSHOT_VERSION = 1;

export type AppStateRecoveryStage =
  | "read"
  | "parse"
  | "schema-version"
  | "validate"
  | "legacy-detection"
  | "reset-stage"
  | "reset-write"
  | "reset-cleanup";

export type AppStateDiagnostic = {
  appVersion: string;
  subsystem: "app-state";
  stage: AppStateRecoveryStage;
  summary: string;
  dataPath: string;
  occurredAt: string;
};

export type AppStateLoadResult =
  | {
      status: "ready";
      snapshot: AppStateSnapshot;
      notice?: "legacy-reset" | "full-reset";
    }
  | {
      status: "recovery-required";
      diagnostics: AppStateDiagnostic[];
    };

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

export type AppThreadRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  title: string;
  createdAt: string;
  lastActivityAt: string;
  archived?: boolean;
  pinned?: boolean;
  runtimeId: RuntimeId;
  runtimeModelId?: string;
  runtimeMode: RuntimeMode;
  planMode: boolean;
  runChecklist?: ThreadRunChecklist;
};

export type AssociationThreadDraftRecord = {
  id: string;
  threadId: string;
  workspaceId: string;
  projectId: string;
  content: string;
  attachedSkillNames: string[];
  attachments: AttachmentMetadata[];
  runtimeId: RuntimeId;
  runtimeModelId?: string;
  runtimeMode: RuntimeMode;
  planMode: boolean;
};

type PersistedMessage = Message<{ timestamp?: string }>;

export type AppThreadMessageRecord = PersistedMessage & {
  content: string;
  createdAt: string;
  attachments: AttachmentMetadata[];
};

export type AppThreadRunRecord = {
  id: string;
  threadId: string;
  messageId: string;
  startedAt: string;
  runtimeId: RuntimeId;
  runtimeModelId?: string;
  runtimeMode: RuntimeMode;
  planMode: boolean;
};

export type AppThreadActionRecord = {
  id: string;
  threadId: string;
  action: "compact";
  runtimeId: RuntimeId;
  completedAt: string;
};

export type AppThreadRunStartInput = {
  runId: string;
  messageId: string;
  message: string;
  attachments: AttachmentMetadata[];
  startedAt: string;
  runtimeId: RuntimeId;
  runtimeModelId?: string;
  runtimeMode: RuntimeMode;
  planMode: boolean;
};

export type AppThreadPromotionIntentRecord = AppThreadRunStartInput & {
  draftId: string;
  threadId: string;
  workspaceId: string;
  projectId: string;
  title: string;
};

export type AppStateSnapshot = {
  version: typeof APP_STATE_SNAPSHOT_VERSION;
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  threads?: AppThreadRecord[];
  threadDrafts?: AssociationThreadDraftRecord[];
  threadMessages?: AppThreadMessageRecord[];
  threadRuns?: AppThreadRunRecord[];
  threadActions?: AppThreadActionRecord[];
  threadPromotionIntents?: AppThreadPromotionIntentRecord[];
  threadWork?: Record<string, ThreadWorkSnapshot>;
  lastThreadIdByWorkspace?: Record<string, string>;
  activeWorkspaceId: string | null;
};

export function createEmptyAppStateSnapshot(): AppStateSnapshot {
  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: [],
    projects: [],
    associations: [],
    threads: [],
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    threadActions: [],
    threadPromotionIntents: [],
    threadWork: {},
    lastThreadIdByWorkspace: {},
    activeWorkspaceId: null,
  };
}

const MAX_PATCH_BYTES = 256 * 1024;
const MAX_PLAN_REVIEW_BYTES = 256 * 1024;
const MAX_PLAN_REVIEW_OPTIONS = 5;
const MAX_THREAD_ACTIONS = 10_000;
const MAX_THREAD_ACTION_ID_CHARS = 256;
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

export type ProviderSessionSnapshot = {
  version: 1;
  sessions: Record<string, string>;
};

export type ProjectRelocationResult = {
  appState: AppStateSnapshot;
};

export type ProjectRelocationRequest = {
  projectId: string;
  targetDirectory: string;
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
  return normalizeAppStateSnapshotWithAttachmentPolicy(value, true);
}

export function normalizeAppStateSnapshotForWrite(value: unknown): AppStateSnapshot | null {
  return normalizeAppStateSnapshotWithAttachmentPolicy(value, false);
}

function normalizeAppStateSnapshotWithAttachmentPolicy(
  value: unknown,
  allowLegacyAttachmentKindInference: boolean,
): AppStateSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== APP_STATE_SNAPSHOT_VERSION) return null;
  if (!Array.isArray(value.workspaces)) return null;
  if (value.projects !== undefined && !Array.isArray(value.projects)) return null;
  if (value.associations !== undefined && !Array.isArray(value.associations)) return null;
  if (value.threads !== undefined && !Array.isArray(value.threads)) return null;
  if (value.threadDrafts !== undefined && !Array.isArray(value.threadDrafts)) return null;
  if (value.threadMessages !== undefined && !Array.isArray(value.threadMessages)) return null;
  if (value.threadRuns !== undefined && !Array.isArray(value.threadRuns)) return null;
  if (value.threadWork !== undefined && !isRecord(value.threadWork)) return null;
  if (value.threadPromotionIntents !== undefined && !Array.isArray(value.threadPromotionIntents)) {
    return null;
  }
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

  const threads: AppThreadRecord[] = [];
  const threadIds = new Set<string>();
  for (const thread of value.threads ?? []) {
    if (!isRecord(thread)) return null;
    const associationKey = `${thread.workspaceId}\u0000${thread.projectId}`;
    if (
      typeof thread.id !== "string" ||
      !thread.id ||
      thread.id.trim() !== thread.id ||
      threadIds.has(thread.id) ||
      typeof thread.workspaceId !== "string" ||
      typeof thread.projectId !== "string" ||
      !associationKeys.has(associationKey) ||
      typeof thread.title !== "string" ||
      !thread.title ||
      thread.title.trim() !== thread.title ||
      !isIsoTimestamp(thread.createdAt) ||
      !isIsoTimestamp(thread.lastActivityAt) ||
      (thread.archived !== undefined && typeof thread.archived !== "boolean") ||
      (thread.pinned !== undefined && typeof thread.pinned !== "boolean") ||
      !runtimeIds.includes(thread.runtimeId as RuntimeId) ||
      !isRuntimeMode(thread.runtimeMode) ||
      typeof thread.planMode !== "boolean"
    ) {
      return null;
    }
    const runtimeModelId = normalizePersistedModelId(thread.runtimeModelId);
    if (thread.runtimeModelId !== undefined && !runtimeModelId) return null;
    const runChecklist = normalizeThreadRunChecklist(thread.runChecklist);
    if (thread.runChecklist !== undefined && !runChecklist) return null;

    threadIds.add(thread.id);
    threads.push({
      id: thread.id,
      workspaceId: thread.workspaceId,
      projectId: thread.projectId,
      title: thread.title,
      createdAt: thread.createdAt,
      lastActivityAt: thread.lastActivityAt,
      ...(thread.archived === true ? { archived: true } : {}),
      ...(thread.pinned === true ? { pinned: true } : {}),
      runtimeId: thread.runtimeId as RuntimeId,
      ...(runtimeModelId ? { runtimeModelId } : {}),
      runtimeMode: thread.runtimeMode,
      planMode: thread.planMode,
      ...(runChecklist ? { runChecklist } : {}),
    });
  }

  const lastThreadIdByWorkspace: Record<string, string> = {};
  const persistedLastThreadIds = isRecord(value.lastThreadIdByWorkspace)
    ? value.lastThreadIdByWorkspace
    : {};
  for (const [workspaceId, threadId] of Object.entries(persistedLastThreadIds)) {
    const thread = threads.find((item) => item.id === threadId);
    if (
      !ids.has(workspaceId) ||
      typeof threadId !== "string" ||
      !threadId ||
      !thread ||
      thread.workspaceId !== workspaceId ||
      thread.archived
    ) {
      continue;
    }
    lastThreadIdByWorkspace[workspaceId] = threadId;
  }

  const threadDrafts: AssociationThreadDraftRecord[] = [];
  const draftIds = new Set<string>();
  const draftAssociationKeys = new Set<string>();
  const reservedThreadIds = new Set(threadIds);
  for (const draft of value.threadDrafts ?? []) {
    if (!isRecord(draft)) return null;
    const associationKey = `${draft.workspaceId}\u0000${draft.projectId}`;
    if (
      typeof draft.id !== "string" ||
      !draft.id ||
      draft.id.trim() !== draft.id ||
      draftIds.has(draft.id) ||
      typeof draft.threadId !== "string" ||
      !draft.threadId ||
      draft.threadId.trim() !== draft.threadId ||
      reservedThreadIds.has(draft.threadId) ||
      typeof draft.workspaceId !== "string" ||
      typeof draft.projectId !== "string" ||
      !associationKeys.has(associationKey) ||
      draftAssociationKeys.has(associationKey) ||
      typeof draft.content !== "string" ||
      !Array.isArray(draft.attachedSkillNames) ||
      draft.attachedSkillNames.some(
        (name) => typeof name !== "string" || !name || name.trim() !== name,
      ) ||
      new Set(draft.attachedSkillNames).size !== draft.attachedSkillNames.length ||
      !Array.isArray(draft.attachments) ||
      !runtimeIds.includes(draft.runtimeId as RuntimeId) ||
      !isRuntimeMode(draft.runtimeMode) ||
      typeof draft.planMode !== "boolean"
    ) {
      return null;
    }
    const attachments = draft.attachments.map((attachment) =>
      normalizeAttachmentMetadata(attachment, allowLegacyAttachmentKindInference),
    );
    if (attachments.some((attachment) => !attachment)) return null;
    const runtimeModelId = normalizePersistedModelId(draft.runtimeModelId);
    if (draft.runtimeModelId !== undefined && !runtimeModelId) return null;

    draftIds.add(draft.id);
    draftAssociationKeys.add(associationKey);
    reservedThreadIds.add(draft.threadId);
    threadDrafts.push({
      id: draft.id,
      threadId: draft.threadId,
      workspaceId: draft.workspaceId,
      projectId: draft.projectId,
      content: draft.content,
      attachedSkillNames: [...draft.attachedSkillNames],
      attachments: attachments as AttachmentMetadata[],
      runtimeId: draft.runtimeId as RuntimeId,
      ...(runtimeModelId ? { runtimeModelId } : {}),
      runtimeMode: draft.runtimeMode,
      planMode: draft.planMode,
    });
  }

  const threadMessages: AppThreadMessageRecord[] = [];
  const messageIds = new Set<string>();
  const messageThreadIds = new Map<string, string>();
  for (const message of value.threadMessages ?? []) {
    if (!isRecord(message)) return null;
    if (
      typeof message.id !== "string" ||
      !message.id ||
      message.id.trim() !== message.id ||
      messageIds.has(message.id) ||
      typeof message.threadId !== "string" ||
      !threadIds.has(message.threadId) ||
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      !isIsoTimestamp(message.createdAt) ||
      !Array.isArray(message.attachments)
    ) {
      return null;
    }
    const attachments = message.attachments.map((attachment) =>
      normalizeAttachmentMetadata(attachment, allowLegacyAttachmentKindInference),
    );
    if (attachments.some((attachment) => !attachment)) return null;
    const normalizedMessage = normalizeMessageRecord({
      ...message,
      createdAt: Date.parse(message.createdAt),
      ...(typeof message.timestamp === "string" ? { timestamp: message.timestamp } : {}),
      attachments: attachments as AttachmentMetadata[],
    } as PersistedMessage);
    if (!normalizedMessage) return null;

    messageIds.add(message.id);
    messageThreadIds.set(message.id, message.threadId);
    threadMessages.push({
      ...(normalizedMessage as unknown as AppThreadMessageRecord),
      createdAt: message.createdAt,
    });
  }

  const threadRuns: AppThreadRunRecord[] = [];
  const runIds = new Set<string>();
  for (const run of value.threadRuns ?? []) {
    if (!isRecord(run)) return null;
    if (
      typeof run.id !== "string" ||
      !run.id ||
      run.id.trim() !== run.id ||
      runIds.has(run.id) ||
      typeof run.threadId !== "string" ||
      !threadIds.has(run.threadId) ||
      typeof run.messageId !== "string" ||
      messageThreadIds.get(run.messageId) !== run.threadId ||
      !isIsoTimestamp(run.startedAt) ||
      !runtimeIds.includes(run.runtimeId as RuntimeId) ||
      !isRuntimeMode(run.runtimeMode) ||
      typeof run.planMode !== "boolean"
    ) {
      return null;
    }
    const runtimeModelId = normalizePersistedModelId(run.runtimeModelId);
    if (run.runtimeModelId !== undefined && !runtimeModelId) return null;

    runIds.add(run.id);
    threadRuns.push({
      id: run.id,
      threadId: run.threadId,
      messageId: run.messageId,
      startedAt: run.startedAt,
      runtimeId: run.runtimeId as RuntimeId,
      ...(runtimeModelId ? { runtimeModelId } : {}),
      runtimeMode: run.runtimeMode,
      planMode: run.planMode,
    });
  }

  const threadActions: AppThreadActionRecord[] = [];
  const actionIds = new Set<string>();
  const actionValues = Array.isArray(value.threadActions)
    ? value.threadActions.slice(0, MAX_THREAD_ACTIONS)
    : [];
  for (const action of actionValues) {
    if (
      !isRecord(action) ||
      typeof action.id !== "string" ||
      !action.id ||
      action.id.length > MAX_THREAD_ACTION_ID_CHARS ||
      action.id.trim() !== action.id ||
      actionIds.has(action.id) ||
      typeof action.threadId !== "string" ||
      !threadIds.has(action.threadId) ||
      action.action !== "compact" ||
      !runtimeIds.includes(action.runtimeId as RuntimeId) ||
      !isIsoTimestamp(action.completedAt)
    ) {
      continue;
    }
    actionIds.add(action.id);
    threadActions.push({
      id: action.id,
      threadId: action.threadId,
      action: "compact",
      runtimeId: action.runtimeId as RuntimeId,
      completedAt: action.completedAt,
    });
  }

  const threadPromotionIntents: AppThreadPromotionIntentRecord[] = [];
  const intentDraftIds = new Set<string>();
  const intentRunIds = new Set<string>();
  const intentMessageIds = new Set<string>();
  for (const intent of value.threadPromotionIntents ?? []) {
    if (!isRecord(intent)) return null;
    const draft = threadDrafts.find((item) => item.id === intent.draftId);
    if (
      typeof intent.draftId !== "string" ||
      !draft ||
      intentDraftIds.has(intent.draftId) ||
      typeof intent.threadId !== "string" ||
      intent.threadId !== draft.threadId ||
      typeof intent.workspaceId !== "string" ||
      intent.workspaceId !== draft.workspaceId ||
      typeof intent.projectId !== "string" ||
      intent.projectId !== draft.projectId ||
      typeof intent.title !== "string" ||
      !intent.title ||
      intent.title.trim() !== intent.title ||
      typeof intent.runId !== "string" ||
      !intent.runId ||
      intent.runId.trim() !== intent.runId ||
      runIds.has(intent.runId) ||
      intentRunIds.has(intent.runId) ||
      typeof intent.messageId !== "string" ||
      !intent.messageId ||
      intent.messageId.trim() !== intent.messageId ||
      messageIds.has(intent.messageId) ||
      intentMessageIds.has(intent.messageId) ||
      typeof intent.message !== "string" ||
      !Array.isArray(intent.attachments) ||
      !isIsoTimestamp(intent.startedAt) ||
      !runtimeIds.includes(intent.runtimeId as RuntimeId) ||
      !isRuntimeMode(intent.runtimeMode) ||
      typeof intent.planMode !== "boolean"
    ) {
      return null;
    }
    const attachments = intent.attachments.map((attachment) =>
      normalizeAttachmentMetadata(attachment, allowLegacyAttachmentKindInference),
    );
    if (attachments.some((attachment) => !attachment)) return null;
    const runtimeModelId = normalizePersistedModelId(intent.runtimeModelId);
    if (intent.runtimeModelId !== undefined && !runtimeModelId) return null;

    intentDraftIds.add(intent.draftId);
    intentRunIds.add(intent.runId);
    intentMessageIds.add(intent.messageId);
    threadPromotionIntents.push({
      draftId: intent.draftId,
      threadId: intent.threadId,
      workspaceId: intent.workspaceId,
      projectId: intent.projectId,
      title: intent.title,
      runId: intent.runId,
      messageId: intent.messageId,
      message: intent.message,
      attachments: attachments as AttachmentMetadata[],
      startedAt: intent.startedAt,
      runtimeId: intent.runtimeId as RuntimeId,
      ...(runtimeModelId ? { runtimeModelId } : {}),
      runtimeMode: intent.runtimeMode,
      planMode: intent.planMode,
    });
  }

  const threadWork = normalizeThreadWork(value.threadWork);
  if (value.threadWork !== undefined && !threadWork) return null;
  if (threadWork && Object.keys(threadWork).some((threadId) => !threadIds.has(threadId))) {
    return null;
  }

  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: workspaces.sort((left, right) => left.order - right.order),
    projects,
    associations,
    ...(value.threads !== undefined ? { threads } : {}),
    ...(value.threadDrafts !== undefined ? { threadDrafts } : {}),
    ...(value.threadMessages !== undefined ? { threadMessages } : {}),
    ...(value.threadRuns !== undefined ? { threadRuns } : {}),
    ...(value.threadActions !== undefined ? { threadActions } : {}),
    ...(value.threadPromotionIntents !== undefined ? { threadPromotionIntents } : {}),
    ...(value.threadWork !== undefined ? { threadWork: threadWork ?? {} } : {}),
    ...(value.lastThreadIdByWorkspace !== undefined ? { lastThreadIdByWorkspace } : {}),
    activeWorkspaceId: value.activeWorkspaceId,
  };
}

export function normalizePersistedAppStateSnapshot(value: unknown): AppStateSnapshot | null {
  if (!isRecord(value)) return null;
  if (!Array.isArray(value.projects) || !Array.isArray(value.associations)) return null;
  if (!Array.isArray(value.threads) || !Array.isArray(value.threadDrafts)) return null;
  if (!Array.isArray(value.threadMessages) || !Array.isArray(value.threadRuns)) return null;
  if (value.threadActions !== undefined && !Array.isArray(value.threadActions)) return null;
  if (!Array.isArray(value.threadPromotionIntents)) return null;
  return normalizeAppStateSnapshotForWrite({
    ...value,
    lastThreadIdByWorkspace: value.lastThreadIdByWorkspace ?? {},
  });
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  return new Date(value).toISOString() === value;
}

function normalizePersistedModelId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value || value.trim() !== value) return undefined;
  return value;
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

function normalizeAttachmentMetadata(
  value: unknown,
  allowLegacyKindInference = true,
): AttachmentMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string") return null;
  if (typeof value.name !== "string") return null;
  if (typeof value.mimeType !== "string") return null;
  if (typeof value.size !== "number") return null;
  if (typeof value.storageKey !== "string") return null;
  if (value.sha256 !== undefined && !isValidAttachmentSha256(value.sha256)) {
    return null;
  }

  let kind: AttachmentKind;
  if (value.kind === "image" || value.kind === "file") {
    kind = value.kind;
  } else if (allowLegacyKindInference && isSupportedImageMimeType(value.mimeType)) {
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
    ...(typeof value.sha256 === "string" ? { sha256: value.sha256 } : {}),
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

function normalizeMessagePart(value: unknown): MessagePart | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  if (value.type === "text") {
    return typeof value.content === "string" ? { type: "text", content: value.content } : null;
  }
  if (value.type === "reasoning") {
    if (
      typeof value.id !== "string" ||
      typeof value.content !== "string" ||
      (value.status !== "running" && value.status !== "completed" && value.status !== "cancelled")
    ) {
      return null;
    }
    return {
      type: "reasoning",
      id: value.id,
      content: value.content,
      status: value.status,
    };
  }
  if (value.type === "shell") {
    if (
      typeof value.id !== "string" ||
      typeof value.command !== "string" ||
      typeof value.output !== "string" ||
      (value.status !== "running" &&
        value.status !== "completed" &&
        value.status !== "failed" &&
        value.status !== "cancelled") ||
      (value.exitCode !== undefined &&
        value.exitCode !== null &&
        (typeof value.exitCode !== "number" || !Number.isInteger(value.exitCode)))
    ) {
      return null;
    }
    return {
      type: "shell",
      id: value.id,
      command: value.command,
      output: value.output,
      status: value.status,
      ...(value.exitCode !== undefined ? { exitCode: value.exitCode as number | null } : {}),
    };
  }
  if (value.type === "plan_review") return normalizePlanReviewPart(value);
  if (value.type === "question") return normalizeQuestionPart(value);
  if (value.type === "subagent_task") return normalizeSubagentTaskPart(value);
  if (value.type === "error") {
    if (typeof value.id !== "string" || typeof value.message !== "string") return null;
    if (value.runtimeSessionRecovery !== undefined && !isRecord(value.runtimeSessionRecovery)) {
      return null;
    }
    return value as MessagePart;
  }
  return null;
}

function normalizeMessageParts(value: unknown): MessagePart[] | undefined | null {
  if (!Array.isArray(value)) return null;

  const parts = value.map(normalizeMessagePart);
  if (parts.some((part) => part === null)) return null;
  return parts.length > 0 ? (parts as MessagePart[]) : undefined;
}

function normalizeMessageRecord(message: PersistedMessage): PersistedMessage | null {
  const record = message as PersistedMessage & { attachments?: unknown; parts?: unknown };

  if (record.type === "changed_files") {
    const changedFilesRecord = record as ChangedFilesMessage<{ timestamp?: string }> & {
      changedFiles?: unknown;
    };
    if (!Array.isArray(changedFilesRecord.changedFiles)) return null;
    const normalizedFiles = changedFilesRecord.changedFiles.map((file) =>
      normalizeChangedFile(file),
    );
    if (normalizedFiles.some((file) => file === null)) return null;

    const normalizedSnapshot = normalizeChangedFilesSnapshot(changedFilesRecord.snapshot);
    const { snapshot: _oldSnapshot, ...recordWithoutSnapshot } = changedFilesRecord;

    const normalized: ChangedFilesMessage<{ timestamp?: string }> = {
      ...recordWithoutSnapshot,
      changedFiles: normalizedFiles as ChangedFile[],
      ...(normalizedSnapshot ? { snapshot: normalizedSnapshot } : {}),
    };

    return normalized;
  }

  const normalizedParts =
    record.parts === undefined ? undefined : normalizeMessageParts(record.parts);
  if (normalizedParts === null) return null;
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
  } as PersistedMessage;
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

function normalizeThreadWork(
  value: unknown,
): Record<string, ThreadWorkSnapshot> | undefined | null {
  if (value === undefined) return undefined;
  if (!isRecord(value)) return null;

  const threadWork: Record<string, ThreadWorkSnapshot> = {};
  for (const [threadId, entry] of Object.entries(value)) {
    if (!threadId || !isRecord(entry) || !Array.isArray(entry.queuedMessages)) return null;

    const draft = entry.draft === undefined ? null : normalizeThreadWorkDraft(entry.draft);
    if (entry.draft !== undefined && !draft) return null;
    if (entry.queuedMessages.length > MAX_THREAD_WORK_QUEUE_ITEMS) return null;
    const queuedMessages = entry.queuedMessages.map((item) =>
      normalizeThreadWorkQueuedMessage(item),
    );
    if (queuedMessages.some((item) => item === null)) return null;

    threadWork[threadId] = {
      ...(draft ? { draft } : {}),
      queuedMessages: queuedMessages as ThreadWorkQueuedMessage[],
    };
  }
  return threadWork;
}

export function isRecognizedLegacyWorkspaceSnapshot(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.version !== LEGACY_WORKSPACE_SNAPSHOT_VERSION) return false;
  if (!Array.isArray(value.projects)) return false;
  if (!Array.isArray(value.messages)) return false;
  if (typeof value.activeThreadId !== "string" && value.activeThreadId !== null) return false;

  const chats = value.chats === undefined ? [] : value.chats;
  if (!Array.isArray(chats)) return false;
  return value.projects.every((project) => isRecord(project) && Array.isArray(project.threads));
}

export function normalizeProviderSessionSnapshot(value: unknown): ProviderSessionSnapshot | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (!isRecord(value.sessions)) return null;

  const sessions: Record<string, string> = {};
  for (const [key, sessionId] of Object.entries(value.sessions)) {
    sessions[key] = typeof sessionId === "string" ? sessionId : "";
  }

  return { version: 1, sessions };
}
