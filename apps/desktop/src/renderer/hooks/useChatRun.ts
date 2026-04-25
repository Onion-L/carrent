import { useState, useEffect, useRef, useCallback } from "react";
import type { ChatTurnRequest, ChatRunEvent } from "../../shared/chat";

export type ChatRunCallbacks = {
  onDelta?: (text: string) => void;
  onComplete?: (text: string) => void;
  onError?: (error: string) => void;
  onStop?: () => void;
};

export function useChatRun() {
  const [isSending, setIsSending] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const pendingRef = useRef<
    | (ChatRunCallbacks & {
        runId: string;
      })
    | null
  >(null);

  useEffect(() => {
    return window.carrent.chat.onEvent((event: ChatRunEvent) => {
      const pending = pendingRef.current;
      if (!pending || event.runId !== pending.runId) return;

      if (event.type === "delta") {
        pending.onDelta?.(event.text);
      } else if (event.type === "completed") {
        setIsSending(false);
        pending.onComplete?.(event.text);
        pendingRef.current = null;
      } else if (event.type === "failed") {
        setIsSending(false);
        setLastError(event.error);
        pending.onError?.(event.error);
        pendingRef.current = null;
      } else if (event.type === "stopped") {
        setIsSending(false);
        pending.onStop?.();
        pendingRef.current = null;
      }
    });
  }, []);

  const send = useCallback(
    async (request: ChatTurnRequest, callbacks: ChatRunCallbacks) => {
      setIsSending(true);
      setLastError(null);
      try {
        const { runId } = await window.carrent.chat.send(request);
        pendingRef.current = { runId, ...callbacks };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setIsSending(false);
        setLastError(message);
        callbacks.onError?.(message);
      }
    },
    [],
  );

  const stop = useCallback(async () => {
    if (pendingRef.current) {
      await window.carrent.chat.stop(pendingRef.current.runId);
    }
  }, []);

  return { isSending, lastError, send, stop };
}
