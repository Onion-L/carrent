import type { RuntimeId } from "./runtimes";

export interface ChatTurnRequest {
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

export type ChatRunEvent =
  | {
      type: "thread-upserted";
      runId: string;
      draftId: string;
      projectId: string;
      thread: {
        id: string;
        title: string;
        updatedAt: string;
      };
    }
  | { type: "started"; runId: string; threadId: string; agentId: string }
  | { type: "delta"; runId: string; text: string }
  | { type: "completed"; runId: string; text: string; finishedAt: string }
  | { type: "failed"; runId: string; error: string }
  | { type: "stopped"; runId: string };
