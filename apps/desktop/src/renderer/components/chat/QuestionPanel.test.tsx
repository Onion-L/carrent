import { afterEach, beforeEach, describe, expect, it } from "bun:test";

// Registers the DOM globals before react-dom evaluates (see the module).
import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { ChatRunEvent, ChatTurnRequest } from "../../../shared/chat";
import type {
  ChatQuestionItem,
  ChatQuestionRequest,
  ChatQuestionResponse,
} from "../../../shared/chatQuestions";
import { useChatRun } from "../../hooks/useChatRun";
import { clearQuestionDraftState } from "../../lib/questionDrafts";
import { QuestionPanel } from "./QuestionPanel";

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

let questionCounter = 0;

function makeQuestion(overrides: Partial<ChatQuestionRequest> = {}): ChatQuestionRequest {
  questionCounter += 1;
  return {
    id: `kimi-question-run-1-ui-${questionCounter}`,
    runId: "run-1",
    threadId: "thread-1",
    provider: "kimi",
    source: "mcp",
    questions: [LANGUAGE_ITEM],
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const questionResponses: ChatQuestionResponse[] = [];
const stoppedRunIds: string[] = [];
let chatEventListener: ((event: ChatRunEvent) => void) | null = null;
let harnessChat: ReturnType<typeof useChatRun> | null = null;

function Harness({ question }: { question: ChatQuestionRequest }) {
  harnessChat = useChatRun();
  return <QuestionPanel question={question} />;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let renderedQuestion: ChatQuestionRequest | null = null;

async function renderPanel(question: ChatQuestionRequest) {
  renderedQuestion = question;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<Harness question={question} />);
  });
}

function optionButtons(): HTMLButtonElement[] {
  return [...container!.querySelectorAll<HTMLButtonElement>('[role="option"]')];
}

function optionByLabel(label: string): HTMLButtonElement {
  const found = optionButtons().find((button) => button.textContent?.includes(label));
  if (!found) {
    throw new Error(`Option not rendered: ${label}`);
  }
  return found;
}

function actionButton(text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => !button.getAttribute("role") && button.textContent?.trim() === text,
  );
  if (!found) {
    throw new Error(`Button not rendered: ${text}`);
  }
  return found;
}

function customAnswerInput(): HTMLInputElement | null {
  return container!.querySelector<HTMLInputElement>('input[aria-label="Custom answer"]');
}

function typeIntoInput(input: HTMLInputElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  // happy-dom registers before react-dom evaluates its input-event support
  // flag, so drive both the modern ("input") and the polyfill ("keyup" on the
  // focused element) paths; whichever React picked fires onChange exactly once.
  input.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
  setter.call(input, text);
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: text.at(-1) }));
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
  });
}

async function startRunForThread() {
  const request: ChatTurnRequest = {
    workspace: { kind: "chat" },
    threadId: "thread-1",
    runtimeId: "kimi",
    runtimeMode: "default",
    planMode: false,
    transcript: [],
    message: "hello",
  };
  await act(async () => {
    await harnessChat!.send(request, {});
  });
}

beforeEach(() => {
  questionResponses.length = 0;
  stoppedRunIds.length = 0;
  chatEventListener = null;
  harnessChat = null;
  window.carrent = {
    chat: {
      send: async () => ({ runId: "run-1" }),
      stop: async (runId: string) => {
        stoppedRunIds.push(runId);
      },
      deleteThreadData: async () => {},
      respondToPermission: async () => {},
      respondToQuestion: async (response: ChatQuestionResponse) => {
        questionResponses.push(response);
      },
      getKimiStatus: async () => null,
      onEvent: (listener: (event: ChatRunEvent) => void) => {
        chatEventListener = listener;
        return () => {
          chatEventListener = null;
        };
      },
    },
  } as unknown as Window["carrent"];
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root!.unmount();
    });
    root = null;
  }
  container?.remove();
  container = null;
  if (renderedQuestion) {
    clearQuestionDraftState(renderedQuestion.id);
    renderedQuestion = null;
  }
  // Drain any run started through the harness so the module-level coordinator
  // is clean for the next test.
  if (chatEventListener) {
    chatEventListener({ type: "stopped", runId: "run-1" });
  }
});

describe("QuestionPanel", () => {
  it("renders the header, question text, and options with descriptions", async () => {
    await renderPanel(makeQuestion());

    expect(container!.textContent).toContain("Language");
    expect(container!.textContent).toContain("Which language should the new module use?");
    expect(container!.textContent).toContain("TypeScript");
    expect(container!.textContent).toContain("Use TypeScript");
    expect(container!.textContent).toContain("JavaScript");
  });

  it("exposes listbox semantics: options with aria-selected and the question as label", async () => {
    await renderPanel(makeQuestion());

    const listbox = container!.querySelector('[role="listbox"]')!;
    expect(listbox.getAttribute("aria-label")).toBe("Which language should the new module use?");
    expect(listbox.getAttribute("aria-multiselectable")).toBe(null);

    const typescript = optionByLabel("TypeScript");
    expect(typescript.getAttribute("aria-selected")).toBe("false");
    await click(typescript);
    expect(optionByLabel("TypeScript").getAttribute("aria-selected")).toBe("true");
  });

  it("marks a multi-select question as aria-multiselectable", async () => {
    await renderPanel(makeQuestion({ questions: [FEATURES_ITEM] }));

    const listbox = container!.querySelector('[role="listbox"]')!;
    expect(listbox.getAttribute("aria-multiselectable")).toBe("true");
  });

  it("reveals and focuses the free-text input only when Other is selected", async () => {
    await renderPanel(makeQuestion());

    expect(customAnswerInput()).toBe(null);

    await click(optionByLabel("Other"));
    const input = customAnswerInput();
    expect(input).not.toBe(null);
    expect(document.activeElement).toBe(input);

    await click(optionByLabel("Other"));
    expect(customAnswerInput()).toBe(null);
  });

  it("never offers Other for native ACP questions", async () => {
    await renderPanel(makeQuestion({ source: "native-acp" }));

    expect(optionButtons().some((button) => button.textContent?.includes("Other"))).toBe(false);
  });

  it("replaces the selection for a single-select question", async () => {
    await renderPanel(makeQuestion());

    await click(optionByLabel("TypeScript"));
    await click(optionByLabel("JavaScript"));

    expect(optionByLabel("TypeScript").getAttribute("aria-selected")).toBe("false");
    expect(optionByLabel("JavaScript").getAttribute("aria-selected")).toBe("true");
  });

  it("toggles selections independently for a multi-select question", async () => {
    await renderPanel(makeQuestion({ questions: [FEATURES_ITEM] }));

    await click(optionByLabel("Logging"));
    await click(optionByLabel("Tracing"));
    expect(optionByLabel("Logging").getAttribute("aria-selected")).toBe("true");
    expect(optionByLabel("Tracing").getAttribute("aria-selected")).toBe("true");

    await click(optionByLabel("Logging"));
    expect(optionByLabel("Logging").getAttribute("aria-selected")).toBe("false");
    expect(optionByLabel("Tracing").getAttribute("aria-selected")).toBe("true");
  });

  it("disables Next until the current question has a valid answer", async () => {
    await renderPanel(makeQuestion({ questions: [LANGUAGE_ITEM, FEATURES_ITEM] }));

    expect(actionButton("Next").disabled).toBe(true);
    await click(optionByLabel("TypeScript"));
    expect(actionButton("Next").disabled).toBe(false);
  });

  it("requires custom text before an Other answer counts as valid", async () => {
    await renderPanel(makeQuestion());

    await click(optionByLabel("Other"));
    expect(actionButton("Submit").disabled).toBe(true);

    await act(async () => {
      typeIntoInput(customAnswerInput()!, "Use Python");
    });
    expect(actionButton("Submit").disabled).toBe(false);
  });

  it("shows Submit only on the last question and submits the assembled answers", async () => {
    const question = makeQuestion({ questions: [LANGUAGE_ITEM, FEATURES_ITEM] });
    await renderPanel(question);

    expect(container!.textContent).toContain("Question 1 of 2");
    expect(
      [...container!.querySelectorAll("button")].some(
        (button) => button.textContent?.trim() === "Submit",
      ),
    ).toBe(false);

    await click(optionByLabel("TypeScript"));
    await click(actionButton("Next"));

    expect(container!.textContent).toContain("Question 2 of 2");
    expect(actionButton("Submit").disabled).toBe(true);

    await click(optionByLabel("Logging"));
    expect(actionButton("Submit").disabled).toBe(false);

    await click(actionButton("Submit"));
    expect(questionResponses).toEqual([
      {
        questionId: question.id,
        runId: "run-1",
        action: "submit",
        answers: [
          { questionIndex: 0, optionIds: ["mcp-q1-opt-1"] },
          { questionIndex: 1, optionIds: ["mcp-q2-opt-1"] },
        ],
      },
    ]);
  });

  it("keeps selections when navigating Back and Next", async () => {
    await renderPanel(makeQuestion({ questions: [LANGUAGE_ITEM, FEATURES_ITEM] }));

    await click(optionByLabel("TypeScript"));
    await click(actionButton("Next"));
    await click(optionByLabel("Logging"));

    await click(actionButton("Back"));
    expect(optionByLabel("TypeScript").getAttribute("aria-selected")).toBe("true");

    await click(actionButton("Next"));
    expect(optionByLabel("Logging").getAttribute("aria-selected")).toBe("true");
  });

  it("does not show progress for a single question", async () => {
    await renderPanel(makeQuestion());

    expect(container!.textContent).not.toContain("Question 1 of 1");
  });

  it("sends a skip response through Skip", async () => {
    const question = makeQuestion();
    await renderPanel(question);

    await click(actionButton("Skip"));

    expect(questionResponses).toEqual([
      { questionId: question.id, runId: "run-1", action: "skip" },
    ]);
  });

  it("stops the owning run through Stop", async () => {
    await renderPanel(makeQuestion());
    await startRunForThread();

    await click(actionButton("Stop"));

    expect(stoppedRunIds).toEqual(["run-1"]);
  });
});
