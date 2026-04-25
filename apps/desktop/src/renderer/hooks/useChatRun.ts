import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatTurnRequest, ChatRunEvent } from "../../shared/chat";

export type ChatRunCallbacks = {
  onDelta?: (text: string) => void;
  onComplete?: (text: string) => void;
  onError?: (error: string) => void;
  onStop?: () => void;
};

type ChatRunStoreListener = {
  setIsSending: (value: boolean) => void;
  setLastError: (value: string | null) => void;
};

let activeCallbacks:
  | (ChatRunCallbacks & {
      runId: string;
    })
  | null = null;
let teardownChatListener: VoidFunction | null = null;
const storeListeners = new Set<ChatRunStoreListener>();

function notifyIsSending(value: boolean) {
  storeListeners.forEach((listener) => listener.setIsSending(value));
}

function notifyLastError(value: string | null) {
  storeListeners.forEach((listener) => listener.setLastError(value));
}

function ensureChatListener() {
  if (teardownChatListener) {
    return;
  }

  teardownChatListener = window.carrent.chat.onEvent((event: ChatRunEvent) => {
    const pending = activeCallbacks;
    if (!pending || event.runId !== pending.runId) return;

    if (event.type === "delta") {
      pending.onDelta?.(event.text);
    } else if (event.type === "completed") {
      notifyIsSending(false);
      pending.onComplete?.(event.text);
      activeCallbacks = null;
    } else if (event.type === "failed") {
      notifyIsSending(false);
      notifyLastError(event.error);
      pending.onError?.(event.error);
      activeCallbacks = null;
    } else if (event.type === "stopped") {
      notifyIsSending(false);
      pending.onStop?.();
      activeCallbacks = null;
    }
  });
}

export function useChatRun() {
  const [isSending, setIsSending] = useState(activeCallbacks !== null);
  const [lastError, setLastError] = useState<string | null>(null);
  const storeListenerRef = useRef<ChatRunStoreListener>({
    setIsSending,
    setLastError,
  });

  storeListenerRef.current = {
    setIsSending,
    setLastError,
  };

  useEffect(() => {
    ensureChatListener();

    const listener = storeListenerRef.current;
    storeListeners.add(listener);
    return () => {
      storeListeners.delete(listener);
    };
  }, []);

  const pendingRef = useRef<
    | (ChatRunCallbacks & {
        runId: string;
      })
    | null
  >(null);

  useEffect(() => {
    pendingRef.current = activeCallbacks;
  }, []);

  const send = useCallback(
    async (request: ChatTurnRequest, callbacks: ChatRunCallbacks) => {
      ensureChatListener();
      setIsSending(true);
      setLastError(null);
      notifyIsSending(true);
      notifyLastError(null);

      try {
        const { runId } = await window.carrent.chat.send(request);
        const nextPending = { runId, ...callbacks };
        pendingRef.current = nextPending;
        activeCallbacks = nextPending;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setIsSending(false);
        setLastError(message);
        notifyIsSending(false);
        notifyLastError(message);
        callbacks.onError?.(message);
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    const pending = pendingRef.current ?? activeCallbacks;
    if (pending) {
      await window.carrent.chat.stop(pending.runId);
    }
  }, []);

  return { isSending, lastError, send, stop };
}
