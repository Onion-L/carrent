import { describe, it, expect } from "bun:test";
import {
  filterProjectThreads,
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
        messages: [failedMessage],
      }),
    ).toBe("approval");
    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: ["thread-1"],
        pendingApprovals: [],
        messages: [failedMessage],
      }),
    ).toBe("running");
    expect(
      getThreadDisplayStatus({
        threadId: "thread-1",
        runningThreadIds: [],
        pendingApprovals: [],
        messages: [failedMessage],
      }),
    ).toBe("failed");
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
        messages,
      }),
    ).toBe(null);
  });
});
