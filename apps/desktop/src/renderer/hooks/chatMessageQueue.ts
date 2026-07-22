import { useSyncExternalStore } from "react";
import type { ImageAttachmentMetadata } from "../../shared/chat";

export type QueuedChatMessage = {
  id: string;
  content: string;
  attachments?: ImageAttachmentMetadata[];
};

// Transient per-thread FIFO for messages composed while a run is active.
// Not persisted: a restart clears every queue.
const queueByThreadId = new Map<string, QueuedChatMessage[]>();
const listeners = new Set<() => void>();
const EMPTY_QUEUE: QueuedChatMessage[] = [];

const emit = () => {
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

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useQueuedMessages(threadId: string): QueuedChatMessage[] {
  return useSyncExternalStore(subscribe, () => getQueuedMessages(threadId));
}
