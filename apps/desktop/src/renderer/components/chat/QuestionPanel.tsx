import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
    // Single-select behaves like a radio group: clicking the current choice
    // keeps it. The preselected first option must not vanish on a re-click.
    return { ...draft, optionIds: [optionId] };
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

export function supportsOtherOption(_question: ChatQuestionRequest) {
  return true;
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
  const [activeIndex, setActiveIndex] = useState(0);
  const listboxRef = useRef<HTMLDivElement>(null);

  // Focus the option list when the panel appears or the question changes so
  // arrow keys work without touching the mouse. Never steal focus back from
  // something already inside the list (the Other input, a clicked option).
  useEffect(() => {
    setActiveIndex(0);
    const listbox = listboxRef.current;
    if (listbox && !listbox.contains(document.activeElement)) {
      listbox.focus();
    }
  }, [question.id, questionIndex]);

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

  const goToNextQuestion = () => {
    updateDraftState((current) => ({
      ...current,
      questionIndex: Math.min(question.questions.length - 1, current.questionIndex + 1),
    }));
  };

  const optionIds = item.options.map((option) => option.optionId);
  if (showOther) {
    optionIds.push(CHAT_QUESTION_OTHER_OPTION_ID);
  }

  const moveSelection = (delta: number) => {
    const lastIndex = optionIds.length - 1;
    if (lastIndex < 0) {
      return;
    }
    const clamp = (index: number) => Math.max(0, Math.min(lastIndex, index));
    if (item.multiSelect) {
      // Multi-select moves a highlight cursor instead; Space toggles the choice.
      setActiveIndex((current) => clamp(current + delta));
      return;
    }
    const currentIndex = draft.optionIds.length === 1 ? optionIds.indexOf(draft.optionIds[0]) : -1;
    const origin = currentIndex === -1 ? (delta > 0 ? -1 : optionIds.length) : currentIndex;
    const nextId = optionIds[clamp(origin + delta)];
    if (nextId) {
      updateDraft({ ...draft, optionIds: [nextId] });
    }
  };

  const handleListboxKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (target.tagName === "INPUT") {
        // The single-line Other input has no use for vertical arrows; hand
        // control back to the list so they keep moving the selection.
        listboxRef.current?.focus();
      }
      moveSelection(event.key === "ArrowDown" ? 1 : -1);
      return;
    }
    if (event.key === " " && item.multiSelect && target === listboxRef.current) {
      event.preventDefault();
      const optionId = optionIds[activeIndex];
      if (optionId) {
        updateDraft(toggleQuestionOption(item, draft, optionId));
      }
      return;
    }
    if (event.key === "Enter" && target.tagName !== "BUTTON") {
      // Buttons keep their native Enter click; everywhere else Enter advances.
      event.preventDefault();
      if (isLastQuestion) {
        handleSubmit();
      } else if (isQuestionDraftValid(draft)) {
        goToNextQuestion();
      }
    }
  };

  // Variant A of the .scratch/question-panel-prototype.html exploration: one
  // soft container with no border, options as compact single-line rows —
  // selected state is a row fill, not a nested box.
  return (
    <div className="rounded-xl bg-surface p-1.5">
      <div className="flex items-start gap-2.5 px-2.5 pt-2">
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
        ref={listboxRef}
        tabIndex={-1}
        onKeyDown={handleListboxKeyDown}
        className="mt-2 flex flex-col outline-none"
        role="listbox"
        aria-label={item.question}
        aria-multiselectable={item.multiSelect || undefined}
      >
        {item.options.map((option, index) => (
          <OptionButton
            key={option.optionId}
            label={option.label}
            description={option.description}
            isSelected={draft.optionIds.includes(option.optionId)}
            isActive={item.multiSelect && index === activeIndex}
            multiSelect={item.multiSelect}
            onSelect={() => updateDraft(toggleQuestionOption(item, draft, option.optionId))}
          />
        ))}
        {showOther ? (
          // Other carries its free-text input inline on the same row: no box,
          // the answer reads as a continuation of the option label itself.
          <div
            role="option"
            aria-selected={otherSelected}
            tabIndex={-1}
            onClick={() =>
              updateDraft(toggleQuestionOption(item, draft, CHAT_QUESTION_OTHER_OPTION_ID))
            }
            className={`${optionRowClass({
              selected: otherSelected,
              active: item.multiSelect && activeIndex === optionIds.length - 1,
            })} cursor-pointer`}
          >
            <OptionIndicator multiSelect={item.multiSelect} selected={otherSelected} />
            <span className="shrink-0 text-app-13 font-medium text-fg">Other</span>
            {otherSelected ? (
              <input
                type="text"
                value={draft.otherText}
                onChange={(event) => updateDraft({ ...draft, otherText: event.target.value })}
                onClick={(event) => event.stopPropagation()}
                aria-label="Custom answer"
                placeholder="Type your answer"
                autoFocus
                className="min-w-0 flex-1 bg-transparent p-0 text-app-13 text-fg outline-none placeholder:text-subtle"
              />
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-1 flex items-center justify-end gap-2 px-2.5 pb-1">
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
            onClick={goToNextQuestion}
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

// Options render as compact single-line rows inside the panel's single soft
// container — no per-option boxes. Selection is a row fill; the multi-select
// keyboard cursor reuses the hover fill.
function optionRowClass({ selected, active }: { selected: boolean; active: boolean }) {
  return `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] transition ${
    selected ? "bg-surface-hover" : active ? "bg-surface-raised" : "hover:bg-surface-raised"
  }`;
}

function OptionIndicator({ multiSelect, selected }: { multiSelect: boolean; selected: boolean }) {
  return (
    <span
      className={`flex h-[13px] w-[13px] shrink-0 items-center justify-center border-[1.5px] ${
        multiSelect ? "rounded-[4px]" : "rounded-full"
      } ${selected ? "border-fg" : "border-border-strong"}`}
    >
      {selected ? (
        <span
          className={`h-[5px] w-[5px] bg-fg ${multiSelect ? "rounded-[1px]" : "rounded-full"}`}
        />
      ) : null}
    </span>
  );
}

function OptionButton({
  label,
  description,
  isSelected,
  isActive,
  multiSelect,
  onSelect,
}: {
  label: string;
  description?: string;
  isSelected: boolean;
  isActive: boolean;
  multiSelect: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={onSelect}
      className={`${optionRowClass({ selected: isSelected, active: isActive })} cursor-pointer text-left`}
    >
      <OptionIndicator multiSelect={multiSelect} selected={isSelected} />
      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="truncate text-app-13 font-medium text-fg">{label}</span>
        {description ? (
          <span className="min-w-0 flex-1 truncate text-app-12 text-subtle">
            <span aria-hidden="true">· </span>
            {description}
          </span>
        ) : null}
      </span>
    </button>
  );
}
