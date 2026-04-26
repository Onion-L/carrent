import type { RuntimeId } from "./runtimes";

export interface ChatTurnRequest {
  requestKey?: string;
  projectPath: string;
  threadId: string;
  draftRef?: {
    draftId: string;
    projectId: string;
    title: string;
  };
  runtimeId: RuntimeId;
  agent: {
    id: string;
    name: string;
    responsibility: string;
  };
  transcript: Array<{
    role: "user" | "assistant";
    content: string;
    agentId?: string;
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
      };
    })
  | (ChatRunEventBase & {
      type: "started";
      threadId: string;
      agentId: string;
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
  | (ChatRunEventBase & { type: "stopped" });
