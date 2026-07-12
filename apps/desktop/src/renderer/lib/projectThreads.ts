import type { Message, ThreadRecord } from "../mock/uiShellData";

export type ThreadDisplayStatus = "running" | "approval" | "failed";

function parseTimestamp(value: string | undefined) {
  if (!value) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

export function getThreadActivityTime(thread: ThreadRecord, messages: Message[]) {
  const persistedActivity = parseTimestamp(thread.lastActivityAt);
  if (persistedActivity !== null) {
    return persistedActivity;
  }

  let latestMessageAt: number | null = null;
  for (const message of messages) {
    if (
      message.threadId === thread.id &&
      typeof message.createdAt === "number" &&
      Number.isFinite(message.createdAt)
    ) {
      latestMessageAt = Math.max(latestMessageAt ?? message.createdAt, message.createdAt);
    }
  }
  return latestMessageAt ?? parseTimestamp(thread.updatedAt);
}

export function getThreadDisplayStatus({
  threadId,
  runningThreadIds,
  pendingApprovals,
  messages,
}: {
  threadId: string;
  runningThreadIds: string[];
  pendingApprovals: Array<{ threadId: string }>;
  messages: Message[];
}): ThreadDisplayStatus | null {
  if (pendingApprovals.some((approval) => approval.threadId === threadId)) {
    return "approval";
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

function sortByActivity(threads: ThreadRecord[], messages: Message[]) {
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

export function splitProjectThreads(threads: ThreadRecord[], messages: Message[] = []) {
  const visible = threads.filter((thread) => !thread.draft);
  const pinned = visible.filter((thread) => thread.pinned);
  const regular = visible.filter((thread) => !thread.pinned);

  return {
    active: [...sortByActivity(pinned, messages), ...sortByActivity(regular, messages)],
  };
}

export function filterProjectThreads(threads: ThreadRecord[], query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return threads;
  }
  return threads.filter((thread) => thread.title.toLocaleLowerCase().includes(normalizedQuery));
}
