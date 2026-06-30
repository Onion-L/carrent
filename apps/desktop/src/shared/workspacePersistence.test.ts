import { describe, expect, it } from "bun:test";
import { WORKSPACE_SNAPSHOT_VERSION, normalizeWorkspaceSnapshot } from "./workspacePersistence";

describe("normalizeWorkspaceSnapshot", () => {
  it("accepts a valid current snapshot", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      chats: [],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    expect(normalizeWorkspaceSnapshot(snapshot)).toEqual(snapshot);
  });

  it("accepts older snapshots without agents", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    expect(normalizeWorkspaceSnapshot(snapshot)).toEqual({ ...snapshot, chats: [] });
  });

  it("normalizes snapshots without chats as an empty list", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [],
      messages: [],
      activeThreadId: null,
      drafts: [],
    });

    expect(snapshot?.chats).toEqual([]);
  });

  it("rejects snapshots with invalid chats", () => {
    expect(
      normalizeWorkspaceSnapshot({
        version: 1,
        projects: [],
        chats: "bad",
        messages: [],
        activeThreadId: null,
        drafts: [],
      }),
    ).toBe(null);
  });

  it("rejects malformed snapshots", () => {
    expect(normalizeWorkspaceSnapshot({ version: 999 })).toBe(null);
    expect(normalizeWorkspaceSnapshot(null)).toBe(null);
  });

  it("accepts a valid snapshot with chats", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [],
      chats: [{ id: "c1", title: "Chat 1", updatedAt: "2024-01-01T00:00:00Z" }],
      messages: [],
      activeThreadId: null,
      drafts: [],
    };

    expect(normalizeWorkspaceSnapshot(snapshot)).toEqual({
      ...snapshot,
      chats: [{ ...snapshot.chats[0], runtimeId: "kimi", runtimeMode: "approval-required" }],
    });
  });

  it("normalizes legacy project threads without runtime mode", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [
        {
          id: "p1",
          name: "P1",
          path: "/tmp/p1",
          threads: [{ id: "t1", title: "Old", updatedAt: "now" }],
        },
      ],
      chats: [],
      messages: [],
      activeThreadId: null,
      drafts: [],
    });

    expect(snapshot?.projects[0].threads[0].runtimeId).toBe("kimi");
    expect(snapshot?.projects[0].threads[0].runtimeMode).toBe("approval-required");
  });

  it("normalizes legacy chats and drafts without runtime fields", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [],
      chats: [{ id: "c1", title: "Chat", updatedAt: "now" }],
      messages: [],
      activeThreadId: null,
      drafts: [
        {
          draftId: "d1",
          projectId: "p1",
          title: "Draft",
          preallocatedThreadId: "t1",
          createdAt: "now",
          messages: [],
        },
      ],
    });

    expect(snapshot?.chats[0].runtimeId).toBe("kimi");
    expect(snapshot?.chats[0].runtimeMode).toBe("approval-required");
    expect(snapshot?.drafts[0].runtimeId).toBe("kimi");
    expect(snapshot?.drafts[0].runtimeMode).toBe("approval-required");
  });

  it("preserves legacy runtime ids during normalization", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [
        {
          id: "p1",
          name: "P1",
          path: "/tmp/p1",
          threads: [{ id: "t1", title: "Old", updatedAt: "now", runtimeId: "codex" }],
        },
      ],
      chats: [{ id: "c1", title: "Chat", updatedAt: "now", runtimeId: "claude-code" }],
      messages: [],
      activeThreadId: null,
      drafts: [
        {
          draftId: "d1",
          projectId: "p1",
          title: "Draft",
          preallocatedThreadId: "t1",
          createdAt: "now",
          runtimeId: "pi",
          messages: [],
        },
      ],
    });

    expect(snapshot?.projects[0].threads[0].runtimeId).toBe("codex");
    expect(snapshot?.chats[0].runtimeId).toBe("claude-code");
    expect(snapshot?.drafts[0].runtimeId).toBe("pi");
  });

  it("normalizes invalid runtime ids to Kimi Code", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [
        {
          id: "p1",
          name: "P1",
          path: "/tmp/p1",
          threads: [{ id: "t1", title: "Old", updatedAt: "now", runtimeId: "bad" }],
        },
      ],
      chats: [{ id: "c1", title: "Chat", updatedAt: "now", runtimeId: "bad" }],
      messages: [],
      activeThreadId: null,
      drafts: [
        {
          draftId: "d1",
          projectId: "p1",
          title: "Draft",
          preallocatedThreadId: "t1",
          createdAt: "now",
          runtimeId: "bad",
          messages: [],
        },
      ],
    });

    expect(snapshot?.projects[0].threads[0].runtimeId).toBe("kimi");
    expect(snapshot?.chats[0].runtimeId).toBe("kimi");
    expect(snapshot?.drafts[0].runtimeId).toBe("kimi");
  });

  it("preserves valid runtime model ids for threads, chats, and drafts", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [
        {
          id: "p1",
          name: "P1",
          path: "/tmp/p1",
          threads: [
            { id: "t1", title: "Thread", updatedAt: "now", runtimeModelId: " gpt-5 " },
          ],
        },
      ],
      chats: [{ id: "c1", title: "Chat", updatedAt: "now", runtimeModelId: "gpt-5" }],
      messages: [],
      activeThreadId: null,
      drafts: [
        {
          draftId: "d1",
          projectId: "p1",
          title: "Draft",
          preallocatedThreadId: "t1",
          createdAt: "now",
          runtimeModelId: "gpt-5",
          messages: [],
        },
      ],
    });

    expect(snapshot?.projects[0].threads[0].runtimeModelId).toBe("gpt-5");
    expect(snapshot?.chats[0].runtimeModelId).toBe("gpt-5");
    expect(snapshot?.drafts[0].runtimeModelId).toBe("gpt-5");
  });

  it("drops invalid runtime model ids for threads, chats, and drafts", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [
        {
          id: "p1",
          name: "P1",
          path: "/tmp/p1",
          threads: [{ id: "t1", title: "Thread", updatedAt: "now", runtimeModelId: "   " }],
        },
      ],
      chats: [{ id: "c1", title: "Chat", updatedAt: "now", runtimeModelId: "" }],
      messages: [],
      activeThreadId: null,
      drafts: [
        {
          draftId: "d1",
          projectId: "p1",
          title: "Draft",
          preallocatedThreadId: "t1",
          createdAt: "now",
          runtimeModelId: "   ",
          messages: [],
        },
      ],
    });

    expect(snapshot?.projects[0].threads[0].runtimeModelId).toBeUndefined();
    expect(snapshot?.chats[0].runtimeModelId).toBeUndefined();
    expect(snapshot?.drafts[0].runtimeModelId).toBeUndefined();
  });
});
