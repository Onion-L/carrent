import { useSyncExternalStore } from "react";
import type { AttachmentMetadata } from "../../shared/chat";
import type {
  ThreadWorkDraftSnapshot,
  ThreadWorkSnapshot,
} from "../../shared/workspacePersistence";

export type QueuedChatMessage = {
  id: string;
  content: string;
  attachments?: AttachmentMetadata[];
  requiresConfirmation?: boolean;
};

export type { ThreadWorkDraftSnapshot, ThreadWorkSnapshot };

// Per-thread FIFO for messages composed while a run is active, plus the
// Composer draft. Hydrated from the workspace snapshot on load and serialized
// back into it through the debounced workspace save; queue items recovered
// from disk require an explicit Send/Steer before they can start a Run.
const queueByThreadId = new Map<string, QueuedChatMessage[]>();
const draftByThreadId = new Map<string, ThreadWorkDraftSnapshot>();
const listeners = new Set<() => void>();
const EMPTY_QUEUE: QueuedChatMessage[] = [];

let version = 0;
let cachedSnapshotKey: string | null = null;
let cachedSnapshot: Record<string, ThreadWorkSnapshot> = {};

const emit = () => {
  version += 1;
  listeners.forEach((listener) => listener());
};

export function getQueuedMessages(threadId: string): QueuedChatMessage[] {
  return queueByThreadId.get(threadId) ?? EMPTY_QUEUE;
}

export function enqueueChatMessage(threadId: string, item: QueuedChatMessage): void {
  queueByThreadId.set(threadId, [...getQueuedMessages(threadId), item]);
  emit();
}

export function removeQueuedChatMessage(threadId: string, id: string): void {
  const next = getQueuedMessages(threadId).filter((item) => item.id !== id);
  if (next.length === 0) {
    queueByThreadId.delete(threadId);
  } else {
    queueByThreadId.set(threadId, next);
  }
  emit();
}

export function shiftQueuedChatMessage(
  threadId: string,
  options: { blockedId?: string | null } = {},
): QueuedChatMessage | null {
  const [first, ...rest] = getQueuedMessages(threadId);
  if (!first || first.id === options.blockedId) {
    return null;
  }
  // A recovered head item requires an explicit Send/Steer; the completion
  // path must never auto-send it.
  if (first.requiresConfirmation === true) {
    return null;
  }
  if (rest.length === 0) {
    queueByThreadId.delete(threadId);
  } else {
    queueByThreadId.set(threadId, rest);
  }
  emit();
  return first;
}

export function unshiftQueuedChatMessage(threadId: string, item: QueuedChatMessage): void {
  queueByThreadId.set(threadId, [item, ...getQueuedMessages(threadId)]);
  emit();
}

export function updateQueuedChatMessage(threadId: string, id: string, content: string): void {
  const queue = getQueuedMessages(threadId);
  if (!queue.some((item) => item.id === id)) {
    return;
  }
  queueByThreadId.set(
    threadId,
    queue.map((item) => (item.id === id ? { ...item, content } : item)),
  );
  emit();
}

function copyDraft(draft: ThreadWorkDraftSnapshot): ThreadWorkDraftSnapshot {
  return {
    content: draft.content,
    attachedSkillNames: [...draft.attachedSkillNames],
    attachments: draft.attachments.map((attachment) => ({ ...attachment })),
  };
}

export function getThreadDraft(threadId: string): ThreadWorkDraftSnapshot | null {
  const draft = draftByThreadId.get(threadId);
  return draft ? copyDraft(draft) : null;
}

export function setThreadDraft(threadId: string, draft: ThreadWorkDraftSnapshot): void {
  draftByThreadId.set(threadId, copyDraft(draft));
  emit();
}

export function clearThreadDraft(threadId: string): void {
  if (!draftByThreadId.delete(threadId)) {
    return;
  }
  emit();
}

export function removeThreadWork(threadIds: string[]): void {
  let changed = false;
  for (const threadId of threadIds) {
    changed = draftByThreadId.delete(threadId) || changed;
    changed = queueByThreadId.delete(threadId) || changed;
  }
  if (changed) {
    emit();
  }
}

// Replaces all in-memory queues/drafts with a loaded workspace snapshot. An
// absent or empty snapshot clears stale state (fresh start or failed load).
export function hydrateThreadWork(
  threadWork: Record<string, ThreadWorkSnapshot> | null | undefined,
): void {
  queueByThreadId.clear();
  draftByThreadId.clear();

  if (threadWork) {
    for (const [threadId, work] of Object.entries(threadWork)) {
      if (work.draft) {
        draftByThreadId.set(threadId, copyDraft(work.draft));
      }
      const queue = (work.queuedMessages ?? []).map((item) => ({
        ...item,
        requiresConfirmation: true,
      }));
      if (queue.length > 0) {
        queueByThreadId.set(threadId, queue);
      }
    }
  }
  emit();
}

export function getThreadWorkVersion(): number {
  return version;
}

// Stable per-(version, thread ids) snapshot for the workspace save path;
// callers must not mutate the returned record.
export function getThreadWorkSnapshot(threadIds: string[]): Record<string, ThreadWorkSnapshot> {
  const key = `${version}:${threadIds.join(" ")}`;
  if (cachedSnapshotKey === key) {
    return cachedSnapshot;
  }

  const snapshot: Record<string, ThreadWorkSnapshot> = {};
  for (const threadId of threadIds) {
    const draft = draftByThreadId.get(threadId);
    const queue = queueByThreadId.get(threadId) ?? [];
    if (!draft && queue.length === 0) {
      continue;
    }
    snapshot[threadId] = {
      ...(draft ? { draft: copyDraft(draft) } : {}),
      queuedMessages: queue.map((item) => ({ ...item })),
    };
  }

  cachedSnapshotKey = key;
  cachedSnapshot = snapshot;
  return snapshot;
}

export function subscribeToThreadWork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useQueuedMessages(threadId: string): QueuedChatMessage[] {
  return useSyncExternalStore(subscribeToThreadWork, () => getQueuedMessages(threadId));
}
