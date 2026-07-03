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
          threads: [{ id: "t1", title: "Thread", updatedAt: "now", runtimeModelId: " gpt-5 " }],
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

  it("preserves image attachment metadata in messages", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "user",
          threadId: "t1",
          content: "Look at this",
          timestamp: "09:00",
          attachments: [
            {
              id: "a1",
              name: "screenshot.png",
              mimeType: "image/png",
              size: 1024,
              storageKey: "a1.png",
            },
          ],
        },
      ],
      activeThreadId: null,
      drafts: [],
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const userMessage = normalized!.messages[0] as { attachments?: unknown };
    expect(userMessage.attachments).toEqual(snapshot.messages[0].attachments);
  });

  it("strips runtime-only image attachment fields from persisted messages and drafts", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "user",
          threadId: "t1",
          content: "",
          timestamp: "09:00",
          attachments: [
            {
              id: "a1",
              name: "screenshot.png",
              mimeType: "image/png",
              size: 1024,
              storageKey: "a1.png",
              localPath: "/tmp/attachments/a1.png",
              base64: "raw",
            },
          ],
        },
      ],
      activeThreadId: null,
      drafts: [
        {
          draftId: "d1",
          projectId: "p1",
          title: "Draft",
          preallocatedThreadId: "t1",
          createdAt: "now",
          messages: [
            {
              id: "m2",
              role: "user",
              threadId: "t1",
              content: "",
              timestamp: "09:01",
              attachments: [
                {
                  id: "a2",
                  name: "draft.png",
                  mimeType: "image/png",
                  size: 2048,
                  storageKey: "a2.png",
                  localPath: "/tmp/attachments/a2.png",
                  dataUrl: "data:image/png;base64,raw",
                },
              ],
            },
          ],
        },
      ],
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const messageAttachment = (normalized!.messages[0] as { attachments?: unknown[] })
      .attachments![0] as Record<string, unknown>;
    const draftAttachment = (normalized!.drafts[0].messages[0] as { attachments?: unknown[] })
      .attachments![0] as Record<string, unknown>;

    expect(messageAttachment).toEqual({
      id: "a1",
      name: "screenshot.png",
      mimeType: "image/png",
      size: 1024,
      storageKey: "a1.png",
    });
    expect(draftAttachment).toEqual({
      id: "a2",
      name: "draft.png",
      mimeType: "image/png",
      size: 2048,
      storageKey: "a2.png",
    });
  });
});
