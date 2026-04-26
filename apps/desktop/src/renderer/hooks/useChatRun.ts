import { useCallback, useEffect, useState } from "react";

import type {
  ChatReasoningEventPayload,
  ChatRunEvent,
  ChatShellEventPayload,
  ChatTurnRequest,
} from "../../shared/chat";

export type ChatRunCallbacks = {
  onDelta?: (text: string) => void;
  onReasoning?: (reasoning: ChatReasoningEventPayload) => void;
  onShell?: (shell: ChatShellEventPayload) => void;
  onComplete?: (text: string) => void;
  onError?: (error: string) => void;
  onStop?: () => void;
};

type ChatRunSnapshot = {
  isSending: boolean;
  lastError: string | null;
};

type ChatRunStoreListener = () => void;

type PendingChatRun = {
  requestKey: string;
  runId: string | null;
  callbacks: ChatRunCallbacks;
};

export function createChatRunCoordinator() {
  let snapshot: ChatRunSnapshot = {
    isSending: false,
    lastError: null,
  };
  let pending: PendingChatRun | null = null;
  const listeners = new Set<ChatRunStoreListener>();

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const clearPending = () => {
    pending = null;
  };

  const finishPendingRun = () => {
    clearPending();
    snapshot = {
      ...snapshot,
      isSending: false,
    };
    emit();
  };

  return {
    subscribe(listener: ChatRunStoreListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    getPendingRunId() {
      return pending?.runId ?? null;
    },
    beginRequest(requestKey: string, callbacks: ChatRunCallbacks) {
      pending = {
        requestKey,
        runId: null,
        callbacks,
      };
      snapshot = {
        isSending: true,
        lastError: null,
      };
      emit();
    },
    attachRunId(requestKey: string, runId: string) {
      if (!pending || pending.requestKey !== requestKey) {
        return;
      }

      pending = {
        ...pending,
        runId,
      };
    },
    failRequest(requestKey: string, error: string) {
      if (!pending || pending.requestKey !== requestKey) {
        return;
      }

      snapshot = {
        isSending: false,
        lastError: error,
      };
      pending.callbacks.onError?.(error);
      clearPending();
      emit();
    },
    handleEvent(event: ChatRunEvent) {
      if (!pending) {
        return;
      }

      const matchesRequestKey =
        typeof event.requestKey === "string" && event.requestKey === pending.requestKey;
      const matchesRunId = typeof pending.runId === "string" && event.runId === pending.runId;

      if (!matchesRequestKey && !matchesRunId) {
        return;
      }

      if (!pending.runId) {
        pending = {
          ...pending,
          runId: event.runId,
        };
      }

      if (event.type === "delta") {
        pending.callbacks.onDelta?.(event.text);
        return;
      }

      if (event.type === "reasoning") {
        pending.callbacks.onReasoning?.(event.reasoning);
        return;
      }

      if (event.type === "shell") {
        pending.callbacks.onShell?.(event.shell);
        return;
      }

      if (event.type === "completed") {
        pending.callbacks.onComplete?.(event.text);
        finishPendingRun();
        return;
      }

      if (event.type === "failed") {
        snapshot = {
          isSending: false,
          lastError: event.error,
        };
        pending.callbacks.onError?.(event.error);
        clearPending();
        emit();
        return;
      }

      if (event.type === "stopped") {
        pending.callbacks.onStop?.();
        finishPendingRun();
      }
    },
  };
}

const chatRunCoordinator = createChatRunCoordinator();
let teardownChatListener: VoidFunction | null = null;

function createRequestKey() {
  return `request-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function ensureChatListener() {
  if (teardownChatListener) {
    return;
  }

  teardownChatListener = window.carrent.chat.onEvent((event: ChatRunEvent) => {
    chatRunCoordinator.handleEvent(event);
  });
}

export function useChatRun() {
  const [snapshot, setSnapshot] = useState(() => chatRunCoordinator.getSnapshot());

  useEffect(() => {
    ensureChatListener();

    return chatRunCoordinator.subscribe(() => {
      setSnapshot(chatRunCoordinator.getSnapshot());
    });
  }, []);

  const send = useCallback(async (request: ChatTurnRequest, callbacks: ChatRunCallbacks) => {
    ensureChatListener();
    const requestKey = createRequestKey();
    chatRunCoordinator.beginRequest(requestKey, callbacks);

    try {
      const { runId } = await window.carrent.chat.send({
        ...request,
        requestKey,
      });
      chatRunCoordinator.attachRunId(requestKey, runId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      chatRunCoordinator.failRequest(requestKey, message);
    }
  }, []);

  const stop = useCallback(async () => {
    const runId = chatRunCoordinator.getPendingRunId();
    if (runId) {
      await window.carrent.chat.stop(runId);
    }
  }, []);

  return {
    isSending: snapshot.isSending,
    lastError: snapshot.lastError,
    send,
    stop,
  };
}
