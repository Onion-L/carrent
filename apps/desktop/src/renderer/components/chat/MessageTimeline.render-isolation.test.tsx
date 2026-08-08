import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import React from "react";

// A counting wrapper records every Markdown render so the tests can observe,
// from outside the component tree, how often message content is re-rendered.
// It delegates to the real implementation: Bun shares one module registry
// across test files in a run, so a behavior-changing stub would leak.
// The real component is captured BEFORE mock.module() because Bun patches
// live bindings recursively — importing react-markdown inside the factory
// (or after the override) resolves back to the mock and recurses forever.
const { default: RealReactMarkdown } = await import("react-markdown");

const markdownRenderLog: string[] = [];

mock.module("react-markdown", () => ({
  default: (props: React.ComponentProps<typeof RealReactMarkdown>) => {
    markdownRenderLog.push(String(props.children ?? ""));
    return React.createElement(RealReactMarkdown, props);
  },
}));

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { Message } from "../../../shared/threadContent";
import { MessageTimeline } from "./MessageTimeline";

function assistantMessage(id: string, content: string, runStatus?: Message["runStatus"]): Message {
  return {
    id,
    threadId: "thread-1",
    role: "assistant",
    type: "text",
    content,
    timestamp: "09:00",
    createdAt: 1000,
    runStatus,
  };
}

function countRendersOf(content: string) {
  return markdownRenderLog.filter((entry) => entry === content).length;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  markdownRenderLog.length = 0;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("MessageTimeline render isolation", () => {
  it("does not rerender a completed message when only the active answer grows", async () => {
    const historicalContent = "# Historical\n\ncompleted answer";
    const historical = assistantMessage("assistant-done", historicalContent, "completed");
    const active = assistantMessage("assistant-live", "partial", "running");

    await act(async () => {
      root.render(<MessageTimeline messages={[historical, active]} threadActions={[]} />);
    });
    expect(countRendersOf(historicalContent)).toBe(1);
    expect(countRendersOf("partial")).toBe(1);

    const grown = { ...active, content: "partial plus more" };
    await act(async () => {
      root.render(<MessageTimeline messages={[historical, grown]} threadActions={[]} />);
    });

    expect(countRendersOf(historicalContent)).toBe(1);
    expect(countRendersOf("partial plus more")).toBe(1);
    expect(container.textContent).toContain("completed answer");
    expect(container.textContent).toContain("partial plus more");
  });

  it("does not rerender any message when the timeline receives unchanged messages", async () => {
    const historical = assistantMessage("assistant-done", "stable answer", "completed");
    const active = assistantMessage("assistant-live", "partial", "running");

    await act(async () => {
      root.render(<MessageTimeline messages={[historical, active]} threadActions={[]} />);
    });
    markdownRenderLog.length = 0;

    await act(async () => {
      root.render(<MessageTimeline messages={[historical, active]} threadActions={[]} />);
    });

    expect(markdownRenderLog).toHaveLength(0);
  });

  it("rerenders a completed message when its own content changes", async () => {
    const historical = assistantMessage("assistant-done", "first answer", "completed");
    const active = assistantMessage("assistant-live", "partial", "running");

    await act(async () => {
      root.render(<MessageTimeline messages={[historical, active]} threadActions={[]} />);
    });

    const edited = { ...historical, content: "edited answer" };
    await act(async () => {
      root.render(<MessageTimeline messages={[edited, active]} threadActions={[]} />);
    });

    expect(countRendersOf("edited answer")).toBe(1);
    expect(countRendersOf("partial")).toBe(1);
    expect(container.textContent).toContain("edited answer");
  });
});
