import { DEFAULT_RUNTIME_ID, type RuntimeId } from "./runtimes";
import type { RuntimeMode } from "./runtimeMode";
import type { ChatPermissionOptionKind, ChatPermissionRequest } from "./chatPermissions";
import type { ChatQuestionAnswer, ChatQuestionRequest } from "./chatQuestions";
import type { RunChecklistSnapshot } from "./runChecklist";
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
  reset?: string;
};

export type RuntimeSessionStatusData = {
  model?: string;
  used: number;
  total: number;
  percentage: number;
  threadActions?: import("./threadActions").ThreadActionKind[];
  supportedCommands: RuntimeSessionCommand[];
  planUsage?: {
    weekly?: RuntimeQuotaWindow;
    fiveHour?: RuntimeQuotaWindow;
  };
};

export type RuntimeSessionStatus = RuntimeSessionStatusData & {
  sessionId: string;
};

export type KimiSessionStatus = RuntimeSessionStatus;

export type DeleteThreadDataRequest = {
  threadIds: string[];
  attachmentStorageKeys: string[];
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
  | (ChatRunEventBase & { type: "reasoning"; reasoning: ChatReasoningEventPayload })
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
  events: ChatRunEvent[];
  pendingPermissions: ChatPermissionRequest[];
  pendingQuestions: ChatQuestionRequest[];
};

export type ChatRunAuthorityState = {
  revision: number;
  runs: SharedChatRun[];
};

export type ChatRunCommandResult = {
  accepted: boolean;
  runId?: string;
  state: ChatRunAuthorityState;
};
