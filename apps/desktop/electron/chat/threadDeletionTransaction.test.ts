import { describe, expect, it } from "bun:test";

import { createEmptyAppStateSnapshot } from "../../src/shared/workspacePersistence";
import { createThreadDeletionTransactionManager } from "./threadDeletionTransaction";

describe("createThreadDeletionTransactionManager", () => {
  it("stages attachments and commits Thread deletion", async () => {
    const before = {
      ...createEmptyAppStateSnapshot(),
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Thread",
          createdAt: "2026-08-20T08:00:00.000Z",
          lastActivityAt: "2026-08-20T08:00:00.000Z",
          providerProfileId: "default",
          agentMode: "ask" as const,
        },
      ],
    };
    let journal: import("./threadDeletionTransaction").ThreadDeletionJournal | null = null;
    const attachmentEvents: string[] = [];
    const manager = createThreadDeletionTransactionManager({
      journalStore: {
        load: async () => journal,
        save: async (next) => {
          journal = next;
        },
        clear: async () => {
          journal = null;
        },
      },
      appStateStore: {
        waitForWrites: async () => {},
        loadAppStateSnapshot: async () => before,
        saveAppStateSnapshot: async () => {},
      },
      attachmentStore: {
        prepareDeletion: async () => {
          attachmentEvents.push("prepare");
        },
        commitDeletion: async () => {
          attachmentEvents.push("commit");
        },
        rollbackDeletion: async () => {
          attachmentEvents.push("rollback");
        },
      },
      sessionManager: {
        deleteThreadData: async (request) => ({ threadIds: request.threadIds }),
        rollbackThreadDataDeletion: async () => {},
      },
      createOperationId: () => "operation-1",
    });

    await manager.deleteThread({
      beforeAppState: before,
      afterAppState: before,
      threadData: { threadIds: ["thread-1"], attachmentStorageKeys: ["attachment-1"] },
    });

    expect(attachmentEvents).toEqual(["prepare", "commit"]);
    expect(journal).toBe(null);
  });
});
