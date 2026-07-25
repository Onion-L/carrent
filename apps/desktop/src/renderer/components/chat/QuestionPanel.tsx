import { useState } from "react";
import { CircleAlert } from "lucide-react";

import {
  CHAT_QUESTION_OTHER_OPTION_ID,
  type ChatQuestionItem,
  type ChatQuestionRequest,
  type ChatQuestionResponse,
} from "../../../shared/chatQuestions";
import { useChatRun } from "../../hooks/useChatRun";
import {
  createQuestionDrafts,
  getQuestionDraftState,
  setQuestionDraftState,
  type QuestionDraft,
  type QuestionDraftState,
} from "../../lib/questionDrafts";

export function getPendingQuestionForThread({
  pendingQuestions,
  threadId,
}: {
  pendingQuestions: ChatQuestionRequest[];
  threadId: string;
}) {
  return pendingQuestions.find((question) => question.threadId === threadId) ?? null;
}

// Draft answers live in a module-level store keyed by question id (see
// lib/questionDrafts.ts) so navigating between questions — or away from the
// Thread and back — never loses selections or text. The panel keeps a local
// copy while mounted and writes every change through to the store.

export function toggleQuestionOption(
  item: ChatQuestionItem,
  draft: QuestionDraft,
  optionId: string,
): QuestionDraft {
  if (!item.multiSelect) {
    // Single-select keeps exactly one answer; Other replaces the predefined
    // choice and vice versa.
    const isOnlySelection = draft.optionIds.length === 1 && draft.optionIds[0] === optionId;
    return { ...draft, optionIds: isOnlySelection ? [] : [optionId] };
  }

  const selected = draft.optionIds.includes(optionId);
  return {
    ...draft,
    optionIds: selected
      ? draft.optionIds.filter((id) => id !== optionId)
      : [...draft.optionIds, optionId],
  };
}

export function isQuestionDraftValid(draft: QuestionDraft): boolean {
  if (draft.optionIds.length === 0) {
    return false;
  }
  if (draft.optionIds.includes(CHAT_QUESTION_OTHER_OPTION_ID)) {
    return draft.otherText.trim().length > 0;
  }
  return true;
}

// Carrent adds the automatic Other free-text choice for MCP-sourced questions;
// the native ACP path only offers the options Kimi actually forwarded.
export function supportsOtherOption(question: ChatQuestionRequest) {
  return question.source === "mcp";
}

export function canSubmitQuestion(question: ChatQuestionRequest, drafts: QuestionDraft[]) {
  return (
    drafts.length === question.questions.length &&
    question.questions.every((_, index) =>
      isQuestionDraftValid(drafts[index] ?? { optionIds: [], otherText: "" }),
    )
  );
}

export function buildQuestionSubmitResponse(
  question: ChatQuestionRequest,
  drafts: QuestionDraft[],
): ChatQuestionResponse {
  return {
    questionId: question.id,
    runId: question.runId,
    action: "submit",
    answers: question.questions.map((_, index) => {
      const draft = drafts[index] ?? { optionIds: [], otherText: "" };
      return {
        questionIndex: index,
        optionIds: [...draft.optionIds],
        ...(draft.optionIds.includes(CHAT_QUESTION_OTHER_OPTION_ID)
          ? { customText: draft.otherText }
          : {}),
      };
    }),
  };
}

export function buildQuestionSkipResponse(question: ChatQuestionRequest): ChatQuestionResponse {
  return {
    questionId: question.id,
    runId: question.runId,
    action: "skip",
  };
}

export function QuestionPanel({ question }: { question: ChatQuestionRequest }) {
  const { respondToQuestion, stop } = useChatRun();
  const [draftState, setDraftState] = useState<QuestionDraftState>(
    () =>
      getQuestionDraftState(question.id) ?? {
        questionIndex: 0,
        drafts: createQuestionDrafts(question),
      },
  );
  const { questionIndex, drafts } = draftState;
  const item = question.questions[questionIndex];

  if (!item) {
    return null;
  }

  const draft = drafts[questionIndex] ?? { optionIds: [], otherText: "" };
  const isFirstQuestion = questionIndex === 0;
  const isLastQuestion = questionIndex === question.questions.length - 1;
  const showOther = supportsOtherOption(question);
  const otherSelected = showOther && draft.optionIds.includes(CHAT_QUESTION_OTHER_OPTION_ID);

  const updateDraftState = (next: (current: QuestionDraftState) => QuestionDraftState) => {
    setDraftState((current) => {
      const resolved = next(current);
      setQuestionDraftState(question.id, resolved);
      return resolved;
    });
  };

  const updateDraft = (next: QuestionDraft) => {
    updateDraftState((current) => ({
      ...current,
      drafts: current.drafts.map((entry, index) => (index === questionIndex ? next : entry)),
    }));
  };

  const handleSubmit = () => {
    if (!canSubmitQuestion(question, drafts)) {
      return;
    }

    void respondToQuestion(buildQuestionSubmitResponse(question, drafts));
  };

  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-start gap-2.5">
        <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-app-12 font-medium text-muted">{item.header}</div>
            {question.questions.length > 1 ? (
              <div className="shrink-0 text-app-12 text-subtle">
                Question {questionIndex + 1} of {question.questions.length}
              </div>
            ) : null}
          </div>
          <div className="mt-0.5 break-words text-app-13 font-medium text-fg">{item.question}</div>
        </div>
      </div>
      <div
        className="mt-3 flex flex-col gap-1.5"
        role="listbox"
        aria-label={item.question}
        aria-multiselectable={item.multiSelect || undefined}
      >
        {item.options.map((option) => (
          <OptionButton
            key={option.optionId}
            label={option.label}
            description={option.description}
            isSelected={draft.optionIds.includes(option.optionId)}
            multiSelect={item.multiSelect}
            onSelect={() => updateDraft(toggleQuestionOption(item, draft, option.optionId))}
          />
        ))}
        {showOther ? (
          <OptionButton
            label="Other"
            isSelected={otherSelected}
            multiSelect={item.multiSelect}
            onSelect={() =>
              updateDraft(toggleQuestionOption(item, draft, CHAT_QUESTION_OTHER_OPTION_ID))
            }
          />
        ) : null}
      </div>
      {otherSelected ? (
        <input
          type="text"
          value={draft.otherText}
          onChange={(event) => updateDraft({ ...draft, otherText: event.target.value })}
          aria-label="Custom answer"
          placeholder="Type your answer"
          autoFocus
          className="mt-2 w-full rounded-lg border border-border bg-bg px-3 py-2 text-app-13 text-fg outline-none placeholder:text-subtle focus:border-border-strong"
        />
      ) : null}
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => void stop(question.threadId)}
          className="rounded-md px-2.5 py-1.5 text-app-12 text-muted transition hover:text-fg"
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => void respondToQuestion(buildQuestionSkipResponse(question))}
          className="rounded-md border border-border px-2.5 py-1.5 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
        >
          Skip
        </button>
        {!isFirstQuestion ? (
          <button
            type="button"
            onClick={() =>
              updateDraftState((current) => ({
                ...current,
                questionIndex: Math.max(0, current.questionIndex - 1),
              }))
            }
            className="rounded-md border border-border px-2.5 py-1.5 text-app-12 text-muted transition hover:bg-surface-hover hover:text-fg"
          >
            Back
          </button>
        ) : null}
        {!isLastQuestion ? (
          <button
            type="button"
            onClick={() =>
              updateDraftState((current) => ({
                ...current,
                questionIndex: Math.min(question.questions.length - 1, current.questionIndex + 1),
              }))
            }
            disabled={!isQuestionDraftValid(draft)}
            className="rounded-md bg-fg px-3 py-1.5 text-app-12 font-medium text-bg transition hover:opacity-90 disabled:opacity-30"
          >
            Next
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmitQuestion(question, drafts)}
            className="rounded-md bg-fg px-3 py-1.5 text-app-12 font-medium text-bg transition hover:opacity-90 disabled:opacity-30"
          >
            Submit
          </button>
        )}
      </div>
    </div>
  );
}

function OptionButton({
  label,
  description,
  isSelected,
  multiSelect,
  onSelect,
}: {
  label: string;
  description?: string;
  isSelected: boolean;
  multiSelect: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition ${
        isSelected
          ? "border-border-strong bg-surface-hover"
          : "border-border hover:bg-surface-raised"
      }`}
    >
      <span
        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center border ${
          multiSelect ? "rounded-[4px]" : "rounded-full"
        } ${isSelected ? "border-fg bg-fg" : "border-border-strong"}`}
      >
        {isSelected ? (
          <span className={`h-1.5 w-1.5 bg-bg ${multiSelect ? "rounded-[1px]" : "rounded-full"}`} />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-app-13 font-medium text-fg">{label}</span>
        {description ? (
          <span className="mt-0.5 block break-words text-app-12 text-subtle">{description}</span>
        ) : null}
      </span>
    </button>
  );
}
