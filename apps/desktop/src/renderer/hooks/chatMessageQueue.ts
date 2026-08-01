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
// Composer draft. Hydrated from the App State Snapshot on load and serialized
// back into it through the debounced App State save; queue items recovered
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
    ...(draft.composerState ? { composerState: draft.composerState } : {}),
    attachedSkillNames: [...draft.attachedSkillNames],
    attachments: draft.attachments.map((attachment) => ({ ...attachment })),
  };
}

export function getThreadDraft(threadId: string): ThreadWorkDraftSnapshot | null {
  const draft = draftByThreadId.get(threadId);
  return draft ? copyDraft(draft) : null;
}

export function getThreadDraftSnapshotKey(threadId: string): string {
  return JSON.stringify(draftByThreadId.get(threadId) ?? null);
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

// Replaces all in-memory queues/drafts with loaded App State. An
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

function queueContentOf(queue: QueuedChatMessage[] | undefined) {
  return (queue ?? []).map((item) => ({
    id: item.id,
    content: item.content,
    attachments: item.attachments ?? [],
  }));
}

function workEntriesEqual(
  draft: ThreadWorkDraftSnapshot | undefined,
  queue: QueuedChatMessage[] | undefined,
  work: ThreadWorkSnapshot,
): boolean {
  return (
    JSON.stringify(draft ?? null) === JSON.stringify(work.draft ?? null) &&
    JSON.stringify(queueContentOf(queue)) === JSON.stringify(queueContentOf(work.queuedMessages))
  );
}

// Applies authoritative Thread work from an App State broadcast: Threads
// without a pending local edit converge on the broadcast; Threads the user is
// editing already match (the broadcast merge keeps their local entry), so a
// dumb full sync never clobbers an in-progress composer. Queue items known
// locally keep their requiresConfirmation flag — the persisted form forces it
// for crash recovery, but a live queue must stay steerable.
export function syncThreadWorkFromSnapshot(threadWork: Record<string, ThreadWorkSnapshot>): void {
  let changed = false;
  const threadIds = new Set([...draftByThreadId.keys(), ...queueByThreadId.keys()]);
  for (const threadId of threadIds) {
    if (threadId in threadWork) continue;
    changed = draftByThreadId.delete(threadId) || changed;
    changed = queueByThreadId.delete(threadId) || changed;
  }
  for (const [threadId, work] of Object.entries(threadWork)) {
    const localQueue = queueByThreadId.get(threadId);
    if (workEntriesEqual(draftByThreadId.get(threadId), localQueue, work)) {
      continue;
    }
    if (work.draft) {
      draftByThreadId.set(threadId, copyDraft(work.draft));
    } else {
      draftByThreadId.delete(threadId);
    }
    const queue = (work.queuedMessages ?? []).map((item) => {
      const local = localQueue?.find(
        (queued) =>
          queued.id === item.id &&
          queued.content === item.content &&
          JSON.stringify(queued.attachments ?? []) === JSON.stringify(item.attachments ?? []),
      );
      return local ?? { ...item };
    });
    if (queue.length > 0) {
      queueByThreadId.set(threadId, queue);
    } else {
      queueByThreadId.delete(threadId);
    }
    changed = true;
  }
  if (changed) emit();
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
