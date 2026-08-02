import { useCallback, useEffect, useState } from "react";

import type {
  ChatReasoningEventPayload,
  ChatRunAuthorityChange,
  ChatRunAuthorityState,
  ChatRunEvent,
  ChatShellEventPayload,
  ChatSubagentTaskPayload,
  KimiTimelineItem,
  ChatTurnRequest,
  RuntimeSessionRecovery,
} from "../../shared/chat";
import {
  applyKimiTimelineItemUpdate,
  compactChatRunEvents,
  isTerminalSharedChatRunStatus,
} from "../../shared/chat";
import type { RunChecklistSnapshot } from "../../shared/runChecklist";
import type { ChatPermissionRequest, ChatPermissionResponse } from "../../shared/chatPermissions";
import type { ChatQuestionRequest, ChatQuestionResponse } from "../../shared/chatQuestions";

export type ChatRunCallbacks = {
  onNotice?: (message: string) => void;
  onStarted?: (runId: string) => void;
  onDelta?: (text: string) => void;
  onTextSnapshot?: (text: string) => void;
  onReasoning?: (reasoning: ChatReasoningEventPayload) => void;
  onKimiTimeline?: (item: KimiTimelineItem) => void;
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
    answers?: import("../../shared/chatQuestions").ChatQuestionAnswer[];
  }) => void;
  onQuestionsInterrupted?: (questions: ChatQuestionRequest[]) => void;
  onPlanModeChanged?: (enabled: boolean) => void;
  onComplete?: (text: string, runId: string, writtenFiles?: string[]) => void;
  onError?: (
    error: string,
    runId?: string,
    writtenFiles?: string[],
    runtimeSessionRecovery?: RuntimeSessionRecovery,
  ) => void;
  onStop?: (runId: string, writtenFiles?: string[]) => void;
  onEventApplied?: (count: number) => void;
};

type ChatRunSnapshot = {
  isSending: boolean;
  lastError: string | null;
  runningThreadIds: string[];
  pendingPermissions: ChatPermissionRequest[];
  pendingQuestions: ChatQuestionRequest[];
  runs: ChatRunAuthorityState["runs"];
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
    runningThreadIds: [],
    pendingPermissions: [],
    pendingQuestions: [],
    runs: [],
  };
  const pendingByRequestKey = new Map<string, PendingChatRun>();
  const requestKeyByRunId = new Map<string, string>();
  const requestKeyByThreadId = new Map<string, string>();
  const listeners = new Set<ChatRunStoreListener>();
  const pendingPermissionById = new Map<string, ChatPermissionRequest>();
  const pendingQuestionById = new Map<string, ChatQuestionRequest>();
  const observersByThreadId = new Map<string, PendingChatRun>();
  const deliveredEventCountByRunId = new Map<string, number>();
  const kimiTimelineItemsByRunId = new Map<string, Map<string, KimiTimelineItem>>();
  let authorityState: ChatRunAuthorityState | null = null;
  let batchingChanges = 0;
  let pendingEmit = false;

  const materializeKimiTimelineEvent = (event: ChatRunEvent) => {
    if (event.type !== "kimi-timeline" && event.type !== "kimi-timeline-update") return null;
    let items = kimiTimelineItemsByRunId.get(event.runId);
    if (!items) {
      items = new Map();
      kimiTimelineItemsByRunId.set(event.runId, items);
    }
    if (event.type === "kimi-timeline") {
      items.set(event.item.id, event.item);
      return event.item;
    }
    const current = items.get(event.update.id);
    if (!current) return null;
    const next = applyKimiTimelineItemUpdate(current, event.update);
    if (!next) return null;
    items.set(next.id, next);
    return next;
  };

  const restoreLegacyEventState = (events: ChatRunEvent[]) => {
    events.forEach((event) => {
      if (event.type === "permission-requested") {
        pendingPermissionById.set(event.permission.id, event.permission);
      } else if (event.type === "permission-resolved") {
        pendingPermissionById.delete(event.permissionId);
      } else if (event.type === "question-requested") {
        pendingQuestionById.set(event.question.id, event.question);
      } else if (event.type === "question-resolved") {
        pendingQuestionById.delete(event.questionId);
      }
      materializeKimiTimelineEvent(event);
    });
  };

  const updateSnapshot = (lastError = snapshot.lastError) => {
    if (authorityState) {
      const liveRuns = authorityState.runs.filter(
        (run) => !isTerminalSharedChatRunStatus(run.status),
      );
      snapshot = {
        isSending: liveRuns.length > 0,
        lastError,
        runningThreadIds: liveRuns.map((run) => run.threadId),
        pendingPermissions: liveRuns.flatMap((run) => run.pendingPermissions),
        pendingQuestions: liveRuns.flatMap((run) => run.pendingQuestions),
        runs: authorityState.runs,
      };
      return;
    }
    const runningThreadIds = [...requestKeyByThreadId.keys()];
    snapshot = {
      isSending: runningThreadIds.length > 0,
      lastError,
      runningThreadIds,
      pendingPermissions: [...pendingPermissionById.values()],
      pendingQuestions: [...pendingQuestionById.values()],
      runs: [],
    };
  };

  const emit = () => {
    if (batchingChanges > 0) {
      pendingEmit = true;
      return;
    }
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
    const pending = requestKey ? (pendingByRequestKey.get(requestKey) ?? null) : null;
    if (pending) return pending;
    const sharedRun = authorityState?.runs.find((run) => run.runId === event.runId);
    return sharedRun ? (observersByThreadId.get(sharedRun.threadId) ?? null) : null;
  };

  const eventCountOf = (run: ChatRunAuthorityState["runs"][number]) =>
    run.eventCount ?? run.events.length;

  const getRunTarget = (run: ChatRunAuthorityState["runs"][number]) => {
    const target =
      (run.requestKey ? pendingByRequestKey.get(run.requestKey) : undefined) ??
      observersByThreadId.get(run.threadId);
    if (!target) return null;
    if (!target.runId) {
      target.runId = run.runId;
      if (pendingByRequestKey.has(target.requestKey)) {
        requestKeyByRunId.set(run.runId, target.requestKey);
      }
    }
    return target;
  };

  const deliverRunSnapshot = (run: ChatRunAuthorityState["runs"][number]) => {
    const target = getRunTarget(run);
    if (!target) return;
    if (run.eventCount === undefined) {
      const delivered = deliveredEventCountByRunId.get(run.runId) ?? 0;
      for (let index = delivered; index < run.events.length; index += 1) {
        api.handleEvent(run.events[index]!);
        target.callbacks.onEventApplied?.(index + 1);
        deliveredEventCountByRunId.set(run.runId, index + 1);
      }
      return;
    }
    const eventCount = eventCountOf(run);
    if ((deliveredEventCountByRunId.get(run.runId) ?? 0) >= eventCount) return;
    kimiTimelineItemsByRunId.delete(run.runId);
    const kimiMessages = run.events
      .filter(
        (event): event is Extract<ChatRunEvent, { type: "kimi-timeline" }> =>
          event.type === "kimi-timeline" && event.item.type === "message",
      )
      .sort((left, right) => left.item.order - right.item.order);
    if (kimiMessages.length > 0) {
      target.callbacks.onTextSnapshot?.(
        kimiMessages
          .map((event) => (event.item.type === "message" ? event.item.content : ""))
          .join(""),
      );
    }
    run.events.forEach((event) => api.handleEvent(event, true));
    target.callbacks.onEventApplied?.(eventCount);
    deliveredEventCountByRunId.set(run.runId, eventCount);
  };

  const api = {
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
      if (authorityState) {
        const run = authorityState.runs.find(
          (item) =>
            (!threadId || item.threadId === threadId) &&
            !isTerminalSharedChatRunStatus(item.status),
        );
        return run?.runId ?? null;
      }
      if (threadId) {
        const requestKey = requestKeyByThreadId.get(threadId);
        return requestKey ? (pendingByRequestKey.get(requestKey)?.runId ?? null) : null;
      }

      return [...pendingByRequestKey.values()].find((run) => run.runId)?.runId ?? null;
    },
    beginRequest(requestKey: string, threadId: string, callbacks: ChatRunCallbacks) {
      if (
        requestKeyByThreadId.has(threadId) ||
        authorityState?.runs.some(
          (run) => run.threadId === threadId && !isTerminalSharedChatRunStatus(run.status),
        )
      ) {
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
    observeThread(threadId: string, callbacks: ChatRunCallbacks, appliedEventCount = 0) {
      const observer: PendingChatRun = {
        requestKey: `observer-${threadId}`,
        runId: null,
        threadId,
        callbacks,
      };
      observersByThreadId.set(threadId, observer);
      const run = authorityState?.runs.find((item) => item.threadId === threadId);
      if (run) {
        observer.runId = run.runId;
        if (run.eventCount === undefined) {
          restoreLegacyEventState(run.events.slice(0, appliedEventCount));
        }
        deliveredEventCountByRunId.set(
          run.runId,
          Math.max(deliveredEventCountByRunId.get(run.runId) ?? 0, appliedEventCount),
        );
        deliverRunSnapshot(run);
      }
      return () => {
        if (observersByThreadId.get(threadId) === observer) {
          observersByThreadId.delete(threadId);
        }
      };
    },
    applyAuthorityState(state: ChatRunAuthorityState) {
      if (authorityState && state.revision < authorityState.revision) return;
      authorityState = state;
      const runIds = new Set(state.runs.map((run) => run.runId));
      deliveredEventCountByRunId.forEach((_count, runId) => {
        if (!runIds.has(runId)) deliveredEventCountByRunId.delete(runId);
      });
      kimiTimelineItemsByRunId.forEach((_items, runId) => {
        if (!runIds.has(runId)) kimiTimelineItemsByRunId.delete(runId);
      });
      state.runs.forEach(deliverRunSnapshot);
      updateSnapshot();
      emit();
    },
    applyAuthorityUpdate(update: ChatRunAuthorityChange) {
      if ("updates" in update) {
        batchingChanges += 1;
        let accepted = true;
        for (const change of update.updates) {
          if (!this.applyAuthorityUpdate(change)) {
            accepted = false;
            break;
          }
        }
        batchingChanges -= 1;
        if (accepted) {
          updateSnapshot();
          pendingEmit = false;
          emit();
        } else if (batchingChanges === 0 && pendingEmit) {
          pendingEmit = false;
          emit();
        }
        return accepted;
      }
      if (authorityState && update.revision <= authorityState.revision) return true;
      if (!authorityState || update.baseRevision !== authorityState.revision) return false;

      if ("removedRunId" in update) {
        deliveredEventCountByRunId.delete(update.removedRunId);
        kimiTimelineItemsByRunId.delete(update.removedRunId);
        authorityState = {
          revision: update.revision,
          runs: authorityState.runs.filter((run) => run.runId !== update.removedRunId),
        };
        updateSnapshot();
        emit();
        return true;
      }

      if (update.replacedRunId) {
        deliveredEventCountByRunId.delete(update.replacedRunId);
        kimiTimelineItemsByRunId.delete(update.replacedRunId);
      }
      const replacedIndex = update.replacedRunId
        ? authorityState.runs.findIndex((run) => run.runId === update.replacedRunId)
        : -1;
      const runs = authorityState.runs.filter((run) => run.runId !== update.replacedRunId);
      const existingIndex = runs.findIndex((run) => run.runId === update.run.runId);
      const existing = existingIndex >= 0 ? runs[existingIndex] : undefined;
      const nextRun = {
        ...update.run,
        events:
          update.events ??
          (update.event
            ? compactChatRunEvents(existing?.events ?? [], update.event)
            : (existing?.events ?? [])),
      };
      if (existingIndex >= 0) {
        runs[existingIndex] = nextRun;
      } else if (replacedIndex >= 0) {
        runs.splice(Math.min(replacedIndex, runs.length), 0, nextRun);
      } else {
        runs.push(nextRun);
      }
      authorityState = { revision: update.revision, runs };
      const target = getRunTarget(nextRun);
      const eventCount = eventCountOf(nextRun);
      if (
        target &&
        update.event &&
        (deliveredEventCountByRunId.get(nextRun.runId) ?? 0) < eventCount
      ) {
        api.handleEvent(update.event, false);
        target.callbacks.onEventApplied?.(eventCount);
        deliveredEventCountByRunId.set(nextRun.runId, eventCount);
      }
      updateSnapshot();
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
    rejectRequest(requestKey: string) {
      const run = pendingByRequestKey.get(requestKey);
      if (!run) return;
      clearPending(run);
      updateSnapshot();
      emit();
    },
    handleEvent(event: ChatRunEvent, fromSnapshot = false) {
      const run = getRunForEvent(event);
      if (run?.runId && run.runId !== event.runId) {
        return;
      }

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

      if (event.type === "notice") {
        run.callbacks.onNotice?.(event.message);
        return;
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

      if (event.type === "text-snapshot") {
        run.callbacks.onTextSnapshot?.(event.text);
        return;
      }

      if (event.type === "reasoning") {
        run.callbacks.onReasoning?.(event.reasoning);
        return;
      }

      if (event.type === "kimi-timeline" || event.type === "kimi-timeline-update") {
        const item = materializeKimiTimelineEvent(event);
        if (item) {
          run.callbacks.onKimiTimeline?.(item);
          if (!fromSnapshot && item.type === "message") {
            if (event.type === "kimi-timeline") {
              run.callbacks.onDelta?.(item.content);
            } else if (
              event.update.itemType === "message" &&
              event.update.content?.kind === "append"
            ) {
              run.callbacks.onDelta?.(event.update.content.value);
            }
          }
        }
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
        run.callbacks.onComplete?.(event.text, event.runId, event.writtenFiles);
        finishPendingRun(run);
        return;
      }

      if (event.type === "failed") {
        clearPermissionsForRun(run, event.runId, true);
        clearQuestionsForRun(run, event.runId, true);
        run.callbacks.onError?.(
          event.error,
          event.runId,
          event.writtenFiles,
          event.runtimeSessionRecovery,
        );
        clearPending(run);
        updateSnapshot(event.error);
        emit();
        return;
      }

      if (event.type === "stopped") {
        clearPermissionsForRun(run, event.runId, true);
        clearQuestionsForRun(run, event.runId, true);
        run.callbacks.onStop?.(event.runId, event.writtenFiles);
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
          run.callbacks.onQuestionResolved?.({
            question,
            outcome: event.outcome,
            ...(event.answers ? { answers: event.answers } : {}),
          });
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

  return api;
}

const chatRunCoordinator = createChatRunCoordinator();
let teardownChatListener: VoidFunction | null = null;
let chatListenerSubscriberCount = 0;
let chatAuthoritySync: Promise<void> | null = null;
let chatAuthorityResyncRequested = false;

export function hasLiveRunForThread(threadId: string) {
  return chatRunCoordinator.getSnapshot().runningThreadIds.includes(threadId);
}

function createRequestKey() {
  return `request-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function ensureChatListener() {
  if (teardownChatListener) {
    return;
  }

  const chat = window.carrent.chat;
  if (typeof chat.onChanged === "function" && typeof chat.subscribe === "function") {
    const syncAuthorityState = () => {
      if (chatAuthoritySync) {
        chatAuthorityResyncRequested = true;
        return;
      }
      chatAuthoritySync = chat
        .subscribe()
        .then((state) => chatRunCoordinator.applyAuthorityState(state))
        .finally(() => {
          chatAuthoritySync = null;
          if (chatAuthorityResyncRequested) {
            chatAuthorityResyncRequested = false;
            syncAuthorityState();
          }
        });
    };
    const disposeChanged = chat.onChanged((update) => {
      if (!chatRunCoordinator.applyAuthorityUpdate(update)) syncAuthorityState();
    });
    teardownChatListener = () => {
      disposeChanged();
      void chat.unsubscribe();
    };
    syncAuthorityState();
    return;
  }

  teardownChatListener = chat.onEvent((event: ChatRunEvent) => {
    chatRunCoordinator.handleEvent(event);
  });
}

function subscribeToChatRun(listener: ChatRunStoreListener) {
  ensureChatListener();
  chatListenerSubscriberCount += 1;
  const unsubscribe = chatRunCoordinator.subscribe(listener);

  return () => {
    unsubscribe();
    chatListenerSubscriberCount -= 1;
    if (chatListenerSubscriberCount === 0) {
      teardownChatListener?.();
      teardownChatListener = null;
    }
  };
}

export function useChatRun() {
  const [snapshot, setSnapshot] = useState(() => chatRunCoordinator.getSnapshot());

  useEffect(() => {
    return subscribeToChatRun(() => {
      setSnapshot(chatRunCoordinator.getSnapshot());
    });
  }, []);

  const send = useCallback(async (request: ChatTurnRequest, callbacks: ChatRunCallbacks) => {
    ensureChatListener();
    const requestKey = createRequestKey();
    if (!chatRunCoordinator.beginRequest(requestKey, request.threadId, callbacks)) {
      return null;
    }

    try {
      const result = await window.carrent.chat.send({
        ...request,
        requestKey,
      });
      const { runId } = result;
      if (result.accepted === false || !runId) {
        chatRunCoordinator.rejectRequest(requestKey);
        return null;
      }
      chatRunCoordinator.attachRunId(requestKey, runId);
      return runId;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      chatRunCoordinator.failRequest(requestKey, message);
      return null;
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

  const observeThread = useCallback(
    (threadId: string, callbacks: ChatRunCallbacks, appliedEventCount = 0) => {
      ensureChatListener();
      return chatRunCoordinator.observeThread(threadId, callbacks, appliedEventCount);
    },
    [],
  );

  return {
    isSending: snapshot.isSending,
    lastError: snapshot.lastError,
    runningThreadIds: snapshot.runningThreadIds,
    pendingPermissions: snapshot.pendingPermissions,
    pendingQuestions: snapshot.pendingQuestions,
    runs: snapshot.runs,
    send,
    stop,
    respondToPermission,
    respondToQuestion,
    observeThread,
  };
}
