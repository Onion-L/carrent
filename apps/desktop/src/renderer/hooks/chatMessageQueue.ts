import { useSyncExternalStore } from "react";
import type { AttachmentMetadata } from "../../shared/chat";
import type { LocalPathContextItem } from "../../shared/localPathContext";
import type {
  ThreadWorkDraftSnapshot,
  ThreadWorkSnapshot,
} from "../../shared/workspacePersistence";

export type QueuedChatMessage = {
  id: string;
  content: string;
  attachments?: AttachmentMetadata[];
  localPathContexts?: LocalPathContextItem[];
  skillReadPaths?: string[];
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
// Ids of items this renderer enqueued itself. A mid-session broadcast can
// briefly drop and re-add such an item (stale snapshot racing a local push),
// and the re-added copy comes from the persisted form, which force-stamps
// requiresConfirmation for crash recovery. Membership here proves the item
// is live, not recovered, so the sync keeps it auto-sendable.
const liveQueuedItemIds = new Set<string>();
// Ids this renderer has already dispatched (shifted for send) or deliberately
// removed. A stale App State broadcast can still carry the persisted copy of
// such an item; membership here proves the id is spent, so a sync must not
// resurrect it. `unshiftQueuedChatMessage` clears the tombstone when a failed
// send legitimately returns the item to the queue.
const spentQueuedItemIds = new Set<string>();

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
  liveQueuedItemIds.add(item.id);
  spentQueuedItemIds.delete(item.id);
  queueByThreadId.set(threadId, [...getQueuedMessages(threadId), item]);
  emit();
}

export function removeQueuedChatMessage(threadId: string, id: string): void {
  liveQueuedItemIds.delete(id);
  spentQueuedItemIds.add(id);
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
  liveQueuedItemIds.delete(first.id);
  spentQueuedItemIds.add(first.id);
  emit();
  return first;
}

export function unshiftQueuedChatMessage(threadId: string, item: QueuedChatMessage): void {
  // Only live items belong in the set; re-queuing a recovered item (e.g. a
  // failed Steer) must not make it auto-sendable.
  if (item.requiresConfirmation !== true) {
    liveQueuedItemIds.add(item.id);
  }
  // A failed send returns the item to the queue, so it is no longer spent.
  spentQueuedItemIds.delete(item.id);
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
    ...(draft.localPathContexts
      ? { localPathContexts: draft.localPathContexts.map((item) => ({ ...item })) }
      : {}),
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
    for (const item of getQueuedMessages(threadId)) {
      liveQueuedItemIds.delete(item.id);
      spentQueuedItemIds.delete(item.id);
    }
    changed = draftByThreadId.delete(threadId) || changed;
    changed = queueByThreadId.delete(threadId) || changed;
  }
  if (changed) {
    emit();
  }
}

// Clears a Thread's queued messages without touching its Composer draft.
// Used when archiving a Thread mid-run so a stale queue does not outlive it.
export function clearQueuedMessages(threadId: string): void {
  for (const item of getQueuedMessages(threadId)) {
    liveQueuedItemIds.delete(item.id);
  }
  if (!queueByThreadId.delete(threadId)) {
    return;
  }
  emit();
}

// Replaces all in-memory queues/drafts with loaded App State. An
// absent or empty snapshot clears stale state (fresh start or failed load).
export function hydrateThreadWork(
  threadWork: Record<string, ThreadWorkSnapshot> | null | undefined,
): void {
  queueByThreadId.clear();
  draftByThreadId.clear();
  liveQueuedItemIds.clear();
  spentQueuedItemIds.clear();

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
    localPathContexts: item.localPathContexts ?? [],
    skillReadPaths: item.skillReadPaths ?? [],
  }));
}

// Compares drafts by semantic content only (text, skills, attachments, Local
// Path Context), ignoring `composerState`. The serialized editor state changes
// on every keystroke (Lexical node keys, selection offsets), so a full-JSON
// compare treats an authority echo of our own draft as "changed", emitting a
// store bump that needlessly re-runs the Composer's readback effect while typing.
function draftsEqualSemantic(
  a: ThreadWorkDraftSnapshot | null | undefined,
  b: ThreadWorkDraftSnapshot | null | undefined,
): boolean {
  const left = a ?? null;
  const right = b ?? null;
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.content === right.content &&
    JSON.stringify(left.attachedSkillNames) === JSON.stringify(right.attachedSkillNames) &&
    JSON.stringify(left.attachments) === JSON.stringify(right.attachments) &&
    JSON.stringify(left.localPathContexts ?? []) === JSON.stringify(right.localPathContexts ?? [])
  );
}

function workEntriesEqual(
  draft: ThreadWorkDraftSnapshot | undefined,
  queue: QueuedChatMessage[] | undefined,
  work: ThreadWorkSnapshot,
): boolean {
  return (
    draftsEqualSemantic(draft, work.draft) &&
    JSON.stringify(queueContentOf(queue)) === JSON.stringify(queueContentOf(work.queuedMessages))
  );
}

// Applies authoritative Thread work from an App State broadcast: Threads
// without a pending local edit converge on the broadcast; Threads the user is
// editing already match (the broadcast merge keeps their local entry), so a
// dumb full sync never clobbers an in-progress composer. Queue items known
// locally keep their requiresConfirmation flag, and items this renderer
// enqueued live have the broadcast copy's flag stripped — the persisted form
// forces it for crash recovery, but a live queue must stay steerable.
export function syncThreadWorkFromSnapshot(threadWork: Record<string, ThreadWorkSnapshot>): void {
  let changed = false;
  // Tombstones for ids no longer present anywhere in the authoritative
  // snapshot have served their purpose; drop them so the set cannot grow.
  if (spentQueuedItemIds.size > 0) {
    const incomingIds = new Set(
      Object.values(threadWork).flatMap((work) =>
        (work.queuedMessages ?? []).map((item) => item.id),
      ),
    );
    for (const id of spentQueuedItemIds) {
      if (!incomingIds.has(id)) {
        spentQueuedItemIds.delete(id);
      }
    }
  }
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
    const queue = (work.queuedMessages ?? []).flatMap((item) => {
      // A spent id was already sent or deliberately removed by this renderer;
      // a broadcast still carrying it is stale and must not resurrect it.
      if (spentQueuedItemIds.has(item.id)) {
        return [];
      }
      const local = localQueue?.find(
        (queued) =>
          queued.id === item.id &&
          queued.content === item.content &&
          JSON.stringify(queued.attachments ?? []) === JSON.stringify(item.attachments ?? []) &&
          JSON.stringify(queued.localPathContexts ?? []) ===
            JSON.stringify(item.localPathContexts ?? []) &&
          JSON.stringify(queued.skillReadPaths ?? []) === JSON.stringify(item.skillReadPaths ?? []),
      );
      if (local) return [local];
      const copy = { ...item };
      // A live item this renderer enqueued stays auto-sendable even when the
      // broadcast copy carries the persisted crash-recovery flag.
      if (liveQueuedItemIds.has(copy.id)) {
        delete copy.requiresConfirmation;
      }
      return [copy];
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
