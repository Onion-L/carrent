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
    };

    expect(normalizeWorkspaceSnapshot(snapshot)).toEqual(snapshot);
  });

  it("accepts older snapshots without agents", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      messages: [],
      activeThreadId: null,
    };

    expect(normalizeWorkspaceSnapshot(snapshot)).toEqual({ ...snapshot, chats: [] });
  });

  it("normalizes snapshots without chats as an empty list", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [],
      messages: [],
      activeThreadId: null,
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
    };

    expect(normalizeWorkspaceSnapshot(snapshot)).toEqual({
      ...snapshot,
      chats: [
        {
          ...snapshot.chats[0],
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
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
    });

    expect(snapshot?.projects[0].threads[0].runtimeId).toBe("kimi");
    expect(snapshot?.projects[0].threads[0].runtimeMode).toBe("approval-required");
  });

  it("preserves valid thread activity timestamps and drops invalid values", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [
        {
          id: "p1",
          name: "P1",
          path: "/tmp/p1",
          threads: [
            {
              id: "valid",
              title: "Valid",
              updatedAt: "now",
              lastActivityAt: "2026-05-01T00:00:00Z",
            },
            {
              id: "invalid",
              title: "Invalid",
              updatedAt: "now",
              lastActivityAt: "recently",
            },
          ],
        },
      ],
      chats: [],
      messages: [],
      activeThreadId: null,
    });

    expect(snapshot?.projects[0].threads[0].lastActivityAt).toBe("2026-05-01T00:00:00Z");
    expect(snapshot?.projects[0].threads[1].lastActivityAt).toBeUndefined();
  });

  it("normalizes legacy chats without runtime fields", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [],
      chats: [{ id: "c1", title: "Chat", updatedAt: "now" }],
      messages: [],
      activeThreadId: null,
    });

    expect(snapshot?.chats[0].runtimeId).toBe("kimi");
    expect(snapshot?.chats[0].runtimeMode).toBe("approval-required");
    expect(snapshot?.chats[0].planMode).toBe(false);
  });

  it("preserves enabled Plan mode for project threads and chats", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [
        {
          id: "p1",
          name: "P1",
          path: "/tmp/p1",
          threads: [{ id: "t1", title: "Thread", updatedAt: "now", planMode: true }],
        },
      ],
      chats: [{ id: "c1", title: "Chat", updatedAt: "now", planMode: true }],
      messages: [],
      activeThreadId: null,
    });

    expect(snapshot?.projects[0].threads[0].planMode).toBe(true);
    expect(snapshot?.chats[0].planMode).toBe(true);
  });

  it("restores pending Plan Reviews as interrupted", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "assistant",
          threadId: "t1",
          timestamp: "09:00",
          content: "",
          parts: [
            {
              type: "plan_review",
              id: "review-1",
              permissionId: "permission-1",
              content: "# Plan\n\n- Implement",
              status: "pending",
              options: [
                { optionId: "plan_approve", name: "Approve", kind: "allow_once" },
                { optionId: "plan_revise", name: "Revise", kind: "reject_once" },
              ],
            },
          ],
        },
      ],
      activeThreadId: null,
    });

    expect(snapshot?.messages[0]).toMatchObject({
      parts: [{ type: "plan_review", status: "interrupted" }],
    });
  });

  it("drops malformed Plan Reviews without dropping the message", () => {
    const snapshot = normalizeWorkspaceSnapshot({
      version: 1,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "assistant",
          threadId: "t1",
          timestamp: "09:00",
          content: "Answer",
          parts: [
            { type: "text", content: "Answer" },
            {
              type: "plan_review",
              id: "review-1",
              permissionId: "permission-1",
              content: "# Plan",
              status: "pending",
              options: [{ optionId: "bad", name: "Bad", kind: "unsupported" }],
            },
          ],
        },
      ],
      activeThreadId: null,
    });

    expect(snapshot?.messages[0]).toMatchObject({
      content: "Answer",
      parts: [{ type: "text", content: "Answer" }],
    });
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
    });

    expect(snapshot?.projects[0].threads[0].runtimeId).toBe("codex");
    expect(snapshot?.chats[0].runtimeId).toBe("claude-code");
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
    });

    expect(snapshot?.projects[0].threads[0].runtimeId).toBe("kimi");
    expect(snapshot?.chats[0].runtimeId).toBe("kimi");
  });

  it("preserves valid runtime model ids for threads and chats", () => {
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
    });

    expect(snapshot?.projects[0].threads[0].runtimeModelId).toBe("gpt-5");
    expect(snapshot?.chats[0].runtimeModelId).toBe("gpt-5");
  });

  it("drops invalid runtime model ids for threads and chats", () => {
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
    });

    expect(snapshot?.projects[0].threads[0].runtimeModelId).toBeUndefined();
    expect(snapshot?.chats[0].runtimeModelId).toBeUndefined();
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
              kind: "image",
              name: "screenshot.png",
              mimeType: "image/png",
              size: 1024,
              storageKey: "a1.png",
            },
          ],
        },
      ],
      activeThreadId: null,
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const userMessage = normalized!.messages[0] as { attachments?: unknown };
    expect(userMessage.attachments).toEqual(snapshot.messages[0].attachments);
  });

  it("round-trips mixed image and file attachment metadata", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "user",
          threadId: "t1",
          content: "Look at these",
          timestamp: "09:00",
          attachments: [
            {
              id: "a1",
              kind: "image",
              name: "screenshot.png",
              mimeType: "image/png",
              size: 1024,
              storageKey: "a1.png",
            },
            {
              id: "a2",
              kind: "file",
              name: "main.ts",
              mimeType: "text/plain",
              size: 512,
              storageKey: "a2.ts",
            },
          ],
        },
      ],
      activeThreadId: null,
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const userMessage = normalized!.messages[0] as { attachments?: unknown };
    expect(userMessage.attachments).toEqual(snapshot.messages[0].attachments);
  });

  it("backfills kind image for legacy image records without kind", () => {
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
            },
          ],
        },
      ],
      activeThreadId: null,
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const userMessage = normalized!.messages[0] as { attachments?: unknown[] };
    expect(userMessage.attachments).toEqual([
      {
        id: "a1",
        kind: "image",
        name: "screenshot.png",
        mimeType: "image/png",
        size: 1024,
        storageKey: "a1.png",
      },
    ]);
  });

  it("discards legacy non-image records without kind instead of guessing", () => {
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
              id: "a2",
              name: "main.ts",
              mimeType: "text/plain",
              size: 512,
              storageKey: "a2.ts",
            },
          ],
        },
      ],
      activeThreadId: null,
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const userMessage = normalized!.messages[0] as { attachments?: unknown[] };
    expect(userMessage.attachments).toEqual([]);
  });

  it("accepts a changed_files message with a valid snapshot", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "assistant",
          threadId: "t1",
          timestamp: "09:00",
          type: "changed_files",
          content: "Workspace changes",
          changedFiles: [
            { path: "a.txt", additions: 1, deletions: 0, binary: false, untracked: false },
          ],
          snapshot: {
            baseRevision: "abc123",
            capturedAt: "2024-01-01T00:00:00.000Z",
            patch: "diff --git a/a.txt b/a.txt",
            truncated: false,
          },
        },
      ],
      activeThreadId: null,
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const message = normalized!.messages[0] as { snapshot?: unknown; changedFiles?: unknown[] };
    expect(message.snapshot).toEqual(snapshot.messages[0].snapshot);
    expect(message.changedFiles).toEqual(snapshot.messages[0].changedFiles);
  });

  it("accepts a legacy changed_files message without a snapshot", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "assistant",
          threadId: "t1",
          timestamp: "09:00",
          type: "changed_files",
          content: "Changed files",
          changedFiles: [{ path: "a.txt", additions: 1, deletions: 0 }],
        },
      ],
      activeThreadId: null,
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const message = normalized!.messages[0] as { snapshot?: unknown; changedFiles?: unknown[] };
    expect(message.snapshot).toBeUndefined();
    expect(message.changedFiles).toEqual([
      { path: "a.txt", additions: 1, deletions: 0, binary: false, untracked: false },
    ]);
  });

  it("drops malformed changed_files fields and keeps the message", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "assistant",
          threadId: "t1",
          timestamp: "09:00",
          type: "changed_files",
          changedFiles: [
            { path: "valid.txt", additions: 1, deletions: 0, binary: false, untracked: false },
            { path: "invalid" },
            "not-a-file",
          ],
          snapshot: {
            baseRevision: "abc123",
            capturedAt: "2024-01-01T00:00:00.000Z",
            patch: "diff",
            truncated: "not-a-boolean",
          },
        },
      ],
      activeThreadId: null,
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const message = normalized!.messages[0] as { snapshot?: unknown; changedFiles?: unknown[] };
    expect(message.snapshot).toBeUndefined();
    expect(message.changedFiles).toEqual([
      { path: "valid.txt", additions: 1, deletions: 0, binary: false, untracked: false },
    ]);
  });

  it("drops an oversized persisted patch", () => {
    const snapshot = {
      version: WORKSPACE_SNAPSHOT_VERSION,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "assistant",
          threadId: "t1",
          timestamp: "09:00",
          type: "changed_files",
          changedFiles: [
            { path: "a.txt", additions: 1, deletions: 0, binary: false, untracked: false },
          ],
          snapshot: {
            baseRevision: "abc123",
            capturedAt: "2024-01-01T00:00:00.000Z",
            patch: "x".repeat(256 * 1024 + 1),
            truncated: false,
          },
        },
      ],
      activeThreadId: null,
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const message = normalized!.messages[0] as { snapshot?: unknown };
    expect(message.snapshot).toBeUndefined();
  });

  it("strips runtime-only image attachment fields from persisted messages", () => {
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
    };

    const normalized = normalizeWorkspaceSnapshot(snapshot);
    const messageAttachment = (normalized!.messages[0] as { attachments?: unknown[] })
      .attachments![0] as Record<string, unknown>;

    expect(messageAttachment).toEqual({
      id: "a1",
      kind: "image",
      name: "screenshot.png",
      mimeType: "image/png",
      size: 1024,
      storageKey: "a1.png",
    });
  });
});
