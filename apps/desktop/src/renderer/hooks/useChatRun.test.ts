import { describe, expect, it } from "bun:test";

import type { ChatRunEvent } from "../../shared/chat";
import type { ChatPermissionRequest } from "../../shared/chatPermissions";
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

  it("tracks pending permission requests by thread", () => {
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {});
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "permission-requested",
      runId: "run-1",
      requestKey: "req-1",
      permission: {
        id: "perm-1",
        runId: "run-1",
        requestKey: "req-1",
        threadId: "thread-1",
        provider: "claude-code",
        action: "edit",
        title: "Edit demo.txt",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
      } satisfies ChatPermissionRequest,
    });

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingPermissions).toHaveLength(1);
    expect(snapshot.pendingPermissions[0].id).toBe("perm-1");
  });

  it("removes permission requests when resolved", () => {
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {});
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "permission-requested",
      runId: "run-1",
      requestKey: "req-1",
      permission: {
        id: "perm-1",
        runId: "run-1",
        requestKey: "req-1",
        threadId: "thread-1",
        provider: "claude-code",
        action: "edit",
        title: "Edit demo.txt",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
      } satisfies ChatPermissionRequest,
    });

    coordinator.handleEvent({
      type: "permission-resolved",
      runId: "run-1",
      requestKey: "req-1",
      permissionId: "perm-1",
      decision: "approved",
    });

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingPermissions).toHaveLength(0);
  });

  it("removes permission when permission-failed is received", () => {
    const received: string[] = [];
    const coordinator = createChatRunCoordinator();
    coordinator.beginRequest("req-1", "thread-1", {
      onError: (error) => received.push(error),
    });
    coordinator.attachRunId("req-1", "run-1");

    coordinator.handleEvent({
      type: "permission-requested",
      runId: "run-1",
      requestKey: "req-1",
      permission: {
        id: "perm-1",
        runId: "run-1",
        requestKey: "req-1",
        threadId: "thread-1",
        provider: "claude-code",
        action: "edit",
        title: "Edit demo.txt",
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-01T00:01:00.000Z",
      } satisfies ChatPermissionRequest,
    });

    coordinator.handleEvent({
      type: "permission-failed",
      runId: "run-1",
      requestKey: "req-1",
      permissionId: "perm-1",
      error: "Interactive approvals not supported",
    });

    const snapshot = coordinator.getSnapshot();
    expect(snapshot.pendingPermissions).toHaveLength(0);
    expect(snapshot.lastError).toContain("not supported");
    expect(snapshot.isSending).toBe(false);
    expect(received).toEqual(["Interactive approvals not supported"]);
  });
});
