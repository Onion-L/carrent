import type { AttachmentMetadata, ChatSubagentTaskPayload, RuntimeSessionRecovery } from "./chat";
import type { ChatPermissionOption } from "./chatPermissions";

export type { AttachmentMetadata };

export type ChangedFile = {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
  untracked: boolean;
  omitted?: boolean;
  isFolder?: boolean;
  fileType?: "swift" | "markdown" | "other";
};

type MessageTimestampFields = { timestamp?: string };
type UiMessageTimestampFields = { timestamp: string };

type MessageBase<T extends MessageTimestampFields = UiMessageTimestampFields> = {
  id: string;
  role: "user" | "assistant";
  agentId?: string;
  createdAt?: string | number;
  duration?: string;
  runStatus?: "running" | "completed" | "failed" | "cancelled";
  runFinishedAt?: number;
  threadId: string;
} & T;

export type SubagentTaskPart = { type: "subagent_task" } & ChatSubagentTaskPayload;

export type MessagePart =
  | { type: "text"; content: string }
  | {
      type: "reasoning";
      id: string;
      content: string;
      status: "running" | "completed" | "cancelled";
    }
  | {
      type: "shell";
      id: string;
      command: string;
      output: string;
      status: "running" | "completed" | "failed" | "cancelled";
      exitCode?: number | null;
    }
  | {
      type: "plan_review";
      id: string;
      permissionId: string;
      content: string;
      status: "pending" | "approved" | "revision-requested" | "rejected" | "interrupted";
      options: ChatPermissionOption[];
      selectedOptionId?: string;
      selectedOptionName?: string;
    }
  | {
      type: "question";
      id: string;
      questionId: string;
      status: "pending" | "answered" | "skipped" | "interrupted";
      questions: Array<{ header: string; question: string }>;
      answers?: Array<{ questionIndex: number; labels: string[]; customText?: string }>;
    }
  | SubagentTaskPart
  | {
      type: "error";
      id: string;
      message: string;
      runtimeSessionRecovery?: RuntimeSessionRecovery & { userMessageId: string };
    };

type TextMessage<T extends MessageTimestampFields = UiMessageTimestampFields> = MessageBase<T> & {
  type?: "text";
  content: string;
  parts?: MessagePart[];
  attachments?: AttachmentMetadata[];
};

export type ChangedFilesMessage<T extends MessageTimestampFields = UiMessageTimestampFields> = Omit<
  MessageBase<T>,
  "role"
> & {
  role: "assistant";
  type: "changed_files";
  content?: string;
  changedFiles: ChangedFile[];
  snapshot?: {
    baseRevision: string;
    capturedAt: string;
    patch: string;
    truncated: boolean;
  };
};

export type Message<T extends MessageTimestampFields = UiMessageTimestampFields> =
  | TextMessage<T>
  | ChangedFilesMessage<T>;
