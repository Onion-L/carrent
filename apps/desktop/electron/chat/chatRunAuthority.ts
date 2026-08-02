import type {
  ChatRunAuthorityState,
  ChatRunCommandResult,
  ChatRunEvent,
  ChatTurnRequest,
  SharedChatRun,
  SharedChatRunStatus,
} from "../../src/shared/chat";
import { isTerminalSharedChatRunStatus } from "../../src/shared/chat";
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
  publish: (subscriberId: number, state: ChatRunAuthorityState) => void;
  // Invoked once per authoritative state change, before per-renderer fan-out.
  // Used by Main Process observers (e.g. run notifications) that must fire even
  // with zero subscribers. Optional; no callback means no main-process hook.
  onChange?: (state: ChatRunAuthorityState) => void;
};

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
  const subscribers = new Set<number>();
  const runsByThreadId = new Map<string, SharedChatRun>();
  const threadIdByRunId = new Map<string, string>();
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

  function publish() {
    revision += 1;
    const state = currentState();
    // A Main Process observer (run notifications) must never block renderer
    // fan-out: isolate its callback so a throw inside the observer cannot
    // prevent subscribers from receiving the authoritative state.
    try {
      options.onChange?.(state);
    } catch {
      // Observed-state side effects are best-effort; swallow observer errors.
    }
    subscribers.forEach((subscriberId) => options.publish(subscriberId, state));
    return state;
  }

  function result(accepted: boolean, runId?: string): ChatRunCommandResult {
    return { accepted, ...(runId ? { runId } : {}), state: currentState() };
  }

  function replaceRun(run: SharedChatRun) {
    runsByThreadId.set(run.threadId, run);
    threadIdByRunId.set(run.runId, run.threadId);
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
      return currentState();
    },

    unsubscribe(subscriberId: number) {
      subscribers.delete(subscriberId);
    },

    send(request: ChatTurnRequest): ChatRunCommandResult {
      const existing = runsByThreadId.get(request.threadId);
      if (existing && !isTerminalSharedChatRunStatus(existing.status)) {
        return result(false, existing.runId);
      }

      const runId = request.runId!;
      if (threadIdByRunId.has(runId)) return result(false, runId);
      replaceRun({
        runId,
        threadId: request.threadId,
        ...(request.requestKey ? { requestKey: request.requestKey } : {}),
        status: "starting",
        stopRequested: false,
        events: [],
        pendingPermissions: [],
        pendingQuestions: [],
      });
      publish();
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
      publish();
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
      replaceRun({ ...next, status: statusAfterInteraction(next) });
      publish();
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
      replaceRun({ ...next, status: statusAfterInteraction(next) });
      publish();
      options.respondToQuestion(response);
      return result(true, run.runId);
    },

    handleEvent(event: ChatRunEvent) {
      const run = getRun(event.runId);
      if (!run || isTerminalSharedChatRunStatus(run.status)) return;

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

      let next: SharedChatRun = { ...run, events: [...run.events, authoritativeEvent] };
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
      }

      replaceRun(next);
      publish();
    },
  };
}

export type ChatRunAuthority = ReturnType<typeof createChatRunAuthority>;
