import { useCallback, useEffect, useState } from "react";

import type {
  ChatReasoningEventPayload,
  ChatRunEvent,
  ChatShellEventPayload,
  ChatTurnRequest,
} from "../../shared/chat";
import type { ChatPermissionRequest, ChatPermissionResponse } from "../../shared/chatPermissions";

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
  activeThreadId: string | null;
  runningThreadIds: string[];
  pendingPermissions: ChatPermissionRequest[];
};

type ChatRunStoreListener = () => void;

type PendingChatRun = {
  requestKey: string;
  runId: string | null;
  threadId: string;
  callbacks: ChatRunCallbacks;
};

export function createChatRunCoordinator() {
  let snapshot: ChatRunSnapshot = {
    isSending: false,
    lastError: null,
    activeThreadId: null,
    runningThreadIds: [],
    pendingPermissions: [],
  };
  const pendingByRequestKey = new Map<string, PendingChatRun>();
  const requestKeyByRunId = new Map<string, string>();
  const requestKeyByThreadId = new Map<string, string>();
  const listeners = new Set<ChatRunStoreListener>();
  const pendingPermissionById = new Map<string, ChatPermissionRequest>();

  const updateSnapshot = (lastError = snapshot.lastError) => {
    const runningThreadIds = [...requestKeyByThreadId.keys()];
    snapshot = {
      isSending: runningThreadIds.length > 0,
      lastError,
      activeThreadId: runningThreadIds[0] ?? null,
      runningThreadIds,
      pendingPermissions: [...pendingPermissionById.values()],
    };
  };

  const emit = () => {
    listeners.forEach((listener) => listener());
  };

  const clearPending = (run: PendingChatRun) => {
    pendingByRequestKey.delete(run.requestKey);
    requestKeyByThreadId.delete(run.threadId);
    if (run.runId) {
      requestKeyByRunId.delete(run.runId);
    }
  };

  const finishPendingRun = (run: PendingChatRun) => {
    clearPending(run);
    updateSnapshot();
    emit();
  };

  const getRunForEvent = (event: ChatRunEvent) => {
    const requestKey =
      typeof event.requestKey === "string" ? event.requestKey : requestKeyByRunId.get(event.runId);
    return requestKey ? (pendingByRequestKey.get(requestKey) ?? null) : null;
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
    getPendingRunId(threadId?: string) {
      if (threadId) {
        const requestKey = requestKeyByThreadId.get(threadId);
        return requestKey ? (pendingByRequestKey.get(requestKey)?.runId ?? null) : null;
      }

      return [...pendingByRequestKey.values()].find((run) => run.runId)?.runId ?? null;
    },
    beginRequest(requestKey: string, threadId: string, callbacks: ChatRunCallbacks) {
      if (requestKeyByThreadId.has(threadId)) {
        return false;
      }

      const run: PendingChatRun = {
        requestKey,
        runId: null,
        threadId,
        callbacks,
      };
      pendingByRequestKey.set(requestKey, run);
      requestKeyByThreadId.set(threadId, requestKey);
      updateSnapshot(null);
      emit();
      return true;
    },
    attachRunId(requestKey: string, runId: string) {
      const run = pendingByRequestKey.get(requestKey);
      if (!run) {
        return;
      }

      const nextRun = {
        ...run,
        runId,
      };
      pendingByRequestKey.set(requestKey, nextRun);
      requestKeyByRunId.set(runId, requestKey);
    },
    failRequest(requestKey: string, error: string) {
      const run = pendingByRequestKey.get(requestKey);
      if (!run) {
        return;
      }

      run.callbacks.onError?.(error);
      clearPending(run);
      updateSnapshot(error);
      emit();
    },
    handleEvent(event: ChatRunEvent) {
      const run = getRunForEvent(event);

      // permission-failed events should update lastError even if run is not found
      // (run may have already completed/stopped but user should still see the error)
      if (event.type === "permission-failed") {
        if (run) {
          pendingPermissionById.delete(event.permissionId);
        }
        if (event.error) {
          updateSnapshot(event.error);
        } else {
          updateSnapshot();
        }
        emit();
        return;
      }

      if (!run) {
        return;
      }

      if (!run.runId) {
        const nextRun = {
          ...run,
          runId: event.runId,
        };
        pendingByRequestKey.set(run.requestKey, nextRun);
        requestKeyByRunId.set(event.runId, run.requestKey);
      }

      if (event.type === "delta") {
        run.callbacks.onDelta?.(event.text);
        return;
      }

      if (event.type === "reasoning") {
        run.callbacks.onReasoning?.(event.reasoning);
        return;
      }

      if (event.type === "shell") {
        run.callbacks.onShell?.(event.shell);
        return;
      }

      if (event.type === "completed") {
        // Only clear permissions for this specific run
        pendingPermissionById.forEach((perm, id) => {
          if (perm.runId === event.runId) {
            pendingPermissionById.delete(id);
          }
        });
        run.callbacks.onComplete?.(event.text);
        finishPendingRun(run);
        return;
      }

      if (event.type === "failed") {
        // Only clear permissions for this specific run
        pendingPermissionById.forEach((perm, id) => {
          if (perm.runId === event.runId) {
            pendingPermissionById.delete(id);
          }
        });
        run.callbacks.onError?.(event.error);
        clearPending(run);
        updateSnapshot(event.error);
        emit();
        return;
      }

      if (event.type === "stopped") {
        // Only clear permissions for this specific run
        pendingPermissionById.forEach((perm, id) => {
          if (perm.runId === event.runId) {
            pendingPermissionById.delete(id);
          }
        });
        run.callbacks.onStop?.();
        finishPendingRun(run);
        return;
      }

      if (event.type === "permission-requested") {
        pendingPermissionById.set(event.permission.id, event.permission);
        updateSnapshot();
        emit();
        return;
      }

      if (event.type === "permission-resolved") {
        pendingPermissionById.delete(event.permissionId);
        updateSnapshot();
        emit();
        return;
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
    if (!chatRunCoordinator.beginRequest(requestKey, request.threadId, callbacks)) {
      return;
    }

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

  const stop = useCallback(async (threadId?: string) => {
    const runId = chatRunCoordinator.getPendingRunId(threadId);
    if (runId) {
      await window.carrent.chat.stop(runId);
    }
  }, []);

  const respondToPermission = useCallback(
    async (response: ChatPermissionResponse) => {
      await window.carrent.chat.respondToPermission(response);
    },
    [],
  );

  return {
    isSending: snapshot.isSending,
    lastError: snapshot.lastError,
    activeThreadId: snapshot.activeThreadId,
    runningThreadIds: snapshot.runningThreadIds,
    pendingPermissions: snapshot.pendingPermissions,
    send,
    stop,
    respondToPermission,
  };
}
