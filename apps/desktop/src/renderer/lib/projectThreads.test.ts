import { describe, it, expect } from "bun:test";
import {
  filterProjectThreads,
  getThreadActivityTime,
  getThreadDisplayStatus,
  getProjectThreads,
} from "./projectThreads";
import type { Message } from "../../shared/threadContent";
import type { AppThreadRecord } from "../../shared/workspacePersistence";

function makeThread(overrides: Partial<AppThreadRecord> = {}): AppThreadRecord {
  return {
    id: "t",
    workspaceId: "workspace-1",
    projectId: "project-1",
    title: "Thread",
    createdAt: "2026-01-01T00:00:00Z",
    lastActivityAt: "2026-01-01T00:00:00Z",
    providerProfileId: "default",
    agentMode: "ask",
    ...overrides,
  };
}

describe("project Threads", () => {
  it("sorts pinned Threads first and each group by Thread Activity Time", () => {
    const threads = [
      makeThread({
        id: "a",
        title: "Regular A",
        lastActivityAt: "2026-04-01T00:00:00Z",
      }),
      makeThread({
        id: "b",
        title: "Pinned B",
        lastActivityAt: "2026-02-01T00:00:00Z",
        pinned: true,
      }),
      makeThread({
        id: "c",
        title: "Regular C",
        lastActivityAt: "2026-03-01T00:00:00Z",
      }),
      makeThread({
        id: "d",
        title: "Pinned D",
        lastActivityAt: "2026-01-01T00:00:00Z",
        pinned: true,
      }),
    ];

    expect(getProjectThreads(threads).map((thread) => thread.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("resolves activity from persisted Thread Activity Time", () => {
    const message = {
      id: "message-1",
      role: "user",
      threadId: "thread-1",
      content: "hello",
      timestamp: "09:00",
      createdAt: Date.parse("2026-02-01T00:00:00Z"),
    } satisfies Message;

    expect(
      getThreadActivityTime(
        makeThread({
          id: "thread-1",
          lastActivityAt: "2026-03-01T00:00:00Z",
        }),
        [message],
      ),
    ).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(
      getThreadActivityTime(
        makeThread({ id: "thread-1", lastActivityAt: "2026-01-01T00:00:00Z" }),
        [message],
      ),
    ).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(
      getThreadActivityTime(
        makeThread({ id: "thread-1", lastActivityAt: "2026-01-01T00:00:00Z" }),
        [],
      ),
    ).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(getThreadActivityTime(makeThread({ lastActivityAt: "unknown" }), [])).toBe(null);
  });

  it("filters titles case-insensitively after trimming the query", () => {
    const threads = [
      makeThread({ id: "a", title: "Fix Sidebar" }),
      makeThread({ id: "b", title: "Provider setup" }),
    ];

    expect(filterProjectThreads(threads, "  sidebar ").map((thread) => thread.id)).toEqual(["a"]);
  });

  it("prioritizes approval over running and running over persisted failure", () => {
    const failedMessage = {
      id: "message-1",
      role: "assistant",
      threadId: "thread-1",
      content: "Error",
      timestamp: "09:00",
      runStatus: "failed",
    } satisfies Message;

    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: ["thread-1"],
        pendingApprovals: [{ threadId: "thread-1" }],
        pendingQuestions: [],
        messages: [failedMessage],
      }),
    ).toBe("approval");
    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: ["thread-1"],
        pendingApprovals: [],
        pendingQuestions: [],
        messages: [failedMessage],
      }),
    ).toBe("running");
    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: [],
        pendingApprovals: [],
        pendingQuestions: [],
        messages: [failedMessage],
      }),
    ).toBe("failed");
  });

  it("shows a waiting question with the same blocking precedence as approval", () => {
    const failedMessage = {
      id: "message-1",
      role: "assistant",
      threadId: "thread-1",
      content: "Error",
      timestamp: "09:00",
      runStatus: "failed",
    } satisfies Message;

    // A pending question outranks a live run and a persisted failure.
    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: ["thread-1"],
        pendingApprovals: [],
        pendingQuestions: [{ threadId: "thread-1" }],
        messages: [failedMessage],
      }),
    ).toBe("question");
    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: [],
        pendingApprovals: [],
        pendingQuestions: [{ threadId: "thread-1" }],
        messages: [failedMessage],
      }),
    ).toBe("question");
    // Approval and question share the blocking tier; approval wins ties.
    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: ["thread-1"],
        pendingApprovals: [{ threadId: "thread-1" }],
        pendingQuestions: [{ threadId: "thread-1" }],
        messages: [failedMessage],
      }),
    ).toBe("approval");
    // A question owned by another thread does not leak into this one.
    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: ["thread-1"],
        pendingApprovals: [],
        pendingQuestions: [{ threadId: "thread-2" }],
        messages: [failedMessage],
      }),
    ).toBe("running");
  });

  it("clears failed display state when a newer assistant run succeeds", () => {
    const messages = [
      {
        id: "failed",
        role: "assistant",
        threadId: "thread-1",
        content: "Error",
        timestamp: "09:00",
        runStatus: "failed",
      },
      {
        id: "completed",
        role: "assistant",
        threadId: "thread-1",
        content: "Done",
        timestamp: "09:01",
        runStatus: "completed",
      },
    ] satisfies Message[];

    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: [],
        pendingApprovals: [],
        pendingQuestions: [],
        messages,
      }),
    ).toBe(null);
  });

  it("does not restore stale running state after restart", () => {
    const messages = [
      {
        id: "running",
        role: "assistant",
        threadId: "thread-1",
        content: "",
        timestamp: "09:00",
        runStatus: "running",
      },
    ] satisfies Message[];

    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: [],
        pendingApprovals: [],
        pendingQuestions: [],
        messages,
      }),
    ).toBe(null);
  });
});
