import { describe, it, expect } from "bun:test";
import {
  filterProjectThreads,
  getAttentionGroups,
  getThreadActivityTime,
  getThreadDisplayStatus,
  splitProjectThreads,
} from "./projectThreads";
import type { Message, ThreadRecord } from "../mock/uiShellData";

function makeThread(overrides: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id: "t",
    title: "Thread",
    updatedAt: "1h ago",
    ...overrides,
  };
}

describe("splitProjectThreads", () => {
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

  it("sorts pinned threads ahead of regular threads", () => {
    const threads = [
      makeThread({ id: "a", title: "Regular A" }),
      makeThread({ id: "b", title: "Pinned B", pinned: true }),
      makeThread({ id: "c", title: "Regular C" }),
      makeThread({ id: "d", title: "Pinned D", pinned: true }),
    ];

    const { active } = splitProjectThreads(threads);
    expect(active.map((t) => t.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("keeps original order within pinned and regular groups", () => {
    const threads = [
      makeThread({ id: "p2", title: "Pinned 2", pinned: true }),
      makeThread({ id: "r1", title: "Regular 1" }),
      makeThread({ id: "p1", title: "Pinned 1", pinned: true }),
      makeThread({ id: "r2", title: "Regular 2" }),
    ];

    const { active } = splitProjectThreads(threads);
    expect(active.map((t) => t.id)).toEqual(["p2", "p1", "r1", "r2"]);
  });

  it("sorts each pin group by activity time", () => {
    const threads = [
      makeThread({ id: "old-pinned", pinned: true, lastActivityAt: "2026-01-01T00:00:00Z" }),
      makeThread({ id: "new-regular", lastActivityAt: "2026-04-01T00:00:00Z" }),
      makeThread({ id: "new-pinned", pinned: true, lastActivityAt: "2026-03-01T00:00:00Z" }),
      makeThread({ id: "old-regular", lastActivityAt: "2026-02-01T00:00:00Z" }),
    ];

    expect(splitProjectThreads(threads).active.map((thread) => thread.id)).toEqual([
      "new-pinned",
      "old-pinned",
      "new-regular",
      "old-regular",
    ]);
  });

  it("resolves activity from persisted value, messages, then legacy updatedAt", () => {
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
          updatedAt: "2026-01-01T00:00:00Z",
          lastActivityAt: "2026-03-01T00:00:00Z",
        }),
        [message],
      ),
    ).toBe(Date.parse("2026-03-01T00:00:00Z"));
    expect(
      getThreadActivityTime(makeThread({ id: "thread-1", updatedAt: "2026-01-01T00:00:00Z" }), [
        message,
      ]),
    ).toBe(message.createdAt);
    expect(
      getThreadActivityTime(makeThread({ id: "thread-1", updatedAt: "2026-01-01T00:00:00Z" }), []),
    ).toBe(Date.parse("2026-01-01T00:00:00Z"));
    expect(getThreadActivityTime(makeThread({ updatedAt: "unknown" }), [])).toBe(null);
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
