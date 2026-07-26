import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";

import type { Message } from "../../mock/uiShellData";
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

type ScrollCall = { top?: number; behavior?: string };

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let scrollCalls: ScrollCall[] = [];
const originalScrollTo = Element.prototype.scrollTo;

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
});

describe("MessageTimeline initial scroll", () => {
  it("jumps straight to the latest message when a thread is opened", () => {
    Element.prototype.scrollTo = function (options?: ScrollToOptions) {
      scrollCalls.push(options ?? {});
    } as typeof Element.prototype.scrollTo;

    renderTimeline([userMessage("m1", "hello"), userMessage("m2", "latest")], "thread-1");

    expect(instantScrollCalls()).toHaveLength(1);
  });

  it("jumps again when switching to a different thread", () => {
    Element.prototype.scrollTo = function (options?: ScrollToOptions) {
      scrollCalls.push(options ?? {});
    } as typeof Element.prototype.scrollTo;

    renderTimeline([userMessage("m1", "hello")], "thread-1");
    renderTimeline([userMessage("m2", "other thread")], "thread-2");

    expect(instantScrollCalls()).toHaveLength(2);
  });

  it("does not re-jump for new messages in the same thread", () => {
    Element.prototype.scrollTo = function (options?: ScrollToOptions) {
      scrollCalls.push(options ?? {});
    } as typeof Element.prototype.scrollTo;

    renderTimeline([userMessage("m1", "hello")], "thread-1");
    renderTimeline([userMessage("m1", "hello"), userMessage("m2", "streamed")], "thread-1");

    expect(instantScrollCalls()).toHaveLength(1);
  });
});
