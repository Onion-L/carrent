import { useCallback, useEffect, useState } from "react";

import type {
  ChatReasoningEventPayload,
  ChatRunEvent,
  ChatShellEventPayload,
  ChatSubagentTaskPayload,
  ChatTurnRequest,
} from "../../shared/chat";
import type { RunChecklistSnapshot } from "../../shared/runChecklist";
import type { ChatPermissionRequest, ChatPermissionResponse } from "../../shared/chatPermissions";
import type { ChatQuestionRequest, ChatQuestionResponse } from "../../shared/chatQuestions";

export type ChatRunCallbacks = {
  onStarted?: (runId: string) => void;
  onDelta?: (text: string) => void;
  onReasoning?: (reasoning: ChatReasoningEventPayload) => void;
  onShell?: (shell: ChatShellEventPayload) => void;
  onSubagentTask?: (task: ChatSubagentTaskPayload) => void;
  onChecklist?: (
    checklist: RunChecklistSnapshot,
    owner: {
      runId: string;
      threadId: string;
      runtimeId: import("../../shared/runtimes").RuntimeId;
    },
  ) => void;
  onPermissionRequested?: (permission: ChatPermissionRequest) => void;
  onPermissionResolved?: (resolution: {
    permissionId: string;
    optionId: string;
    optionName: string;
    optionKind: import("../../shared/chatPermissions").ChatPermissionOptionKind;
  }) => void;
  onPermissionsInterrupted?: (permissions: ChatPermissionRequest[]) => void;
  onQuestionRequested?: (question: ChatQuestionRequest) => void;
  onQuestionResolved?: (resolution: {
    question: ChatQuestionRequest;
    outcome: "answered" | "skipped";
  }) => void;
  onQuestionsInterrupted?: (questions: ChatQuestionRequest[]) => void;
  onPlanModeChanged?: (enabled: boolean) => void;
  onComplete?: (text: string, runId: string) => void;
  onError?: (error: string, runId?: string) => void;
  onStop?: (runId: string) => void;
};

type ChatRunSnapshot = {
  isSending: boolean;
  lastError: string | null;
  activeThreadId: string | null;
  runningThreadIds: string[];
  pendingPermissions: ChatPermissionRequest[];
  pendingQuestions: ChatQuestionRequest[];
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
    pendingQuestions: [],
  };
  const pendingByRequestKey = new Map<string, PendingChatRun>();
  const requestKeyByRunId = new Map<string, string>();
  const requestKeyByThreadId = new Map<string, string>();
  const listeners = new Set<ChatRunStoreListener>();
  const pendingPermissionById = new Map<string, ChatPermissionRequest>();
  const pendingQuestionById = new Map<string, ChatQuestionRequest>();

  const updateSnapshot = (lastError = snapshot.lastError) => {
    const runningThreadIds = [...requestKeyByThreadId.keys()];
    snapshot = {
      isSending: runningThreadIds.length > 0,
      lastError,
      activeThreadId: runningThreadIds[0] ?? null,
      runningThreadIds,
      pendingPermissions: [...pendingPermissionById.values()],
      pendingQuestions: [...pendingQuestionById.values()],
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

  const clearPermissionsForRun = (
    run: PendingChatRun,
    runId: string,
    notifyInterrupted: boolean,
  ) => {
    const removed: ChatPermissionRequest[] = [];
    pendingPermissionById.forEach((permission, id) => {
      if (permission.runId === runId) {
        pendingPermissionById.delete(id);
        removed.push(permission);
      }
    });
    if (notifyInterrupted && removed.length > 0) {
      run.callbacks.onPermissionsInterrupted?.(removed);
    }
  };

  const clearQuestionsForRun = (run: PendingChatRun, runId: string, notifyInterrupted: boolean) => {
    const removed: ChatQuestionRequest[] = [];
    pendingQuestionById.forEach((question, id) => {
      if (question.runId === runId) {
        pendingQuestionById.delete(id);
        removed.push(question);
      }
    });
    if (notifyInterrupted && removed.length > 0) {
      run.callbacks.onQuestionsInterrupted?.(removed);
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

      // permission-failed for an active run is a terminal error: show to user and end run
      // permission-failed when run is not found still shows error to user
      if (event.type === "permission-failed") {
        if (run) {
          clearPermissionsForRun(run, event.runId, true);
          clearQuestionsForRun(run, event.runId, true);
          run.callbacks.onError?.(event.error, event.runId);
          finishPendingRun(run);
        }
        // Show error to user even if run is not found (may have already ended)
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

      if (event.type === "started") {
        if (event.threadId === run.threadId) {
          run.callbacks.onStarted?.(event.runId);
        }
        return;
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

      if (event.type === "subagent-task") {
        run.callbacks.onSubagentTask?.(event.task);
        return;
      }

      if (event.type === "checklist") {
        if (event.threadId === run.threadId) {
          run.callbacks.onChecklist?.(event.checklist, {
            runId: event.runId,
            threadId: event.threadId,
            runtimeId: event.runtimeId,
          });
        }
        return;
      }

      if (event.type === "plan-mode-changed") {
        run.callbacks.onPlanModeChanged?.(event.enabled);
        return;
      }

      if (event.type === "completed") {
        clearPermissionsForRun(run, event.runId, true);
        clearQuestionsForRun(run, event.runId, true);
        run.callbacks.onComplete?.(event.text, event.runId);
        finishPendingRun(run);
        return;
      }

      if (event.type === "failed") {
        clearPermissionsForRun(run, event.runId, true);
        clearQuestionsForRun(run, event.runId, true);
        run.callbacks.onError?.(event.error, event.runId);
        clearPending(run);
        updateSnapshot(event.error);
        emit();
        return;
      }

      if (event.type === "stopped") {
        clearPermissionsForRun(run, event.runId, true);
        clearQuestionsForRun(run, event.runId, true);
        run.callbacks.onStop?.(event.runId);
        finishPendingRun(run);
        return;
      }

      if (event.type === "permission-requested") {
        pendingPermissionById.set(event.permission.id, event.permission);
        run.callbacks.onPermissionRequested?.(event.permission);
        updateSnapshot();
        emit();
        return;
      }

      if (event.type === "permission-resolved") {
        run.callbacks.onPermissionResolved?.({
          permissionId: event.permissionId,
          optionId: event.optionId,
          optionName: event.optionName,
          optionKind: event.optionKind,
        });
        pendingPermissionById.delete(event.permissionId);
        updateSnapshot();
        emit();
        return;
      }

      if (event.type === "question-requested") {
        pendingQuestionById.set(event.question.id, event.question);
        run.callbacks.onQuestionRequested?.(event.question);
        updateSnapshot();
        emit();
        return;
      }

      if (event.type === "question-resolved") {
        const question = pendingQuestionById.get(event.questionId);
        if (question) {
          // The full request travels with the resolution so history records
          // never depend on the event's single-question option fields.
          run.callbacks.onQuestionResolved?.({ question, outcome: event.outcome });
        }
        pendingQuestionById.delete(event.questionId);
        updateSnapshot();
        emit();
        return;
      }

      if (event.type === "question-failed") {
        // Only surface failures for a question this coordinator is tracking;
        // stale or wrong-run failures must not pollute unrelated threads.
        updateSnapshot(pendingQuestionById.has(event.questionId) ? event.error : undefined);
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
      return false;
    }

    try {
      const { runId } = await window.carrent.chat.send({
        ...request,
        requestKey,
      });
      chatRunCoordinator.attachRunId(requestKey, runId);
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      chatRunCoordinator.failRequest(requestKey, message);
      return false;
    }
  }, []);

  const stop = useCallback(async (threadId?: string) => {
    const runId = chatRunCoordinator.getPendingRunId(threadId);
    if (runId) {
      await window.carrent.chat.stop(runId);
    }
  }, []);

  const respondToPermission = useCallback(async (response: ChatPermissionResponse) => {
    await window.carrent.chat.respondToPermission(response);
  }, []);

  const respondToQuestion = useCallback(async (response: ChatQuestionResponse) => {
    await window.carrent.chat.respondToQuestion(response);
  }, []);

  return {
    isSending: snapshot.isSending,
    lastError: snapshot.lastError,
    activeThreadId: snapshot.activeThreadId,
    runningThreadIds: snapshot.runningThreadIds,
    pendingPermissions: snapshot.pendingPermissions,
    pendingQuestions: snapshot.pendingQuestions,
    send,
    stop,
    respondToPermission,
    respondToQuestion,
  };
}
