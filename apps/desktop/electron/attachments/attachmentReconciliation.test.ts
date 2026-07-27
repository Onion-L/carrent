import { describe, expect, it } from "bun:test";

import {
  APP_STATE_SNAPSHOT_VERSION,
  type AppStateSnapshot,
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
  workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
  projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
  associations: [
    {
      workspaceId: "workspace-1",
      projectId: "project-1",
      order: 0,
      defaultRuntimeId: "kimi",
      defaultRuntimeMode: "approval-required",
    },
  ],
  threads: [
    {
      id: "thread-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      title: "Attachment reconciliation",
      createdAt: "2026-07-27T00:00:00.000Z",
      lastActivityAt: "2026-07-27T00:00:00.000Z",
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    },
  ],
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
  threadDrafts: [
    {
      id: "draft-1",
      threadId: "thread-draft-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      content: "unsent",
      attachedSkillNames: [],
      attachments: [attachment("draft.txt")],
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    },
  ],
  threadPromotionIntents: [],
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
  activeWorkspaceId: "workspace-1",
};

describe("reconcileAttachmentsAfterValidStateLoad", () => {
  it("preserves every message, composer, queue, and Draft reference", async () => {
    let referenced: Set<string> | null = null;

    await reconcileAttachmentsAfterValidStateLoad({
      appState,
      deleteOrphanedAttachments: async (storageKeys) => {
        referenced = storageKeys;
        return ["orphan.txt"];
      },
    });

    expect([...(referenced ?? new Set())].sort()).toEqual([
      "composer.txt",
      "draft.txt",
      "message.txt",
      "queue.txt",
    ]);
  });

  it("does not inspect or delete attachments when App State is invalid", async () => {
    let called = false;

    const deleted = await reconcileAttachmentsAfterValidStateLoad({
      appState: null,
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
      deleteOrphanedAttachments: async () => {
        throw new Error("attachment directory is unreadable");
      },
    });

    expect(deleted).toEqual([]);
  });
});
