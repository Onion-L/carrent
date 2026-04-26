import { describe, expect, it } from "bun:test";

import type { ChatRunEvent } from "../../shared/chat";
import { createChatRunCoordinator } from "./useChatRun";

describe("createChatRunCoordinator", () => {
  it("delivers events that arrive before chat.send resolves", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {
      onDelta: (text) => received.push(`delta:${text}`),
      onComplete: (text) => received.push(`done:${text}`),
    });

    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-1",
      runId: "run-1",
      text: "hello",
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "completed",
      requestKey: "request-1",
      runId: "run-1",
      text: "hello",
      finishedAt: "2026-04-25T00:00:00.000Z",
    } satisfies ChatRunEvent);

    expect(received).toEqual(["delta:hello", "done:hello"]);
    expect(coordinator.getSnapshot().isSending).toBe(false);
  });

  it("ignores events from a different request", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {
      onDelta: (text) => received.push(text),
    });

    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-2",
      runId: "run-2",
      text: "wrong",
    } satisfies ChatRunEvent);

    expect(received).toEqual([]);
    expect(coordinator.getSnapshot().isSending).toBe(true);
  });

  it("keeps independent requests for different threads", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    expect(
      coordinator.beginRequest("request-1", "thread-1", {
        onDelta: (text) => received.push(`first:${text}`),
      }),
    ).toBe(true);
    expect(
      coordinator.beginRequest("request-2", "thread-2", {
        onDelta: (text) => received.push(`second:${text}`),
      }),
    ).toBe(true);

    expect(coordinator.getSnapshot().runningThreadIds).toEqual(["thread-1", "thread-2"]);

    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-1",
      runId: "run-1",
      text: "still active",
    } satisfies ChatRunEvent);
    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-2",
      runId: "run-2",
      text: "also active",
    } satisfies ChatRunEvent);

    expect(received).toEqual(["first:still active", "second:also active"]);
  });

  it("does not replace an active request in the same thread", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    expect(
      coordinator.beginRequest("request-1", "thread-1", {
        onDelta: (text) => received.push(`first:${text}`),
      }),
    ).toBe(true);
    expect(
      coordinator.beginRequest("request-2", "thread-1", {
        onDelta: (text) => received.push(`second:${text}`),
      }),
    ).toBe(false);

    expect(coordinator.getSnapshot().runningThreadIds).toEqual(["thread-1"]);

    coordinator.handleEvent({
      type: "delta",
      requestKey: "request-1",
      runId: "run-1",
      text: "still active",
    } satisfies ChatRunEvent);

    expect(received).toEqual(["first:still active"]);
  });

  it("stops the run for the requested thread only", () => {
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {});
    coordinator.beginRequest("request-2", "thread-2", {});
    coordinator.attachRunId("request-1", "run-1");
    coordinator.attachRunId("request-2", "run-2");

    expect(coordinator.getPendingRunId("thread-2")).toBe("run-2");
    expect(coordinator.getPendingRunId("thread-1")).toBe("run-1");
  });

  it("keeps other thread runs active when one thread completes", () => {
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {});
    coordinator.beginRequest("request-2", "thread-2", {});

    coordinator.handleEvent({
      type: "completed",
      requestKey: "request-1",
      runId: "run-1",
      text: "done",
      finishedAt: "2026-04-25T00:00:00.000Z",
    } satisfies ChatRunEvent);

    expect(coordinator.getSnapshot().isSending).toBe(true);
    expect(coordinator.getSnapshot().runningThreadIds).toEqual(["thread-2"]);
  });

  it("routes shell events to the active request callback", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();

    coordinator.beginRequest("request-1", "thread-1", {
      onShell: (shell) => received.push(`${shell.status}:${shell.command}`),
    });

    coordinator.handleEvent({
      type: "shell",
      requestKey: "request-1",
      runId: "run-1",
      shell: {
        id: "shell-1",
        command: "pwd",
        output: "",
        status: "running",
      },
    } satisfies ChatRunEvent);

    expect(received).toEqual(["running:pwd"]);
  });

  it("routes reasoning events to the active request callback", () => {
    const coordinator = createChatRunCoordinator();
    const received: string[] = [];

    coordinator.beginRequest("request-1", "thread-1", {
      onReasoning: (reasoning) => received.push(`${reasoning.status}:${reasoning.content}`),
    });

    coordinator.handleEvent({
      type: "reasoning",
      runId: "run-1",
      requestKey: "request-1",
      reasoning: {
        id: "reasoning-1",
        content: "Need to inspect files",
        status: "running",
      },
    } satisfies ChatRunEvent);

    expect(received).toEqual(["running:Need to inspect files"]);
  });
});
