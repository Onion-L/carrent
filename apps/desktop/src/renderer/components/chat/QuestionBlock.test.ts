import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import type { MessagePart } from "../../mock/uiShellData";
import { getQuestionStatusLabel, QuestionBlock, type QuestionPart } from "./QuestionBlock";

function makePart(overrides: Partial<QuestionPart> = {}): QuestionPart {
  return {
    type: "question",
    id: "question-q-1",
    questionId: "q-1",
    status: "answered",
    questions: [
      { header: "Language", question: "Which language should the new module use?" },
      { header: "Features", question: "Which features should the module include?" },
    ],
    answers: [
      { questionIndex: 0, labels: ["TypeScript"] },
      { questionIndex: 1, labels: ["Logging", "Other"], customText: "Coverage reports" },
    ],
    ...overrides,
  };
}

describe("QuestionBlock", () => {
  it("renders each question with only its final answer in compact form", () => {
    const markup = renderToStaticMarkup(createElement(QuestionBlock, { part: makePart() }));

    expect(markup).toContain("Which language should the new module use?");
    expect(markup).toContain("Which features should the module include?");
    expect(markup).toContain("TypeScript");
    expect(markup).toContain("Logging");
    expect(markup).toContain("Coverage reports");
    // Unselected options are never repeated in the record.
    expect(markup).not.toContain("JavaScript");
    expect(markup).not.toContain("Metrics");
    expect(markup).not.toContain("Tracing");
  });

  it("labels the record as Answered", () => {
    const markup = renderToStaticMarkup(createElement(QuestionBlock, { part: makePart() }));

    expect(getQuestionStatusLabel(makePart())).toBe("Answered");
    expect(markup).toContain("Answered");
  });

  it("distinguishes a skipped record from an answered one", () => {
    const part = makePart({ status: "skipped", answers: undefined });
    const markup = renderToStaticMarkup(createElement(QuestionBlock, { part }));

    expect(getQuestionStatusLabel(part)).toBe("Skipped");
    expect(markup).toContain("Skipped");
    expect(markup).not.toContain("Answered");
    // The asked questions stay visible so the record explains what was skipped.
    expect(markup).toContain("Which language should the new module use?");
  });

  it("distinguishes an interrupted record from a completed one", () => {
    const part = makePart({ status: "interrupted", answers: undefined });
    const markup = renderToStaticMarkup(createElement(QuestionBlock, { part }));

    expect(getQuestionStatusLabel(part)).toBe("Interrupted");
    expect(markup).toContain("Interrupted");
    expect(markup).not.toContain("Answered");
  });
});

describe("MessageTimeline question parts", () => {
  it("excludes question parts from the activity trail and answer text", async () => {
    const { getAssistantMessagePresentation } = await import("./MessageTimeline");
    const parts: MessagePart[] = [
      { type: "reasoning", id: "reasoning-1", content: "Checking options", status: "completed" },
      makePart(),
      { type: "text", content: "The module is ready." },
    ];

    const presentation = getAssistantMessagePresentation(parts, "completed");

    expect(presentation.activityItems).toEqual([parts[0]]);
    expect(presentation.answerText).toBe("The module is ready.");
  });
});
