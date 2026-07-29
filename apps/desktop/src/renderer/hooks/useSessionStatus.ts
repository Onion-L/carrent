import { useCallback, useEffect, useSyncExternalStore } from "react";

import type { KimiSessionStatus } from "../../shared/chat";

type SessionStatusState = {
  contextKey: string;
  snapshot: KimiSessionStatus | null;
  loading: boolean;
  error: string | null;
  requestId: number;
  discardResult: boolean;
};

const emptyState: SessionStatusState = {
  contextKey: "",
  snapshot: null,
  loading: false,
  error: null,
  requestId: 0,
  discardResult: false,
};

let states: Record<string, SessionStatusState> = {};
let nextRequestId = 1;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return states;
}

function replaceState(threadId: string, state: SessionStatusState | null) {
  if (state) {
    states = { ...states, [threadId]: state };
  } else {
    const { [threadId]: _removed, ...remaining } = states;
    states = remaining;
  }
  emit();
}

function createState(contextKey: string): SessionStatusState {
  return { ...emptyState, contextKey };
}

export function useSessionStatus(threadId: string, contextKey: string) {
  const currentStates = useSyncExternalStore(subscribe, getSnapshot);
  const storedState = currentStates[threadId];
  const state = storedState?.contextKey === contextKey ? storedState : emptyState;

  useEffect(() => {
    const current = states[threadId];
    if (current?.contextKey !== contextKey) {
      replaceState(threadId, createState(contextKey));
    }

    return () => {
      const leaving = states[threadId];
      if (leaving?.contextKey !== contextKey) return;
      if (leaving.loading) {
        replaceState(threadId, {
          ...leaving,
          snapshot: null,
          error: null,
          discardResult: false,
        });
      } else {
        replaceState(threadId, null);
      }
    };
  }, [contextKey, threadId]);

  const begin = useCallback(() => {
    const current = states[threadId];
    if (current?.contextKey !== contextKey || current.loading) return null;
    const requestId = nextRequestId++;
    replaceState(threadId, {
      ...current,
      loading: true,
      error: null,
      requestId,
      discardResult: false,
    });
    return requestId;
  }, [contextKey, threadId]);

  const succeed = useCallback(
    (requestId: number, snapshot: KimiSessionStatus) => {
      const current = states[threadId];
      if (current?.contextKey !== contextKey || current.requestId !== requestId) return false;
      replaceState(threadId, {
        ...current,
        snapshot: current.discardResult ? null : snapshot,
        loading: false,
        error: null,
        discardResult: false,
      });
      return !current.discardResult;
    },
    [contextKey, threadId],
  );

  const fail = useCallback(
    (requestId: number, error: string) => {
      const current = states[threadId];
      if (current?.contextKey !== contextKey || current.requestId !== requestId) return;
      replaceState(threadId, {
        ...current,
        loading: false,
        error: current.discardResult ? null : error,
        discardResult: false,
      });
    },
    [contextKey, threadId],
  );

  const dismiss = useCallback(() => {
    const current = states[threadId];
    if (current?.contextKey !== contextKey) return;
    replaceState(threadId, {
      ...current,
      snapshot: null,
      error: null,
      discardResult: current.loading,
    });
  }, [contextKey, threadId]);

  const reportError = useCallback(
    (error: string) => {
      const current = states[threadId];
      if (current?.contextKey !== contextKey) return;
      replaceState(threadId, { ...current, error });
    },
    [contextKey, threadId],
  );

  return { ...state, begin, succeed, fail, dismiss, clear: dismiss, reportError };
}
