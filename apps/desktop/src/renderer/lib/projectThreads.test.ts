import { describe, it, expect } from "bun:test";
import {
  filterProjectThreads,
  getAttentionGroups,
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
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    planMode: false,
    ...overrides,
  };
}

describe("project Threads", () => {
  it("groups attention Threads by intervention priority and activity", () => {
    const threads = [
      makeThread({ id: "approval-old", lastActivityAt: "2026-01-01T00:00:00Z" }),
      makeThread({ id: "failed-new", lastActivityAt: "2026-06-01T00:00:00Z" }),
      makeThread({ id: "question", lastActivityAt: "2026-05-01T00:00:00Z" }),
      makeThread({ id: "approval-new", lastActivityAt: "2026-04-01T00:00:00Z" }),
      makeThread({ id: "running", lastActivityAt: "2026-07-01T00:00:00Z" }),
      makeThread({ id: "failed-old", lastActivityAt: "2026-02-01T00:00:00Z" }),
    ];
    const failedMessages = ["failed-new", "failed-old"].map(
      (threadId) =>
        ({
          id: `message-${threadId}`,
          role: "assistant",
          threadId,
          content: "Error",
          timestamp: "09:00",
          runStatus: "failed",
        }) satisfies Message,
    );

    const groups = getAttentionGroups({
      threads,
      runningThreadIds: ["approval-old", "approval-new", "question", "running"],
      pendingApprovals: [{ threadId: "approval-old" }, { threadId: "approval-new" }],
      pendingQuestions: [{ threadId: "question" }],
      messages: failedMessages,
    });

    expect(groups.map((group) => group.status)).toEqual(["approval", "question", "failed"]);
    expect(groups.map((group) => group.threads.map((thread) => thread.id))).toEqual([
      ["approval-new", "approval-old"],
      ["question"],
      ["failed-new", "failed-old"],
    ]);
  });

  it("keeps the persisted order", () => {
    const threads = [
      makeThread({ id: "a", title: "Regular A" }),
      makeThread({ id: "b", title: "Pinned B", pinned: true }),
      makeThread({ id: "c", title: "Regular C" }),
      makeThread({ id: "d", title: "Pinned D", pinned: true }),
    ];

    expect(getProjectThreads(threads).map((thread) => thread.id)).toEqual(["a", "b", "c", "d"]);
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
      makeThread({ id: "b", title: "Runtime setup" }),
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

  it("shows a waiting question with the same attention precedence as approval", () => {
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
    // Approval and question share the attention tier; approval wins ties.
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
