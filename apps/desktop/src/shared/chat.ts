import { DEFAULT_RUNTIME_ID, type RuntimeId } from "./runtimes";
import type { RuntimeMode } from "./runtimeMode";
import type { ChatPermissionDecision, ChatPermissionRequest } from "./chatPermissions";

export const DEFAULT_CHAT_RUNTIME_ID: RuntimeId = DEFAULT_RUNTIME_ID;

export type ChatWorkspaceScope =
  | { kind: "project"; projectPath: string; projectId: string }
  | { kind: "chat" };

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
  transcript: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
  message: string;
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
      };
    })
  | (ChatRunEventBase & {
      type: "started";
      threadId: string;
    })
  | (ChatRunEventBase & { type: "delta"; text: string })
  | (ChatRunEventBase & { type: "reasoning"; reasoning: ChatReasoningEventPayload })
  | (ChatRunEventBase & { type: "shell"; shell: ChatShellEventPayload })
  | (ChatRunEventBase & {
      type: "completed";
      text: string;
      finishedAt: string;
    })
  | (ChatRunEventBase & { type: "failed"; error: string })
  | (ChatRunEventBase & { type: "stopped" })
  | (ChatRunEventBase & {
      type: "permission-requested";
      permission: ChatPermissionRequest;
    })
  | (ChatRunEventBase & {
      type: "permission-resolved";
      permissionId: string;
      decision: ChatPermissionDecision;
    })
  | (ChatRunEventBase & {
      type: "permission-failed";
      permissionId: string;
      error: string;
    });
