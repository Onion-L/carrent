import type {
  AttachmentMetadata,
  ChatSubagentTaskPayload,
  KimiTimelineItem,
  RuntimeSessionRecovery,
} from "./chat";
import type { LocalPathContextItem } from "./localPathContext";
import type { ChatPermissionOption } from "./chatPermissions";

export type { AttachmentMetadata };
export type { LocalPathContextItem };

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
  runEventCount?: number;
  threadId: string;
} & T;

export type SubagentTaskPart = { type: "subagent_task" } & ChatSubagentTaskPayload;

export type MessagePart =
  | { type: "text"; content: string }
  | { type: "kimi_timeline"; item: KimiTimelineItem }
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
  // Structured Local Path Context (dragged files/folders). Distinct from
  // attachments: no bytes are copied, so this is a live path reference that is
  // rendered as compact badges and never parsed from message prose.
  localPathContexts?: LocalPathContextItem[];
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

function reconcileRunningParts(parts: MessagePart[] | undefined): MessagePart[] | undefined {
  if (!parts) return undefined;

  let changed = false;
  const reconciled = parts.map((part) => {
    if ((part.type === "reasoning" || part.type === "shell") && part.status === "running") {
      changed = true;
      return { ...part, status: "cancelled" as const };
    }
    if (
      part.type === "kimi_timeline" &&
      (part.item.type === "thinking" || part.item.type === "tool") &&
      part.item.status === "running"
    ) {
      changed = true;
      return { ...part, item: { ...part.item, status: "cancelled" as const } };
    }
    if ((part.type === "plan_review" || part.type === "question") && part.status === "pending") {
      changed = true;
      return { ...part, status: "interrupted" as const };
    }
    if (part.type === "subagent_task" && part.status === "running") {
      changed = true;
      return { ...part, status: "interrupted" as const };
    }
    return part;
  });

  return changed ? reconciled : parts;
}

export function reconcileInterruptedMessage<T extends MessageTimestampFields>(
  message: Message<T>,
  finishedAt: number,
): Message<T> {
  if (message.type === "changed_files") return message;

  if (message.runStatus === "running") {
    return {
      ...message,
      runStatus: "cancelled",
      runFinishedAt: message.runFinishedAt ?? finishedAt,
      parts: reconcileRunningParts(message.parts),
    };
  }

  const parts = reconcileRunningParts(message.parts);
  return parts === message.parts ? message : { ...message, parts };
}
