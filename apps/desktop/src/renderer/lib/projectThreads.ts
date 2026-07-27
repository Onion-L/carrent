import type { Message } from "../../shared/threadContent";
import type { AppThreadRecord } from "../../shared/workspacePersistence";

export type ThreadDisplayStatus = "running" | "approval" | "question" | "failed";
export type AttentionStatus = Exclude<ThreadDisplayStatus, "running">;

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
  // Approvals and structured questions share the attention tier: both block
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

function sortByActivity<T extends AppThreadRecord>(threads: T[], messages: Message[]) {
  return threads
    .map((thread, index) => ({
      thread,
      index,
      activityAt: getThreadActivityTime(thread, messages),
    }))
    .sort((a, b) => {
      const activityDiff = (b.activityAt ?? -Infinity) - (a.activityAt ?? -Infinity);
      return activityDiff || a.index - b.index;
    })
    .map(({ thread }) => thread);
}

export function getAttentionGroups<T extends AppThreadRecord>({
  threads,
  runningThreadIds,
  pendingApprovals,
  pendingQuestions,
  messages,
}: {
  threads: T[];
  runningThreadIds: string[];
  pendingApprovals: Array<{ threadId: string }>;
  pendingQuestions: Array<{ threadId: string }>;
  messages: Message[];
}) {
  const groups: Array<{ status: AttentionStatus; threads: T[] }> = [
    { status: "approval", threads: [] },
    { status: "question", threads: [] },
    { status: "failed", threads: [] },
  ];

  for (const thread of threads) {
    const status = getThreadDisplayStatus({
      threadId: thread.id,
      runningThreadIds,
      pendingApprovals,
      pendingQuestions,
      messages,
    });
    const group = groups.find((item) => item.status === status);
    if (group) group.threads.push(thread);
  }

  return groups
    .map((group) => ({ ...group, threads: sortByActivity(group.threads, messages) }))
    .filter((group) => group.threads.length > 0);
}

export function splitProjectThreads(threads: AppThreadRecord[], messages: Message[] = []) {
  const pinned = threads.filter((thread) => thread.pinned);
  const regular = threads.filter((thread) => !thread.pinned);

  return {
    active: [...sortByActivity(pinned, messages), ...sortByActivity(regular, messages)],
  };
}

export function filterProjectThreads(threads: AppThreadRecord[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return threads;
  }
  return threads.filter((thread) => thread.title.toLocaleLowerCase().includes(normalizedQuery));
}
