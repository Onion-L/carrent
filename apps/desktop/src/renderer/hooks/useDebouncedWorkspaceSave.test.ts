import { describe, expect, it } from "bun:test";
import {
  buildWorkspaceSnapshot,
  shouldPersistWorkspaceSnapshot,
} from "./useDebouncedWorkspaceSave";

describe("buildWorkspaceSnapshot", () => {
  it("returns a valid snapshot with version 1", () => {
    const snapshot = buildWorkspaceSnapshot({
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: null,
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.projects).toEqual([]);
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.activeThreadId).toBe(null);
  });

  it("includes projects, messages, and activeThreadId", () => {
    const snapshot = buildWorkspaceSnapshot({
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "user",
          threadId: "t1",
          content: "hi",
          timestamp: "09:00",
        },
      ],
      activeThreadId: "t1",
    });

    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.activeThreadId).toBe("t1");
  });

  it("includes Thread Work-in-Progress when provided", () => {
    const threadWork = {
      t1: {
        draft: { content: "draft", attachedSkillNames: ["pdf"], attachments: [] },
        queuedMessages: [{ id: "q1", content: "queued", requiresConfirmation: true }],
      },
    };

    const snapshot = buildWorkspaceSnapshot({
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: "t1",
      threadWork,
    });

    expect(snapshot.threadWork).toEqual(threadWork);
  });

  it("omits Thread Work-in-Progress when not provided", () => {
    const snapshot = buildWorkspaceSnapshot({
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: null,
    });

    expect("threadWork" in snapshot).toBe(false);
  });
});

describe("shouldPersistWorkspaceSnapshot", () => {
  it("returns false before hydration", () => {
    expect(shouldPersistWorkspaceSnapshot(true, false)).toBe(false);
  });

  it("returns true after hydration", () => {
    expect(shouldPersistWorkspaceSnapshot(true, true)).toBe(true);
  });

  it("returns false when saving is disabled", () => {
    expect(shouldPersistWorkspaceSnapshot(false, true)).toBe(false);
  });
});
