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
      drafts: [],
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.projects).toEqual([]);
    expect(snapshot.messages).toEqual([]);
    expect(snapshot.activeThreadId).toBe(null);
    expect(snapshot.drafts).toEqual([]);
  });

  it("includes projects, messages, activeThreadId and drafts", () => {
    const snapshot = buildWorkspaceSnapshot({
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "user",
          agentId: "a1",
          threadId: "t1",
          content: "hi",
          timestamp: "09:00",
        },
      ],
      activeThreadId: "t1",
      drafts: [],
    });

    expect(snapshot.projects).toHaveLength(1);
    expect(snapshot.messages).toHaveLength(1);
    expect(snapshot.activeThreadId).toBe("t1");
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
