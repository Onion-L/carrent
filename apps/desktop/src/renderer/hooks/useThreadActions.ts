import { useCallback, useSyncExternalStore } from "react";

import type { ThreadActionRequest, ThreadActionResult } from "../../shared/threadActions";

let compactingThreadIds: string[] = [];
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return compactingThreadIds;
}

export function hasActiveThreadActionForThread(threadId: string) {
  return compactingThreadIds.includes(threadId);
}

export function useThreadActions() {
  const activeThreadIds = useSyncExternalStore(subscribe, getSnapshot);

  const execute = useCallback(async (request: ThreadActionRequest): Promise<ThreadActionResult> => {
    if (compactingThreadIds.includes(request.threadId)) {
      throw new Error("This Thread is already compacting.");
    }
    if (!window.carrent.chat.executeThreadAction) {
      throw new Error("Thread Actions are unavailable. Restart Carrent and try again.");
    }

    compactingThreadIds = [...compactingThreadIds, request.threadId];
    emit();
    try {
      return await window.carrent.chat.executeThreadAction(request);
    } finally {
      compactingThreadIds = compactingThreadIds.filter((id) => id !== request.threadId);
      emit();
    }
  }, []);

  return { compactingThreadIds: activeThreadIds, execute };
}
