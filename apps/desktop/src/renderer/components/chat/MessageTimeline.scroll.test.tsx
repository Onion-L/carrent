import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import type { Message } from "../../../shared/threadContent";
import { MessageTimeline } from "./MessageTimeline";

function userMessage(id: string, content: string): Message {
  return {
    id,
    threadId: "thread-1",
    role: "user",
    type: "text",
    content,
    timestamp: "09:00",
    createdAt: 1000,
  };
}

function assistantMessage(id: string, content: string): Message {
  return {
    id,
    threadId: "thread-1",
    role: "assistant",
    type: "text",
    content,
    timestamp: "09:00",
    createdAt: 1000,
  };
}

type ScrollCall = { top?: number; behavior?: string };

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let scrollCalls: ScrollCall[] = [];
const originalScrollTo = Element.prototype.scrollTo;

let realRequestAnimationFrame: typeof window.requestAnimationFrame | null = null;
let realCancelAnimationFrame: typeof window.cancelAnimationFrame | null = null;
let frameCallbacks = new Map<number, FrameRequestCallback>();

function stubAnimationFrames() {
  realRequestAnimationFrame = window.requestAnimationFrame;
  realCancelAnimationFrame = window.cancelAnimationFrame;
  frameCallbacks = new Map();
  let nextId = 1;
  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextId;
    nextId += 1;
    frameCallbacks.set(id, callback);
    return id;
  }) as typeof window.requestAnimationFrame;
  window.cancelAnimationFrame = ((id: number) => {
    frameCallbacks.delete(id);
  }) as typeof window.cancelAnimationFrame;
}

function restoreAnimationFrames() {
  if (realRequestAnimationFrame) {
    window.requestAnimationFrame = realRequestAnimationFrame;
    realRequestAnimationFrame = null;
  }
  if (realCancelAnimationFrame) {
    window.cancelAnimationFrame = realCancelAnimationFrame;
    realCancelAnimationFrame = null;
  }
  frameCallbacks = new Map();
}

function runAnimationFrame() {
  const callbacks = [...frameCallbacks.values()];
  frameCallbacks.clear();
  act(() => {
    callbacks.forEach((callback) => callback(0));
  });
}

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

function renderTimeline(messages: Message[], threadId: string) {
  if (!container) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => {
    root!.render(
      <MemoryRouter>
        <MessageTimeline messages={messages} threadId={threadId} />
      </MemoryRouter>,
    );
  });
}

function instantScrollCalls() {
  return scrollCalls.filter((call) => call.behavior !== "smooth");
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  scrollCalls = [];
  Element.prototype.scrollTo = originalScrollTo;
  restoreAnimationFrames();
});

describe("MessageTimeline initial scroll", () => {
  it("jumps straight to the latest message when a thread is opened", () => {
    stubScrollTo();

    renderTimeline([userMessage("m1", "hello"), userMessage("m2", "latest")], "thread-1");

    expect(instantScrollCalls()).toHaveLength(1);
  });

  it("jumps again when switching to a different thread", () => {
    stubScrollTo();

    renderTimeline([userMessage("m1", "hello")], "thread-1");
    renderTimeline([userMessage("m2", "other thread")], "thread-2");

    expect(instantScrollCalls()).toHaveLength(2);
  });

  it("does not re-jump for assistant updates in the same thread", () => {
    stubScrollTo();

    renderTimeline([userMessage("m1", "hello")], "thread-1");
    renderTimeline([userMessage("m1", "hello"), assistantMessage("m2", "streamed")], "thread-1");

    expect(instantScrollCalls()).toHaveLength(1);
  });

  it("jumps to a new user message in the current thread", () => {
    stubScrollTo();

    renderTimeline([userMessage("m1", "hello")], "thread-1");
    renderTimeline([userMessage("m1", "hello"), userMessage("m2", "follow-up")], "thread-1");

    expect(instantScrollCalls()).toHaveLength(2);
  });
});

describe("MessageTimeline streaming follow", () => {
  it("follows consecutive streaming updates with one instant scroll per frame", () => {
    stubScrollTo();
    stubAnimationFrames();

    renderTimeline([userMessage("m1", "hello")], "thread-1");
    mockScrollLayout({ scrollHeight: 1000, clientHeight: 500, scrollTop: 500 });
    scrollCalls = [];

    renderTimeline(
      [userMessage("m1", "hello"), assistantMessage("a1", "streamed part one")],
      "thread-1",
    );
    renderTimeline(
      [userMessage("m1", "hello"), assistantMessage("a1", "streamed part one two")],
      "thread-1",
    );
    renderTimeline(
      [userMessage("m1", "hello"), assistantMessage("a1", "streamed part one two three")],
      "thread-1",
    );

    // Three updates before one frame produce a single scheduled follow.
    expect(frameCallbacks.size).toBe(1);
    expect(scrollCalls).toHaveLength(0);

    runAnimationFrame();
    expect(scrollCalls).toHaveLength(1);
    expect(scrollCalls[0]!.behavior).not.toBe("smooth");

    renderTimeline(
      [userMessage("m1", "hello"), assistantMessage("a1", "streamed part one two three four")],
      "thread-1",
    );
    runAnimationFrame();
    expect(scrollCalls).toHaveLength(2);
    expect(scrollCalls.every((call) => call.behavior !== "smooth")).toBe(true);
  });

  it("stays put when the user scrolled up to read history", () => {
    stubScrollTo();
    stubAnimationFrames();

    renderTimeline([userMessage("m1", "hello")], "thread-1");
    // 900px above the bottom: outside the near-bottom threshold.
    mockScrollLayout({ scrollHeight: 2000, clientHeight: 500, scrollTop: 600 });
    scrollCalls = [];
    frameCallbacks.clear();

    renderTimeline(
      [userMessage("m1", "hello"), assistantMessage("a1", "streamed while reading")],
      "thread-1",
    );
    runAnimationFrame();

    expect(scrollCalls).toHaveLength(0);
  });

  it("keeps smooth scrolling for the explicit return-to-bottom button", () => {
    stubScrollTo();
    stubAnimationFrames();

    renderTimeline([userMessage("m1", "hello")], "thread-1");
    mockScrollLayout({ scrollHeight: 2000, clientHeight: 500, scrollTop: 600 });
    act(() => {
      scrollContainer().dispatchEvent(new window.Event("scroll"));
    });
    scrollCalls = [];

    const button = container!.querySelector<HTMLButtonElement>(
      "button[aria-label='Scroll to bottom']",
    );
    expect(button).not.toBe(null);
    act(() => {
      button!.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    });

    expect(scrollCalls.some((call) => call.behavior === "smooth")).toBe(true);
  });

  it("cancels a scheduled follow when the timeline unmounts", () => {
    stubScrollTo();
    stubAnimationFrames();

    renderTimeline([userMessage("m1", "hello")], "thread-1");
    expect(frameCallbacks.size).toBeGreaterThan(0);
    scrollCalls = [];

    act(() => root!.unmount());
    root = null;

    expect(frameCallbacks.size).toBe(0);
    runAnimationFrame();
    expect(scrollCalls).toHaveLength(0);
  });
});
