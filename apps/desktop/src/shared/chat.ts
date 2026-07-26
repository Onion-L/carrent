import { DEFAULT_RUNTIME_ID, type RuntimeId } from "./runtimes";
import type { RuntimeMode } from "./runtimeMode";
import type { ChatPermissionOptionKind, ChatPermissionRequest } from "./chatPermissions";
import type { ChatQuestionRequest } from "./chatQuestions";

export const DEFAULT_CHAT_RUNTIME_ID: RuntimeId = DEFAULT_RUNTIME_ID;

export type ChatWorkspaceScope =
  | { kind: "project"; projectPath: string; projectId: string }
  | { kind: "chat" };

export type AttachmentKind = "image" | "file";

export type AttachmentMetadata = {
  id: string;
  kind: AttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  storageKey: string;
  width?: number;
  height?: number;
};

export type Attachment = AttachmentMetadata & {
  localPath?: string;
};

export type KimiSessionStatus = {
  model?: string;
  used: number;
  total: number;
  percentage: number;
};

export type DeleteThreadDataRequest = {
  threadIds: string[];
  attachmentStorageKeys: string[];
};

export interface ChatTurnRequest {
  requestKey?: string;
  workspace: ChatWorkspaceScope;
  threadId: string;
  draftRef?: {
    draftId: string;
    projectId: string;
    title: string;
  };
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
      type: "thread-upserted";
      draftId: string;
      projectId: string;
      thread: {
        id: string;
        title: string;
        updatedAt: string;
        runtimeId?: RuntimeId;
        runtimeModelId?: string;
        runtimeMode?: RuntimeMode;
        planMode?: boolean;
      };
    })
  | (ChatRunEventBase & {
      type: "started";
      threadId: string;
    })
  | (ChatRunEventBase & { type: "delta"; text: string })
  | (ChatRunEventBase & { type: "reasoning"; reasoning: ChatReasoningEventPayload })
  | (ChatRunEventBase & { type: "shell"; shell: ChatShellEventPayload })
  | (ChatRunEventBase & { type: "subagent-task"; task: ChatSubagentTaskPayload })
  | (ChatRunEventBase & {
      type: "completed";
      text: string;
      finishedAt: string;
      writtenFiles?: string[];
    })
  | (ChatRunEventBase & { type: "failed"; error: string; writtenFiles?: string[] })
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
    })
  | (ChatRunEventBase & {
      type: "question-failed";
      questionId: string;
      error: string;
    });
