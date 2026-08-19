import { describe, expect, it } from "bun:test";

import {
  CHAT_QUESTION_OTHER_OPTION_ID,
  type ChatQuestionItem,
  type ChatQuestionRequest,
} from "../../../shared/chatQuestions";
import {
  buildQuestionSkipResponse,
  buildQuestionSubmitResponse,
  canSubmitQuestion,
  getPendingQuestionForThread,
  isQuestionDraftValid,
  supportsOtherOption,
  toggleQuestionOption,
} from "./QuestionPanel";
import { createQuestionDrafts, type QuestionDraft } from "../../lib/questionDrafts";

const LANGUAGE_ITEM: ChatQuestionItem = {
  header: "Language",
  question: "Which language should the new module use?",
  options: [
    { optionId: "mcp-q1-opt-1", label: "TypeScript", description: "Use TypeScript" },
    { optionId: "mcp-q1-opt-2", label: "JavaScript" },
  ],
  multiSelect: false,
};

const FEATURES_ITEM: ChatQuestionItem = {
  header: "Features",
  question: "Which features should the module include?",
  options: [
    { optionId: "mcp-q2-opt-1", label: "Logging", description: "Structured logs" },
    { optionId: "mcp-q2-opt-2", label: "Metrics" },
    { optionId: "mcp-q2-opt-3", label: "Tracing" },
  ],
  multiSelect: true,
};

function makeQuestion(overrides: Partial<ChatQuestionRequest> = {}): ChatQuestionRequest {
  return {
    id: "kimi-question-run-1-7",
    runId: "run-1",
    threadId: "thread-1",
    provider: "kimi",
    source: "native-acp",
    questions: [LANGUAGE_ITEM],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDraft(overrides: Partial<QuestionDraft> = {}): QuestionDraft {
  return { optionIds: [], otherText: "", ...overrides };
}

describe("getPendingQuestionForThread", () => {
  it("returns the question owned by the thread", () => {
    const question = makeQuestion();

    expect(
      getPendingQuestionForThread({ pendingQuestions: [question], threadId: "thread-1" }),
    ).toBe(question);
  });

  it("returns null for a thread without a pending question", () => {
    const question = makeQuestion();

    expect(
      getPendingQuestionForThread({ pendingQuestions: [question], threadId: "thread-2" }),
    ).toBe(null);
    expect(getPendingQuestionForThread({ pendingQuestions: [], threadId: "thread-1" })).toBe(null);
  });
});

describe("createQuestionDrafts", () => {
  it("preselects the first option of single-select questions for keyboard use", () => {
    expect(
      createQuestionDrafts(makeQuestion({ questions: [LANGUAGE_ITEM, FEATURES_ITEM] })),
    ).toEqual([makeDraft({ optionIds: ["mcp-q1-opt-1"] }), makeDraft()]);
  });
});

describe("toggleQuestionOption", () => {
  it("selects and replaces for a single-select question; re-clicking keeps the choice", () => {
    const empty = makeDraft();
    const selected = toggleQuestionOption(LANGUAGE_ITEM, empty, "mcp-q1-opt-1");
    expect(selected.optionIds).toEqual(["mcp-q1-opt-1"]);

    const replaced = toggleQuestionOption(LANGUAGE_ITEM, selected, "mcp-q1-opt-2");
    expect(replaced.optionIds).toEqual(["mcp-q1-opt-2"]);

    expect(toggleQuestionOption(LANGUAGE_ITEM, replaced, "mcp-q1-opt-2").optionIds).toEqual([
      "mcp-q1-opt-2",
    ]);
  });

  it("keeps Other exclusive for a single-select question", () => {
    const predefined = makeDraft({ optionIds: ["mcp-q1-opt-1"] });
    const other = toggleQuestionOption(LANGUAGE_ITEM, predefined, CHAT_QUESTION_OTHER_OPTION_ID);
    expect(other.optionIds).toEqual([CHAT_QUESTION_OTHER_OPTION_ID]);

    const backToPredefined = toggleQuestionOption(LANGUAGE_ITEM, other, "mcp-q1-opt-2");
    expect(backToPredefined.optionIds).toEqual(["mcp-q1-opt-2"]);
  });

  it("accumulates and toggles off selections for a multi-select question", () => {
    let draft = makeDraft();
    draft = toggleQuestionOption(FEATURES_ITEM, draft, "mcp-q2-opt-1");
    draft = toggleQuestionOption(FEATURES_ITEM, draft, "mcp-q2-opt-3");
    expect(draft.optionIds).toEqual(["mcp-q2-opt-1", "mcp-q2-opt-3"]);

    draft = toggleQuestionOption(FEATURES_ITEM, draft, "mcp-q2-opt-1");
    expect(draft.optionIds).toEqual(["mcp-q2-opt-3"]);
  });

  it("combines Other with predefined choices for a multi-select question", () => {
    let draft = makeDraft({ optionIds: ["mcp-q2-opt-1"] });
    draft = toggleQuestionOption(FEATURES_ITEM, draft, CHAT_QUESTION_OTHER_OPTION_ID);
    expect(draft.optionIds).toEqual(["mcp-q2-opt-1", CHAT_QUESTION_OTHER_OPTION_ID]);
  });
});

describe("isQuestionDraftValid", () => {
  it("requires at least one selection", () => {
    expect(isQuestionDraftValid(makeDraft())).toBe(false);
    expect(isQuestionDraftValid(makeDraft({ optionIds: ["mcp-q1-opt-1"] }))).toBe(true);
  });

  it("requires non-empty custom text when Other is selected", () => {
    expect(isQuestionDraftValid(makeDraft({ optionIds: [CHAT_QUESTION_OTHER_OPTION_ID] }))).toBe(
      false,
    );
    expect(
      isQuestionDraftValid(
        makeDraft({ optionIds: [CHAT_QUESTION_OTHER_OPTION_ID], otherText: "   " }),
      ),
    ).toBe(false);
    expect(
      isQuestionDraftValid(
        makeDraft({ optionIds: [CHAT_QUESTION_OTHER_OPTION_ID], otherText: "Use Python" }),
      ),
    ).toBe(true);
  });

  it("applies the Other text rule alongside predefined multi-select choices", () => {
    expect(
      isQuestionDraftValid(
        makeDraft({ optionIds: ["mcp-q2-opt-1", CHAT_QUESTION_OTHER_OPTION_ID] }),
      ),
    ).toBe(false);
    expect(
      isQuestionDraftValid(
        makeDraft({
          optionIds: ["mcp-q2-opt-1", CHAT_QUESTION_OTHER_OPTION_ID],
          otherText: "Coverage reports",
        }),
      ),
    ).toBe(true);
  });
});

describe("canSubmitQuestion", () => {
  it("requires every question to have a valid answer", () => {
    const question = makeQuestion({ questions: [LANGUAGE_ITEM, FEATURES_ITEM] });

    expect(
      canSubmitQuestion(question, [makeDraft({ optionIds: ["mcp-q1-opt-1"] }), makeDraft()]),
    ).toBe(false);
    expect(
      canSubmitQuestion(question, [
        makeDraft({ optionIds: ["mcp-q1-opt-1"] }),
        makeDraft({ optionIds: ["mcp-q2-opt-2"] }),
      ]),
    ).toBe(true);
  });
});

describe("Other answers", () => {
  it("offers Other only for MCP-sourced questions", () => {
    expect(supportsOtherOption(makeQuestion({ source: "mcp" }))).toBe(true);
    expect(supportsOtherOption(makeQuestion({ source: "native-acp" }))).toBe(false);
  });
});

describe("question response builders", () => {
  it("submit returns one indexed answer per question", () => {
    const question = makeQuestion({ source: "mcp", questions: [LANGUAGE_ITEM, FEATURES_ITEM] });

    expect(
      buildQuestionSubmitResponse(question, [
        makeDraft({ optionIds: ["mcp-q1-opt-2"] }),
        makeDraft({ optionIds: ["mcp-q2-opt-1", "mcp-q2-opt-3"] }),
      ]),
    ).toEqual({
      questionId: "kimi-question-run-1-7",
      runId: "run-1",
      action: "submit",
      answers: [
        { questionIndex: 0, optionIds: ["mcp-q1-opt-2"] },
        { questionIndex: 1, optionIds: ["mcp-q2-opt-1", "mcp-q2-opt-3"] },
      ],
    });
  });

  it("submit with Other carries the custom text and drops no predefined selection", () => {
    const question = makeQuestion({ source: "mcp", questions: [FEATURES_ITEM] });

    expect(
      buildQuestionSubmitResponse(question, [
        makeDraft({
          optionIds: ["mcp-q2-opt-1", CHAT_QUESTION_OTHER_OPTION_ID],
          otherText: "Coverage reports",
        }),
      ]),
    ).toEqual({
      questionId: "kimi-question-run-1-7",
      runId: "run-1",
      action: "submit",
      answers: [
        {
          questionIndex: 0,
          optionIds: ["mcp-q2-opt-1", "other"],
          customText: "Coverage reports",
        },
      ],
    });
  });

  it("submit with a predefined option carries no custom text", () => {
    expect(
      buildQuestionSubmitResponse(makeQuestion(), [
        makeDraft({ optionIds: ["mcp-q1-opt-1"], otherText: "ignored" }),
      ]),
    ).toEqual({
      questionId: "kimi-question-run-1-7",
      runId: "run-1",
      action: "submit",
      answers: [{ questionIndex: 0, optionIds: ["mcp-q1-opt-1"] }],
    });
  });

  it("skip dismisses the question without naming an option", () => {
    expect(buildQuestionSkipResponse(makeQuestion())).toEqual({
      questionId: "kimi-question-run-1-7",
      runId: "run-1",
      action: "skip",
    });
  });
});
