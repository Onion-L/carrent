import type { Message } from "../../shared/threadContent";
import type { AppThreadRecord } from "../../shared/workspacePersistence";

export type ThreadDisplayStatus = "running" | "approval" | "question" | "failed";

function parseTimestamp(value: string | undefined) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function getThreadActivityTime(thread: AppThreadRecord, messages: Message[]) {
  const persistedActivity = parseTimestamp(thread.lastActivityAt);
  if (persistedActivity !== null) {
    return persistedActivity;
  }

  let latestMessageAt: number | null = null;
  for (const message of messages) {
    if (message.threadId === thread.id && message.createdAt !== undefined) {
      const createdAt =
        typeof message.createdAt === "number" ? message.createdAt : Date.parse(message.createdAt);
      if (Number.isFinite(createdAt)) {
        latestMessageAt = Math.max(latestMessageAt ?? createdAt, createdAt);
      }
    }
  }
  return latestMessageAt;
}

export function getThreadDisplayStatus({
  threadId,
  runningThreadIds,
  pendingApprovals,
  pendingQuestions,
  messages,
}: {
  threadId: string;
  runningThreadIds: string[];
  pendingApprovals: Array<{ threadId: string }>;
  pendingQuestions: Array<{ threadId: string }>;
  messages: Message[];
}): ThreadDisplayStatus | null {
  // Approvals and structured questions share the blocking tier: both pause
  // the Run on user input and outrank a plain running or failed state.
  if (pendingApprovals.some((approval) => approval.threadId === threadId)) {
    return "approval";
  }
  if (pendingQuestions.some((question) => question.threadId === threadId)) {
    return "question";
  }
  if (runningThreadIds.includes(threadId)) {
    return "running";
  }
  let latestAssistantMessage: Message | undefined;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message.threadId === threadId &&
      message.role === "assistant" &&
      message.type !== "changed_files"
    ) {
      latestAssistantMessage = message;
      break;
    }
  }
  return latestAssistantMessage?.runStatus === "failed" ? "failed" : null;
}

export function getProjectThreads(threads: AppThreadRecord[]) {
  return [...threads].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1;
    }
    return right.lastActivityAt.localeCompare(left.lastActivityAt);
  });
}

export function filterProjectThreads(threads: AppThreadRecord[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return threads;
  }
  return threads.filter((thread) => thread.title.toLocaleLowerCase().includes(normalizedQuery));
}
