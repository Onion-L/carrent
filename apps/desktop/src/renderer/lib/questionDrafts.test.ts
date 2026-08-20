import { describe, expect, it } from "bun:test";

import type { ChatQuestionRequest } from "../../shared/chatQuestions";
import {
  buildQuestionAnswerRecords,
  getQuestionDraftsFromAnswers,
  clearQuestionDraftState,
  createQuestionDrafts,
  getQuestionDraftState,
  setQuestionDraftState,
} from "./questionDrafts";

function makeQuestion(overrides: Partial<ChatQuestionRequest> = {}): ChatQuestionRequest {
  return {
    id: "agent-question-run-1-7",
    runId: "run-1",
    threadId: "thread-1",
    provider: "core",
    source: "core",
    questions: [
      {
        header: "Language",
        question: "Which language should the new module use?",
        options: [
          { optionId: "opt_ts", label: "TypeScript" },
          { optionId: "opt_js", label: "JavaScript" },
        ],
        multiSelect: false,
      },
      {
        header: "Features",
        question: "Which features should the module include?",
        options: [
          { optionId: "opt_logging", label: "Logging" },
          { optionId: "opt_metrics", label: "Metrics" },
        ],
        multiSelect: true,
      },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("question draft store", () => {
  it("returns null for a question with no stored drafts", () => {
    expect(getQuestionDraftState("unknown-question")).toBe(null);
  });

  it("restores the same question index, selections, and Other text after a remount", () => {
    const question = makeQuestion();
    setQuestionDraftState(question.id, {
      questionIndex: 1,
      drafts: [
        { optionIds: ["opt_ts"], otherText: "" },
        { optionIds: ["opt_logging", "other"], otherText: "Coverage reports" },
      ],
    });

    // A remounted panel reads the store instead of initializing fresh state.
    expect(getQuestionDraftState(question.id)).toEqual({
      questionIndex: 1,
      drafts: [
        { optionIds: ["opt_ts"], otherText: "" },
        { optionIds: ["opt_logging", "other"], otherText: "Coverage reports" },
      ],
    });
    clearQuestionDraftState(question.id);
  });

  it("hands out copies so callers cannot corrupt the stored draft", () => {
    setQuestionDraftState("q-copy", {
      questionIndex: 0,
      drafts: [{ optionIds: ["opt_ts"], otherText: "" }],
    });

    const state = getQuestionDraftState("q-copy");
    state?.drafts[0]?.optionIds.push("opt_js");

    expect(getQuestionDraftState("q-copy")?.drafts[0]?.optionIds).toEqual(["opt_ts"]);
    clearQuestionDraftState("q-copy");
  });

  it("resets drafts when the question is resolved", () => {
    setQuestionDraftState("q-clear", {
      questionIndex: 0,
      drafts: [{ optionIds: ["opt_ts"], otherText: "" }],
    });

    clearQuestionDraftState("q-clear");

    expect(getQuestionDraftState("q-clear")).toBe(null);
  });

  it("scopes drafts by question id so a new request starts fresh", () => {
    setQuestionDraftState("q-old", {
      questionIndex: 1,
      drafts: [{ optionIds: ["opt_ts"], otherText: "" }],
    });

    expect(getQuestionDraftState("q-new")).toBe(null);
    expect(createQuestionDrafts(makeQuestion())).toEqual([
      { optionIds: ["opt_ts"], otherText: "" },
      { optionIds: [], otherText: "" },
    ]);
    clearQuestionDraftState("q-old");
  });
});

describe("buildQuestionAnswerRecords", () => {
  it("maps selected option ids to their labels for every question", () => {
    const question = makeQuestion();

    expect(
      buildQuestionAnswerRecords(question, [
        { optionIds: ["opt_ts"], otherText: "" },
        { optionIds: ["opt_logging", "opt_metrics"], otherText: "" },
      ]),
    ).toEqual([
      { questionIndex: 0, labels: ["TypeScript"] },
      { questionIndex: 1, labels: ["Logging", "Metrics"] },
    ]);
  });

  it("carries the Other answer as a label plus custom text", () => {
    const question = makeQuestion();

    expect(
      buildQuestionAnswerRecords(question, [
        { optionIds: ["other"], otherText: "Python" },
        { optionIds: ["opt_logging", "other"], otherText: "Coverage reports" },
      ]),
    ).toEqual([
      { questionIndex: 0, labels: ["Other"], customText: "Python" },
      { questionIndex: 1, labels: ["Logging", "Other"], customText: "Coverage reports" },
    ]);
  });

  it("drops option ids the agent never offered instead of inventing labels", () => {
    const question = makeQuestion();

    expect(
      buildQuestionAnswerRecords(question, [
        { optionIds: ["opt_unknown"], otherText: "" },
        { optionIds: [], otherText: "" },
      ]),
    ).toEqual([
      { questionIndex: 0, labels: [] },
      { questionIndex: 1, labels: [] },
    ]);
  });
});

describe("getQuestionDraftsFromAnswers", () => {
  it("restores indexed selections and Other text from an authoritative response", () => {
    expect(
      getQuestionDraftsFromAnswers(makeQuestion(), [
        { questionIndex: 1, optionIds: ["other"], customText: "Rust" },
        { questionIndex: 0, optionIds: ["opt-a"] },
      ]),
    ).toEqual([
      { optionIds: ["opt-a"], otherText: "" },
      { optionIds: ["other"], otherText: "Rust" },
    ]);
  });
});
