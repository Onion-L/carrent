import { serialize } from "node:v8";

import type {
  ChatRunAuthorityChange,
  ChatRunAuthorityRemoval,
  ChatRunAuthorityState,
  ChatRunAuthorityUpdate,
  ChatRunCommandResult,
  ChatRunEvent,
  ChatTurnRequest,
  KimiTimelineItem,
  SharedChatRun,
  SharedChatRunStatus,
} from "../../src/shared/chat";
import {
  compactChatRunEvents,
  createKimiTimelineItemUpdate,
  isTerminalSharedChatRunStatus,
} from "../../src/shared/chat";
import type { ChatPermissionResponse } from "../../src/shared/chatPermissions";
import {
  CHAT_QUESTION_OTHER_OPTION_ID,
  type ChatQuestionRequest,
  type ChatQuestionResponse,
} from "../../src/shared/chatQuestions";

type ChatRunAuthorityOptions = {
  start: (runId: string, request: ChatTurnRequest) => void;
  stop: (runId: string) => void;
  respondToPermission: (response: ChatPermissionResponse) => void;
  respondToQuestion: (response: ChatQuestionResponse) => void;
  publish: (subscriberId: number, change: ChatRunAuthorityChange) => void;
  maxPayloadBytes?: number;
  batchIntervalMs?: number;
  // Invoked once per authoritative state change, before per-renderer fan-out.
  // Used by Main Process observers (e.g. run notifications) that must fire even
  // with zero subscribers. Optional; no callback means no main-process hook.
  onChange?: (state: ChatRunAuthorityState) => void;
};

const DEFAULT_MAX_CHAT_RUN_PAYLOAD_BYTES = 8 * 1024 * 1024;
const DEFAULT_CHAT_RUN_BATCH_INTERVAL_MS = 16;
const PAYLOAD_LIMIT_ERROR = "Run output exceeded the safe IPC replay limit.";

function statusAfterInteraction(run: SharedChatRun): SharedChatRunStatus {
  if (run.pendingPermissions.length > 0) return "waiting-for-approval";
  if (run.pendingQuestions.length > 0) return "waiting-for-answer";
  return run.events.some((event) => event.type === "started") ? "running" : "starting";
}

function questionKey(runId: string, questionId: string) {
  return `${runId}\0${questionId}`;
}

function isValidQuestionResponse(
  question: ChatQuestionRequest,
  response: ChatQuestionResponse,
): boolean {
  if (response.action === "skip") return true;
  if (response.answers.length !== question.questions.length) return false;
  const answersByIndex = new Map(response.answers.map((answer) => [answer.questionIndex, answer]));
  if (answersByIndex.size !== response.answers.length) return false;

  return question.questions.every((item, index) => {
    const answer = answersByIndex.get(index);
    if (!answer || answer.optionIds.length === 0) return false;
    if (!item.multiSelect && answer.optionIds.length !== 1) return false;
    const allowedOptionIds = new Set(item.options.map((option) => option.optionId));
    if (question.source === "mcp") allowedOptionIds.add(CHAT_QUESTION_OTHER_OPTION_ID);
    if (answer.optionIds.some((optionId) => !allowedOptionIds.has(optionId))) return false;
    const hasOther = answer.optionIds.includes(CHAT_QUESTION_OTHER_OPTION_ID);
    return (
      hasOther === (typeof answer.customText === "string" && answer.customText.trim().length > 0)
    );
  });
}

export function createChatRunAuthority(options: ChatRunAuthorityOptions) {
  let revision = 0;
  const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_MAX_CHAT_RUN_PAYLOAD_BYTES;
  const batchIntervalMs = options.batchIntervalMs ?? DEFAULT_CHAT_RUN_BATCH_INTERVAL_MS;
  const subscribers = new Set<number>();
  const runsByThreadId = new Map<string, SharedChatRun>();
  const threadIdByRunId = new Map<string, string>();
  const timelineItemsByRunId = new Map<string, Map<string, KimiTimelineItem>>();
  const pendingMessageDeltaByRunId = new Map<string, string>();
  let queuedUpdates: ChatRunAuthorityUpdate[] = [];
  let batchTimer: ReturnType<typeof setTimeout> | null = null;
  const acceptedQuestionResponses = new Map<
    string,
    { question: ChatQuestionRequest; response: ChatQuestionResponse }
  >();

  function currentState(): ChatRunAuthorityState {
    return {
      revision,
      runs: [...runsByThreadId.values()].map((run) => ({
        ...run,
        events: [...run.events],
        pendingPermissions: [...run.pendingPermissions],
        pendingQuestions: [...run.pendingQuestions],
      })),
    };
  }

  function runMetadata(run: SharedChatRun): Omit<SharedChatRun, "events"> {
    const { events: _events, ...metadata } = run;
    return {
      ...metadata,
      pendingPermissions: [...metadata.pendingPermissions],
      pendingQuestions: [...metadata.pendingQuestions],
    };
  }

  function isBatchableEvent(event?: ChatRunEvent) {
    return (
      event?.type === "delta" ||
      event?.type === "text-snapshot" ||
      event?.type === "reasoning" ||
      event?.type === "kimi-timeline" ||
      event?.type === "kimi-timeline-update" ||
      event?.type === "shell" ||
      event?.type === "subagent-task"
    );
  }

  function publishQueuedUpdates() {
    if (batchTimer) {
      clearTimeout(batchTimer);
      batchTimer = null;
    }
    const updates = queuedUpdates;
    queuedUpdates = [];
    if (updates.length === 0) return;
    const change: ChatRunAuthorityChange =
      updates.length === 1
        ? updates[0]!
        : {
            baseRevision: updates[0]!.baseRevision,
            revision: updates.at(-1)!.revision,
            updates,
          };
    subscribers.forEach((subscriberId) => options.publish(subscriberId, change));
  }

  function dispatch(update: ChatRunAuthorityUpdate | ChatRunAuthorityRemoval) {
    revision = update.revision;
    if (options.onChange) {
      try {
        options.onChange(currentState());
      } catch {
        // Observed-state side effects are best-effort; swallow observer errors.
      }
    }
    if ("run" in update && batchIntervalMs > 0 && isBatchableEvent(update.event)) {
      queuedUpdates.push(update);
      batchTimer ??= setTimeout(publishQueuedUpdates, batchIntervalMs);
      return;
    }
    publishQueuedUpdates();
    subscribers.forEach((subscriberId) => options.publish(subscriberId, update));
  }

  function failForPayloadLimit(run: SharedChatRun, replacedRunId?: string) {
    const failedEvent: ChatRunEvent = {
      type: "failed",
      runId: run.runId,
      ...(run.requestKey ? { requestKey: run.requestKey } : {}),
      error: PAYLOAD_LIMIT_ERROR,
    };
    const failedRun: SharedChatRun = {
      ...run,
      status: "failed",
      stopRequested: true,
      eventCount: (run.eventCount ?? run.events.length) + 1,
      events: [failedEvent],
      pendingPermissions: [],
      pendingQuestions: [],
    };
    replaceRun(failedRun);
    timelineItemsByRunId.delete(run.runId);
    pendingMessageDeltaByRunId.delete(run.runId);
    if (!isTerminalSharedChatRunStatus(run.status)) options.stop(run.runId);
    dispatch({
      baseRevision: revision,
      revision: revision + 1,
      run: runMetadata(failedRun),
      event: failedEvent,
      ...(replacedRunId && replacedRunId !== run.runId ? { replacedRunId } : {}),
    });
  }

  function publish(run: SharedChatRun, event?: ChatRunEvent, replacedRunId?: string) {
    const baseRevision = revision;
    const update: ChatRunAuthorityUpdate = {
      baseRevision,
      revision: baseRevision + 1,
      run: runMetadata(run),
      ...(event ? { event } : {}),
      ...(replacedRunId && replacedRunId !== run.runId ? { replacedRunId } : {}),
    };
    if (serialize(update).byteLength > maxPayloadBytes) {
      failForPayloadLimit(run, replacedRunId);
      return false;
    }
    dispatch(update);
    return true;
  }

  function compactReplayState(runs: SharedChatRun[]): ChatRunAuthorityState {
    const state = { revision, runs };
    if (serialize(state).byteLength <= maxPayloadBytes) return state;

    const boundedRuns = [...runs];
    const replayCandidates = boundedRuns
      .map((run, index) => ({
        index,
        terminal: isTerminalSharedChatRunStatus(run.status),
        bytes: serialize(run.events).byteLength,
      }))
      .filter(({ terminal, bytes }) => terminal && bytes > 0)
      .sort((left, right) => right.bytes - left.bytes);

    for (const { index } of replayCandidates) {
      boundedRuns[index] = { ...boundedRuns[index]!, events: [] };
      const bounded = { revision, runs: boundedRuns };
      if (serialize(bounded).byteLength <= maxPayloadBytes) return bounded;
    }

    return { revision, runs: boundedRuns };
  }

  function canReplayState(next: SharedChatRun) {
    const runs = [...runsByThreadId.values()].map((run) =>
      run.threadId === next.threadId ? next : run,
    );
    return serialize(compactReplayState(runs)).byteLength <= maxPayloadBytes;
  }

  function snapshotState() {
    return compactReplayState(currentState().runs);
  }

  function result(accepted: boolean, runId?: string): ChatRunCommandResult {
    return { accepted, ...(runId ? { runId } : {}) };
  }

  function replaceRun(run: SharedChatRun) {
    const previous = runsByThreadId.get(run.threadId);
    if (previous && previous.runId !== run.runId) {
      threadIdByRunId.delete(previous.runId);
      timelineItemsByRunId.delete(previous.runId);
      pendingMessageDeltaByRunId.delete(previous.runId);
    }
    runsByThreadId.set(run.threadId, run);
    threadIdByRunId.set(run.runId, run.threadId);
    return previous;
  }

  function compactTimelineEvent(event: ChatRunEvent): ChatRunEvent {
    if (event.type !== "kimi-timeline") return event;
    let items = timelineItemsByRunId.get(event.runId);
    if (!items) {
      items = new Map();
      timelineItemsByRunId.set(event.runId, items);
    }
    const previous = items.get(event.item.id);
    items.set(event.item.id, event.item);
    if (event.item.type === "message") {
      const appended =
        !previous || previous.type !== "message"
          ? event.item.content
          : event.item.content.startsWith(previous.content)
            ? event.item.content.slice(previous.content.length)
            : "";
      if (appended) pendingMessageDeltaByRunId.set(event.runId, appended);
      else pendingMessageDeltaByRunId.delete(event.runId);
    }
    if (!previous) return event;
    const update = createKimiTimelineItemUpdate(previous, event.item);
    if (!update) return event;
    return {
      type: "kimi-timeline-update",
      runId: event.runId,
      ...(event.requestKey ? { requestKey: event.requestKey } : {}),
      update,
    };
  }

  function getRun(runId: string) {
    const threadId = threadIdByRunId.get(runId);
    if (!threadId) return null;
    const run = runsByThreadId.get(threadId);
    return run?.runId === runId ? run : null;
  }

  return {
    getState: currentState,

    subscribe(subscriberId: number) {
      subscribers.add(subscriberId);
      return snapshotState();
    },

    unsubscribe(subscriberId: number) {
      subscribers.delete(subscriberId);
    },

    acknowledgePersistedEvents(runId: string, eventCount: number) {
      const run = getRun(runId);
      const logicalEventCount = run?.eventCount ?? run?.events.length ?? 0;
      if (!run || !isTerminalSharedChatRunStatus(run.status) || eventCount < logicalEventCount) {
        return false;
      }
      runsByThreadId.delete(run.threadId);
      threadIdByRunId.delete(run.runId);
      timelineItemsByRunId.delete(run.runId);
      pendingMessageDeltaByRunId.delete(run.runId);
      const update: ChatRunAuthorityRemoval = {
        baseRevision: revision,
        revision: revision + 1,
        removedRunId: run.runId,
      };
      dispatch(update);
      return true;
    },

    send(request: ChatTurnRequest): ChatRunCommandResult {
      const existing = runsByThreadId.get(request.threadId);
      if (existing && !isTerminalSharedChatRunStatus(existing.status)) {
        return result(false, existing.runId);
      }

      const runId = request.runId!;
      if (threadIdByRunId.has(runId)) return result(false, runId);
      const run: SharedChatRun = {
        runId,
        threadId: request.threadId,
        ...(request.requestKey ? { requestKey: request.requestKey } : {}),
        status: "starting",
        stopRequested: false,
        eventCount: 0,
        events: [],
        pendingPermissions: [],
        pendingQuestions: [],
      };
      const previous = replaceRun(run);
      if (!publish(run, undefined, previous?.runId)) return result(false, runId);
      try {
        options.start(runId, request);
      } catch (error) {
        this.handleEvent({
          type: "failed",
          runId,
          requestKey: request.requestKey,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return result(true, runId);
    },

    stop(runId: string): ChatRunCommandResult {
      const run = getRun(runId);
      if (!run || isTerminalSharedChatRunStatus(run.status) || run.stopRequested) {
        return result(false, run?.runId);
      }
      replaceRun({ ...run, stopRequested: true });
      if (!publish({ ...run, stopRequested: true })) return result(false, runId);
      options.stop(runId);
      return result(true, runId);
    },

    respondToPermission(response: ChatPermissionResponse): ChatRunCommandResult {
      const run = getRun(response.runId);
      const permission = run?.pendingPermissions.find(
        (item) => item.id === response.permissionId && item.runId === response.runId,
      );
      if (
        !run ||
        !permission ||
        !permission.options.some((item) => item.optionId === response.optionId)
      ) {
        return result(false, run?.runId);
      }
      const next = {
        ...run,
        pendingPermissions: run.pendingPermissions.filter((item) => item.id !== permission.id),
      };
      const changed = { ...next, status: statusAfterInteraction(next) };
      replaceRun(changed);
      if (!publish(changed)) return result(false, run.runId);
      options.respondToPermission(response);
      return result(true, run.runId);
    },

    respondToQuestion(response: ChatQuestionResponse): ChatRunCommandResult {
      const run = getRun(response.runId);
      const question = run?.pendingQuestions.find(
        (item) => item.id === response.questionId && item.runId === response.runId,
      );
      if (!run || !question || !isValidQuestionResponse(question, response)) {
        return result(false, run?.runId);
      }
      const next = {
        ...run,
        pendingQuestions: run.pendingQuestions.filter((item) => item.id !== question.id),
      };
      acceptedQuestionResponses.set(questionKey(response.runId, question.id), {
        question,
        response,
      });
      const changed = { ...next, status: statusAfterInteraction(next) };
      replaceRun(changed);
      if (!publish(changed)) return result(false, run.runId);
      options.respondToQuestion(response);
      return result(true, run.runId);
    },

    handleEvent(event: ChatRunEvent) {
      const run = getRun(event.runId);
      if (!run || isTerminalSharedChatRunStatus(run.status)) return;
      if (event.type === "delta") {
        const pending = pendingMessageDeltaByRunId.get(event.runId);
        pendingMessageDeltaByRunId.delete(event.runId);
        if (pending === event.text) return;
      }

      let authoritativeEvent = event;
      if (event.type === "question-resolved") {
        const accepted = acceptedQuestionResponses.get(questionKey(event.runId, event.questionId));
        if (accepted?.response.action === "submit") {
          authoritativeEvent = {
            ...event,
            answers: accepted.response.answers.map((answer) => ({
              ...answer,
              optionIds: [...answer.optionIds],
            })),
          };
        }
        acceptedQuestionResponses.delete(questionKey(event.runId, event.questionId));
      }

      const compactEvent = compactTimelineEvent(authoritativeEvent);
      let next: SharedChatRun = {
        ...run,
        eventCount: (run.eventCount ?? run.events.length) + 1,
        events: compactChatRunEvents(run.events, authoritativeEvent),
      };
      if (event.type === "started") {
        next.status = statusAfterInteraction(next);
      } else if (event.type === "permission-requested") {
        next.pendingPermissions = [
          ...next.pendingPermissions.filter((item) => item.id !== event.permission.id),
          event.permission,
        ];
        next.status = "waiting-for-approval";
      } else if (event.type === "permission-resolved") {
        next.pendingPermissions = next.pendingPermissions.filter(
          (item) => item.id !== event.permissionId,
        );
        next.status = statusAfterInteraction(next);
      } else if (event.type === "question-requested") {
        next.pendingQuestions = [
          ...next.pendingQuestions.filter((item) => item.id !== event.question.id),
          event.question,
        ];
        next.status =
          next.pendingPermissions.length > 0 ? "waiting-for-approval" : "waiting-for-answer";
      } else if (event.type === "question-resolved") {
        next.pendingQuestions = next.pendingQuestions.filter(
          (item) => item.id !== event.questionId,
        );
        next.status = statusAfterInteraction(next);
      } else if (event.type === "question-failed") {
        const accepted = acceptedQuestionResponses.get(questionKey(event.runId, event.questionId));
        if (accepted) {
          next.pendingQuestions = [...next.pendingQuestions, accepted.question];
          next.status = statusAfterInteraction(next);
          acceptedQuestionResponses.delete(questionKey(event.runId, event.questionId));
        }
      } else if (event.type === "completed") {
        next.status = "completed";
        next.pendingPermissions = [];
        next.pendingQuestions = [];
      } else if (event.type === "failed" || event.type === "permission-failed") {
        next.status = "failed";
        next.pendingPermissions = [];
        next.pendingQuestions = [];
      } else if (event.type === "stopped") {
        next.status = "cancelled";
        next.pendingPermissions = [];
        next.pendingQuestions = [];
      }

      if (isTerminalSharedChatRunStatus(next.status)) {
        acceptedQuestionResponses.forEach(({ response }, questionId) => {
          if (response.runId === event.runId) acceptedQuestionResponses.delete(questionId);
        });
        timelineItemsByRunId.delete(event.runId);
        pendingMessageDeltaByRunId.delete(event.runId);
      }

      if (!canReplayState(next)) {
        failForPayloadLimit(run);
        return;
      }

      replaceRun(next);
      publish(next, compactEvent);
    },
  };
}

export type ChatRunAuthority = ReturnType<typeof createChatRunAuthority>;
