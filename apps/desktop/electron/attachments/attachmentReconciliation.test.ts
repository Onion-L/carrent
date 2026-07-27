import { describe, expect, it } from "bun:test";

import {
  APP_STATE_SNAPSHOT_VERSION,
  WORKSPACE_SNAPSHOT_VERSION,
  type AppStateSnapshot,
  type WorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";
import { reconcileAttachmentsAfterValidStateLoad } from "./attachmentReconciliation";

const attachment = (storageKey: string) => ({
  id: storageKey,
  kind: "file" as const,
  name: storageKey,
  mimeType: "text/plain",
  size: 1,
  storageKey,
});

const appState: AppStateSnapshot = {
  version: APP_STATE_SNAPSHOT_VERSION,
  workspaces: [],
  projects: [],
  associations: [],
  threadMessages: [
    {
      id: "message-1",
      threadId: "thread-1",
      role: "user",
      content: "sent",
      createdAt: "2026-07-27T00:00:00.000Z",
      attachments: [attachment("message.txt")],
    },
  ],
  threadDrafts: [],
  threadPromotionIntents: [],
  activeWorkspaceId: null,
};

const workspace: WorkspaceSnapshot = {
  version: WORKSPACE_SNAPSHOT_VERSION,
  projects: [],
  chats: [],
  messages: [],
  activeThreadId: null,
  threadWork: {
    "thread-1": {
      draft: {
        content: "draft",
        attachedSkillNames: [],
        attachments: [attachment("composer.txt")],
      },
      queuedMessages: [
        { id: "queued-1", content: "queued", attachments: [attachment("queue.txt")] },
      ],
    },
  },
};

describe("reconcileAttachmentsAfterValidStateLoad", () => {
  it("preserves every message, composer, queue, and Draft reference", async () => {
    let referenced: Set<string> | null = null;

    await reconcileAttachmentsAfterValidStateLoad({
      appState,
      workspace,
      deleteOrphanedAttachments: async (storageKeys) => {
        referenced = storageKeys;
        return ["orphan.txt"];
      },
    });

    expect([...(referenced ?? new Set())].sort()).toEqual([
      "composer.txt",
      "message.txt",
      "queue.txt",
    ]);
  });

  it("does not inspect or delete attachments when App State is invalid", async () => {
    let called = false;

    const deleted = await reconcileAttachmentsAfterValidStateLoad({
      appState: null,
      workspace,
      deleteOrphanedAttachments: async () => {
        called = true;
        return ["orphan.txt"];
      },
    });

    expect(deleted).toEqual([]);
    expect(called).toBe(false);
  });

  it("does not block app startup when orphan cleanup fails", async () => {
    const deleted = await reconcileAttachmentsAfterValidStateLoad({
      appState,
      workspace,
      deleteOrphanedAttachments: async () => {
        throw new Error("attachment directory is unreadable");
      },
    });

    expect(deleted).toEqual([]);
  });
});
