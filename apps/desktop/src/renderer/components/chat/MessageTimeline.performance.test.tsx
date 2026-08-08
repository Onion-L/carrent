import { afterEach, describe, expect, it, mock } from "bun:test";
import React from "react";

// A counting wrapper records every Markdown render so the suite can measure,
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
import { MemoryRouter } from "react-router-dom";

import type { Message } from "../../../shared/threadContent";
import {
  restoreAnimationFrames,
  runAnimationFrame,
  stubAnimationFrames,
} from "../../test/animationFrames";
import { LONG_STREAMING_ANSWER, streamingRevealPrefixes } from "../../test/streamingFixture";
import { MessageTimeline } from "./MessageTimeline";
import { normalizeMathDelimiters } from "./MarkdownContent";

const HISTORICAL_CONTENT = "# Previous Answer\n\nCompleted earlier with **stable** content.";

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

type ScrollCall = { top?: number; behavior?: string };

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let scrollCalls: ScrollCall[] = [];
const originalScrollTo = Element.prototype.scrollTo;

function stubScrollTo() {
  Element.prototype.scrollTo = function (options?: ScrollToOptions) {
    scrollCalls.push(options ?? {});
  } as typeof Element.prototype.scrollTo;
}

function scrollContainer() {
  return container!.querySelector<HTMLDivElement>(".overflow-auto")!;
}

function mockScrollLayout(layout: {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}) {
  const el = scrollContainer();
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    value: layout.scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    value: layout.clientHeight,
  });
  Object.defineProperty(el, "scrollTop", { configurable: true, value: layout.scrollTop });
}

function countRendersOf(content: string) {
  return markdownRenderLog.filter((entry) => entry === content).length;
}

function renderStreamingTimeline(historical: Message, active: Message) {
  act(() => {
    root!.render(
      <MemoryRouter>
        <MessageTimeline messages={[historical, active]} threadId="thread-1" />
      </MemoryRouter>,
    );
  });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  scrollCalls = [];
  markdownRenderLog.length = 0;
  Element.prototype.scrollTo = originalScrollTo;
  restoreAnimationFrames();
});

function mountTimeline() {
  stubScrollTo();
  stubAnimationFrames();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const historical = assistantMessage("assistant-done", HISTORICAL_CONTENT, "completed");
  renderStreamingTimeline(historical, assistantMessage("assistant-live", "", "running"));
  // Park the view at the bottom and discard the initial jump-to-latest scroll.
  mockScrollLayout({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
  scrollCalls = [];
  return historical;
}

describe("MessageTimeline long-answer streaming performance", () => {
  it("bounds Markdown renders and coalesces scrolling across the fixture stream", () => {
    const historical = mountTimeline();
    const prefixes = streamingRevealPrefixes(LONG_STREAMING_ANSWER);

    let frames = 0;
    for (const [index, prefix] of prefixes.entries()) {
      const isLast = index === prefixes.length - 1;
      renderStreamingTimeline(
        historical,
        assistantMessage("assistant-live", prefix, isLast ? "completed" : "running"),
      );
      runAnimationFrame();
      frames += 1;
    }

    // Automatic following stays instant and coalesced: at most one scroll
    // command per frame, never a smooth animation driven by streaming.
    expect(scrollCalls.length).toBeGreaterThan(0);
    expect(scrollCalls.length).toBeLessThanOrEqual(frames);
    expect(scrollCalls.every((call) => call.behavior !== "smooth")).toBe(true);

    // The completed historical message rendered exactly once for the whole run.
    expect(countRendersOf(HISTORICAL_CONTENT)).toBe(1);

    // The active answer rendered exactly once per visible commit — no frame
    // produced more than one Markdown render, and none were skipped. The
    // Markdown component receives math-normalized text, so compare against
    // the normalized prefixes.
    const activeRenders = prefixes.reduce(
      (total, prefix) => total + countRendersOf(normalizeMathDelimiters(prefix)),
      0,
    );
    expect(activeRenders).toBe(prefixes.length);
    const normalizedFixture = normalizeMathDelimiters(LONG_STREAMING_ANSWER);
    expect(countRendersOf(normalizedFixture)).toBe(1);
    expect(markdownRenderLog[markdownRenderLog.length - 1]).toBe(normalizedFixture);

    // Deliberate baseline telemetry for the epic: compare future runs against
    // these counts to spot render/scroll regressions.
    console.log(
      `[streaming-baseline] frames=${frames} markdownRenders=${activeRenders} ` +
        `historicalRenders=${countRendersOf(HISTORICAL_CONTENT)} scrollCommands=${scrollCalls.length}`,
    );
  });

  it("suspends following after the user scrolls up, then resumes from the explicit button", () => {
    const historical = mountTimeline();
    const prefixes = streamingRevealPrefixes(LONG_STREAMING_ANSWER);

    const streamFrame = (index: number) => {
      renderStreamingTimeline(
        historical,
        assistantMessage("assistant-live", prefixes[index]!, "running"),
      );
      runAnimationFrame();
    };

    streamFrame(0);
    streamFrame(1);
    expect(scrollCalls.length).toBeGreaterThan(0);

    // The user scrolls up to read history; later streaming frames must not
    // drag the view back to the bottom.
    mockScrollLayout({ scrollHeight: 3000, clientHeight: 500, scrollTop: 400 });
    act(() => {
      scrollContainer().dispatchEvent(new window.Event("scroll"));
    });
    scrollCalls = [];
    streamFrame(2);
    streamFrame(3);
    expect(scrollCalls).toHaveLength(0);

    // The explicit return-to-bottom control keeps its smooth animation.
    const button = container!.querySelector<HTMLButtonElement>(
      "button[aria-label='Scroll to bottom']",
    );
    expect(button).not.toBe(null);
    act(() => {
      button!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });
    expect(scrollCalls.some((call) => call.behavior === "smooth")).toBe(true);

    // Back near the bottom, automatic following resumes with instant scrolls.
    mockScrollLayout({ scrollHeight: 3000, clientHeight: 500, scrollTop: 2500 });
    scrollCalls = [];
    streamFrame(4);
    expect(scrollCalls.length).toBe(1);
    expect(scrollCalls[0]!.behavior).not.toBe("smooth");
  });
});
