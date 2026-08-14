import { DEFAULT_RUNTIME_ID, type RuntimeId } from "./runtimes";
import type { RuntimeMode } from "./runtimeMode";
import type { ChatPermissionOptionKind, ChatPermissionRequest } from "./chatPermissions";
import type { ChatQuestionAnswer, ChatQuestionRequest } from "./chatQuestions";
import type { RunChecklistSnapshot } from "./runChecklist";
import type { LocalPathContextItem } from "./localPathContext";
import type { AppStateSnapshot } from "./workspacePersistence";

export const DEFAULT_CHAT_RUNTIME_ID: RuntimeId = DEFAULT_RUNTIME_ID;

export type ChatRunContext = {
  kind: "project";
  workingDirectory: string;
  projectId: string;
  workspaceId: string;
};

export type AttachmentKind = "image" | "file";

export type AttachmentMetadata = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  storageKey: string;
  sha256?: string;
  width?: number;
  height?: number;
};

export type AttachmentIntegrityMetadata = Pick<
  AttachmentMetadata,
  "storageKey" | "size" | "sha256"
>;

export type Attachment = AttachmentMetadata & {
  localPath?: string;
};

export type RuntimeSessionCommand = "compact" | "status";

export type RuntimeQuotaWindow = {
  usedPercentage?: number;
  /** ISO timestamp the window resets at; the renderer formats countdowns. */
  resetAt?: string;
  /** Raw quota units from the provider API. */
  used?: number;
  limit?: number;
};

export type PlanUsageErrorKind = "no-credentials" | "unauthorized" | "network" | "bad-payload";

export type RuntimeSessionStatusData = {
  model?: string;
  used: number;
  /** Context window size; omitted when it cannot be resolved. */
  total?: number;
  percentage?: number;
  threadActions?: import("./threadActions").ThreadActionKind[];
  supportedCommands: RuntimeSessionCommand[];
  planUsage?: {
    weekly?: RuntimeQuotaWindow;
    fiveHour?: RuntimeQuotaWindow;
  };
  /** Set when planUsage is absent because the usage lookup failed. */
  planUsageError?: PlanUsageErrorKind;
};

export type RuntimeSessionStatus = RuntimeSessionStatusData & {
  sessionId: string;
};

export type KimiTelemetryStatus = RuntimeSessionStatusData & {
  sessionId?: string;
};

export type KimiSessionStatus = RuntimeSessionStatus;

export type DeleteThreadDataRequest = {
  threadIds: string[];
  attachmentStorageKeys: string[];
};

export type ThreadDataDeletionOptions = {
  deferProviderSessionDeletion?: boolean;
};

export type ThreadDataDeletionReceipt = {
  threadIds: string[];
  removedProviderSessions: Record<string, string>;
  detachedRuntimeSessions: Record<string, string>;
};

export type ThreadDeletionScope =
  | { kind: "threads" }
  | { kind: "association"; workspaceId: string; projectId: string }
  | { kind: "workspace"; workspaceId: string };

export type ThreadDeletionAppStateSnapshots = {
  beforeAppState: AppStateSnapshot;
  afterAppState: AppStateSnapshot;
  scope?: ThreadDeletionScope;
};

export type ThreadDeletionTransactionRequest = ThreadDeletionAppStateSnapshots & {
  threadData: DeleteThreadDataRequest;
};

export function applyThreadDeletionToAppState(
  snapshot: AppStateSnapshot,
  threadIds: string[],
  scope?: ThreadDeletionScope,
): AppStateSnapshot {
  const ids = new Set(threadIds);
  const lastThreadIdByWorkspace = snapshot.lastThreadIdByWorkspace
    ? Object.fromEntries(
        Object.entries(snapshot.lastThreadIdByWorkspace).filter(
          ([, threadId]) => !ids.has(threadId),
        ),
      )
    : undefined;
  const withoutThreads: AppStateSnapshot = {
    ...snapshot,
    threads: snapshot.threads?.filter((thread) => !ids.has(thread.id)),
    threadDrafts: snapshot.threadDrafts?.filter((draft) => !ids.has(draft.threadId)),
    threadMessages: snapshot.threadMessages?.filter((message) => !ids.has(message.threadId)),
    threadRuns: snapshot.threadRuns?.filter((run) => !ids.has(run.threadId)),
    threadActions: snapshot.threadActions?.filter((action) => !ids.has(action.threadId)),
    threadPromotionIntents: snapshot.threadPromotionIntents?.filter(
      (intent) => !ids.has(intent.threadId),
    ),
    threadWork: snapshot.threadWork
      ? Object.fromEntries(
          Object.entries(snapshot.threadWork).filter(([threadId]) => !ids.has(threadId)),
        )
      : undefined,
    lastThreadIdByWorkspace,
  };
  if (!scope || scope.kind === "threads") return withoutThreads;

  if (scope.kind === "association") {
    const associations = withoutThreads.associations.filter(
      (association) =>
        association.workspaceId !== scope.workspaceId || association.projectId !== scope.projectId,
    );
    // Reindex the affected workspace's remaining associations so per-workspace
    // orders stay contiguous (required by the snapshot normalizers).
    let nextOrder = 0;
    const reindexedAssociations = associations.map((association) =>
      association.workspaceId === scope.workspaceId
        ? { ...association, order: nextOrder++ }
        : association,
    );
    return {
      ...withoutThreads,
      projects: withoutThreads.projects.filter(
        (project) =>
          project.id !== scope.projectId ||
          reindexedAssociations.some((association) => association.projectId === project.id),
      ),
      associations: reindexedAssociations,
      threadDrafts: withoutThreads.threadDrafts?.filter(
        (draft) => draft.workspaceId !== scope.workspaceId || draft.projectId !== scope.projectId,
      ),
    };
  }

  const orderedWorkspaces = [...withoutThreads.workspaces].sort(
    (left, right) => left.order - right.order,
  );
  const workspaceIndex = orderedWorkspaces.findIndex(
    (workspace) => workspace.id === scope.workspaceId,
  );
  const nextWorkspace =
    orderedWorkspaces[workspaceIndex + 1] ?? orderedWorkspaces[workspaceIndex - 1] ?? null;
  const workspaces = orderedWorkspaces
    .filter((workspace) => workspace.id !== scope.workspaceId)
    .map((workspace, order) => ({ ...workspace, order }));
  const associations = withoutThreads.associations.filter(
    (association) => association.workspaceId !== scope.workspaceId,
  );
  const nextLastThreadIdByWorkspace = { ...withoutThreads.lastThreadIdByWorkspace };
  delete nextLastThreadIdByWorkspace[scope.workspaceId];
  return {
    ...withoutThreads,
    workspaces,
    projects: withoutThreads.projects.filter((project) =>
      associations.some((association) => association.projectId === project.id),
    ),
    associations,
    threadDrafts: withoutThreads.threadDrafts?.filter(
      (draft) => draft.workspaceId !== scope.workspaceId,
    ),
    lastThreadIdByWorkspace: nextLastThreadIdByWorkspace,
    activeWorkspaceId:
      withoutThreads.activeWorkspaceId === scope.workspaceId
        ? (nextWorkspace?.id ?? null)
        : withoutThreads.activeWorkspaceId,
  };
}

export interface ChatTurnRequest {
  requestKey?: string;
  runId?: string;
  context: ChatRunContext;
  threadId: string;
  runtimeId: RuntimeId;
  runtimeModelId?: string;
  runtimeMode: RuntimeMode;
  planMode: boolean;
  transcript: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  message: string;
  attachments?: Attachment[];
  // Structured Local Path Context for dragged files/folders. Runtime
  // authorization consumes this structured field rather than re-parsing user
  // Markdown; the Primary Runtime builds a read allowlist from it at Run start.
  localPathContexts?: LocalPathContextItem[];
  historyMode?: "continue" | "replace";
}

export type RuntimeSessionRecovery = {
  runtimeId: RuntimeId;
  threadId: string;
};

type ChatRunEventBase = {
  runId: string;
  requestKey?: string;
};

export type ChatShellStatus = "running" | "completed" | "failed";

export type ChatShellEventPayload = {
  id: string;
  command: string;
  output: string;
  status: ChatShellStatus;
  exitCode?: number | null;
};

export type ChatReasoningStatus = "running" | "completed";

export type ChatReasoningEventPayload = {
  id: string;
  content: string;
  status: ChatReasoningStatus;
};

export type KimiToolTimelineStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

export type KimiTimelineItem =
  | {
      type: "thinking";
      id: string;
      order: number;
      content: string;
      status: ChatReasoningStatus | "cancelled";
    }
  | {
      type: "message";
      id: string;
      order: number;
      content: string;
      isFinal: boolean;
    }
  | {
      type: "tool";
      id: string;
      order: number;
      toolCallId: string;
      title: string;
      kind: string;
      command: string;
      filePath: string;
      input: string;
      output: string;
      error: string;
      status: KimiToolTimelineStatus;
    };

export type KimiTimelineTextUpdate =
  | { kind: "append"; value: string }
  | { kind: "replace"; value: string };

export type KimiTimelineItemUpdate =
  | {
      itemType: "thinking";
      id: string;
      order?: number;
      content?: KimiTimelineTextUpdate;
      status?: ChatReasoningStatus | "cancelled";
    }
  | {
      itemType: "message";
      id: string;
      order?: number;
      content?: KimiTimelineTextUpdate;
      isFinal?: boolean;
    }
  | {
      itemType: "tool";
      id: string;
      order?: number;
      title?: KimiTimelineTextUpdate;
      kind?: KimiTimelineTextUpdate;
      command?: KimiTimelineTextUpdate;
      filePath?: KimiTimelineTextUpdate;
      input?: KimiTimelineTextUpdate;
      output?: KimiTimelineTextUpdate;
      error?: KimiTimelineTextUpdate;
      status?: KimiToolTimelineStatus;
    };

function compactKimiTimelineTextUpdate(
  previous: string,
  next: string,
): KimiTimelineTextUpdate | undefined {
  if (previous === next) return undefined;
  if (next.startsWith(previous)) {
    return { kind: "append", value: next.slice(previous.length) };
  }
  return { kind: "replace", value: next };
}

export function createKimiTimelineItemUpdate(
  previous: KimiTimelineItem,
  next: KimiTimelineItem,
): KimiTimelineItemUpdate | null {
  if (previous.id !== next.id || previous.type !== next.type) return null;
  const order = previous.order === next.order ? undefined : next.order;

  if (previous.type === "thinking" && next.type === "thinking") {
    const content = compactKimiTimelineTextUpdate(previous.content, next.content);
    return {
      itemType: "thinking",
      id: next.id,
      ...(order === undefined ? {} : { order }),
      ...(content ? { content } : {}),
      ...(previous.status === next.status ? {} : { status: next.status }),
    };
  }
  if (previous.type === "message" && next.type === "message") {
    const content = compactKimiTimelineTextUpdate(previous.content, next.content);
    return {
      itemType: "message",
      id: next.id,
      ...(order === undefined ? {} : { order }),
      ...(content ? { content } : {}),
      ...(previous.isFinal === next.isFinal ? {} : { isFinal: next.isFinal }),
    };
  }
  if (previous.type === "tool" && next.type === "tool") {
    const title = compactKimiTimelineTextUpdate(previous.title, next.title);
    const kind = compactKimiTimelineTextUpdate(previous.kind, next.kind);
    const command = compactKimiTimelineTextUpdate(previous.command, next.command);
    const filePath = compactKimiTimelineTextUpdate(previous.filePath, next.filePath);
    const input = compactKimiTimelineTextUpdate(previous.input, next.input);
    const output = compactKimiTimelineTextUpdate(previous.output, next.output);
    const error = compactKimiTimelineTextUpdate(previous.error, next.error);
    return {
      itemType: "tool",
      id: next.id,
      ...(order === undefined ? {} : { order }),
      ...(title ? { title } : {}),
      ...(kind ? { kind } : {}),
      ...(command ? { command } : {}),
      ...(filePath ? { filePath } : {}),
      ...(input ? { input } : {}),
      ...(output ? { output } : {}),
      ...(error ? { error } : {}),
      ...(previous.status === next.status ? {} : { status: next.status }),
    };
  }
  return null;
}

function applyKimiTimelineTextUpdate(current: string, update?: KimiTimelineTextUpdate) {
  if (!update) return current;
  return update.kind === "append" ? current + update.value : update.value;
}

export function applyKimiTimelineItemUpdate(
  item: KimiTimelineItem,
  update: KimiTimelineItemUpdate,
): KimiTimelineItem | null {
  if (item.id !== update.id || item.type !== update.itemType) return null;

  if (item.type === "thinking" && update.itemType === "thinking") {
    return {
      ...item,
      ...(update.order === undefined ? {} : { order: update.order }),
      content: applyKimiTimelineTextUpdate(item.content, update.content),
      status: update.status ?? item.status,
    };
  }
  if (item.type === "message" && update.itemType === "message") {
    return {
      ...item,
      ...(update.order === undefined ? {} : { order: update.order }),
      content: applyKimiTimelineTextUpdate(item.content, update.content),
      isFinal: update.isFinal ?? item.isFinal,
    };
  }
  if (item.type === "tool" && update.itemType === "tool") {
    return {
      ...item,
      ...(update.order === undefined ? {} : { order: update.order }),
      title: applyKimiTimelineTextUpdate(item.title, update.title),
      kind: applyKimiTimelineTextUpdate(item.kind, update.kind),
      command: applyKimiTimelineTextUpdate(item.command, update.command),
      filePath: applyKimiTimelineTextUpdate(item.filePath, update.filePath),
      input: applyKimiTimelineTextUpdate(item.input, update.input),
      output: applyKimiTimelineTextUpdate(item.output, update.output),
      error: applyKimiTimelineTextUpdate(item.error, update.error),
      status: update.status ?? item.status,
    };
  }
  return null;
}

export type ChatSubagentTaskStatus =
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "detached";

export type ChatSubagentTaskPayload = {
  id: string;
  runtimeId: "kimi";
  source: "agent" | "agent-swarm";
  runtimeAgentId?: string;
  agentType?: string;
  agentCount?: number;
  description: string;
  prompt?: string;
  background: boolean;
  status: ChatSubagentTaskStatus;
  summary?: string;
  startedAt: number;
  finishedAt?: number;
};

export type ChatRunEvent =
  | (ChatRunEventBase & {
      type: "started";
      threadId: string;
    })
  | (ChatRunEventBase & { type: "notice"; message: string })
  | (ChatRunEventBase & { type: "delta"; text: string })
  | (ChatRunEventBase & { type: "text-snapshot"; text: string })
  | (ChatRunEventBase & { type: "reasoning"; reasoning: ChatReasoningEventPayload })
  | (ChatRunEventBase & { type: "kimi-timeline"; item: KimiTimelineItem })
  | (ChatRunEventBase & { type: "kimi-timeline-update"; update: KimiTimelineItemUpdate })
  | (ChatRunEventBase & { type: "shell"; shell: ChatShellEventPayload })
  | (ChatRunEventBase & { type: "subagent-task"; task: ChatSubagentTaskPayload })
  | (ChatRunEventBase & {
      type: "checklist";
      threadId: string;
      runtimeId: RuntimeId;
      checklist: RunChecklistSnapshot;
    })
  | (ChatRunEventBase & {
      type: "completed";
      text: string;
      finishedAt: string;
      writtenFiles?: string[];
    })
  | (ChatRunEventBase & {
      type: "failed";
      error: string;
      writtenFiles?: string[];
      runtimeSessionRecovery?: RuntimeSessionRecovery;
    })
  | (ChatRunEventBase & { type: "stopped"; writtenFiles?: string[] })
  | (ChatRunEventBase & {
      type: "permission-requested";
      permission: ChatPermissionRequest;
    })
  | (ChatRunEventBase & {
      type: "permission-resolved";
      permissionId: string;
      optionId: string;
      optionName: string;
      optionKind: ChatPermissionOptionKind;
    })
  | (ChatRunEventBase & {
      type: "plan-mode-changed";
      enabled: boolean;
    })
  | (ChatRunEventBase & {
      type: "permission-failed";
      permissionId: string;
      error: string;
    })
  | (ChatRunEventBase & {
      type: "question-requested";
      question: ChatQuestionRequest;
    })
  | (ChatRunEventBase & {
      type: "question-resolved";
      questionId: string;
      outcome: "answered" | "skipped";
      optionId?: string;
      optionLabel?: string;
      answers?: ChatQuestionAnswer[];
    })
  | (ChatRunEventBase & {
      type: "question-failed";
      questionId: string;
      error: string;
    });

function replaceCompactEvent(
  events: ChatRunEvent[],
  predicate: (event: ChatRunEvent) => boolean,
  event: ChatRunEvent,
) {
  const index = events.findIndex(predicate);
  if (index < 0) return [...events, event];
  const next = [...events];
  next[index] = event;
  return next;
}

export function compactChatRunEvents(events: ChatRunEvent[], event: ChatRunEvent): ChatRunEvent[] {
  if (event.type === "notice") return events;
  if (event.type === "delta") {
    const current = events.find(
      (item): item is Extract<ChatRunEvent, { type: "text-snapshot" }> =>
        item.type === "text-snapshot",
    );
    return replaceCompactEvent(events, (item) => item.type === "text-snapshot", {
      type: "text-snapshot",
      runId: event.runId,
      ...(event.requestKey ? { requestKey: event.requestKey } : {}),
      text: (current?.text ?? "") + event.text,
    });
  }
  if (event.type === "text-snapshot") {
    return replaceCompactEvent(events, (item) => item.type === "text-snapshot", event);
  }
  if (event.type === "kimi-timeline" || event.type === "kimi-timeline-update") {
    const id = event.type === "kimi-timeline" ? event.item.id : event.update.id;
    const current = events.find(
      (item): item is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
        item.type === "kimi-timeline" && item.item.id === id,
    );
    const item =
      event.type === "kimi-timeline"
        ? event.item
        : current
          ? applyKimiTimelineItemUpdate(current.item, event.update)
          : null;
    if (!item) return events;
    return replaceCompactEvent(
      events,
      (candidate) => candidate.type === "kimi-timeline" && candidate.item.id === id,
      {
        type: "kimi-timeline",
        runId: event.runId,
        ...(event.requestKey ? { requestKey: event.requestKey } : {}),
        item,
      },
    );
  }
  if (event.type === "reasoning") {
    return replaceCompactEvent(
      events,
      (item) => item.type === "reasoning" && item.reasoning.id === event.reasoning.id,
      event,
    );
  }
  if (event.type === "shell") {
    return replaceCompactEvent(
      events,
      (item) => item.type === "shell" && item.shell.id === event.shell.id,
      event,
    );
  }
  if (event.type === "subagent-task") {
    return replaceCompactEvent(
      events,
      (item) => item.type === "subagent-task" && item.task.id === event.task.id,
      event,
    );
  }
  if (
    event.type === "started" ||
    event.type === "checklist" ||
    event.type === "plan-mode-changed"
  ) {
    return replaceCompactEvent(events, (item) => item.type === event.type, event);
  }
  if (event.type === "permission-requested") {
    return replaceCompactEvent(
      events,
      (item) => item.type === "permission-requested" && item.permission.id === event.permission.id,
      event,
    );
  }
  if (event.type === "permission-resolved" || event.type === "permission-failed") {
    return replaceCompactEvent(
      events,
      (item) =>
        (item.type === "permission-resolved" || item.type === "permission-failed") &&
        item.permissionId === event.permissionId,
      event,
    );
  }
  if (event.type === "question-requested") {
    return replaceCompactEvent(
      events,
      (item) => item.type === "question-requested" && item.question.id === event.question.id,
      event,
    );
  }
  if (event.type === "question-resolved" || event.type === "question-failed") {
    return replaceCompactEvent(
      events,
      (item) =>
        (item.type === "question-resolved" || item.type === "question-failed") &&
        item.questionId === event.questionId,
      event,
    );
  }
  if (event.type === "completed" || event.type === "failed" || event.type === "stopped") {
    return replaceCompactEvent(
      events,
      (item) => item.type === "completed" || item.type === "failed" || item.type === "stopped",
      event,
    );
  }
  return [...events, event];
}

export type SharedChatRunStatus =
  | "starting"
  | "running"
  | "waiting-for-approval"
  | "waiting-for-answer"
  | "completed"
  | "failed"
  | "cancelled";

export function isTerminalSharedChatRunStatus(status: SharedChatRunStatus) {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export type SharedChatRun = {
  runId: string;
  threadId: string;
  requestKey?: string;
  status: SharedChatRunStatus;
  stopRequested: boolean;
  eventCount?: number;
  events: ChatRunEvent[];
  pendingPermissions: ChatPermissionRequest[];
  pendingQuestions: ChatQuestionRequest[];
};

export type ChatRunAuthorityState = {
  revision: number;
  runs: SharedChatRun[];
};

export type ChatRunAuthorityUpdate = {
  baseRevision: number;
  revision: number;
  run: Omit<SharedChatRun, "events">;
  event?: ChatRunEvent;
  events?: ChatRunEvent[];
  replacedRunId?: string;
};

export type ChatRunAuthorityRemoval = {
  baseRevision: number;
  revision: number;
  removedRunId: string;
};

export type ChatRunAuthorityChange =
  | ChatRunAuthorityUpdate
  | ChatRunAuthorityRemoval
  | {
      baseRevision: number;
      revision: number;
      updates: Array<ChatRunAuthorityUpdate | ChatRunAuthorityRemoval>;
    };

export type ChatRunCommandResult = {
  accepted: boolean;
  runId?: string;
};
