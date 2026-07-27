import { describe, expect, it } from "bun:test";

import type {
  AppStateSnapshot,
  ProviderSessionSnapshot,
} from "../../src/shared/workspacePersistence";
import {
  createThreadDeletionTransactionManager,
  recoverThreadDeletionTransaction,
  type ThreadDeletionJournal,
  type ThreadDeletionJournalStore,
} from "./threadDeletionTransaction";

const beforeAppState: AppStateSnapshot = {
  version: 1,
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
      title: "Archived",
      createdAt: "2026-07-27T00:00:00.000Z",
      lastActivityAt: "2026-07-27T00:00:00.000Z",
      archived: true,
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    },
  ],
  activeWorkspaceId: "workspace-1",
};

const afterAppState: AppStateSnapshot = {
  ...beforeAppState,
  threads: [],
};

function createHarness() {
  let appState = structuredClone(beforeAppState);
  let providerSessions: ProviderSessionSnapshot = {
    version: 1,
    sessions: {
      "kimi:thread-1": "session-1",
      "kimi:thread-2": "session-2",
    },
  };
  let journal: ThreadDeletionJournal | null = null;
  const attachmentEvents: string[] = [];
  const journalStore: ThreadDeletionJournalStore = {
    load: async () => structuredClone(journal),
    save: async (next) => {
      journal = structuredClone(next);
    },
    clear: async () => {
      journal = null;
    },
  };
  const appStateStore = {
    waitForWrites: async () => {},
    loadAppStateSnapshot: async () => structuredClone(appState),
    saveAppStateSnapshot: async (snapshot: AppStateSnapshot) => {
      appState = structuredClone(snapshot);
    },
    loadProviderSessions: async () => structuredClone(providerSessions),
    saveProviderSessions: async (snapshot: ProviderSessionSnapshot) => {
      providerSessions = structuredClone(snapshot);
    },
  };
  const attachmentStore = {
    prepareDeletion: async (operationId: string, keys: string[]) => {
      attachmentEvents.push(`prepare:${operationId}:${keys.join(",")}`);
    },
    commitDeletion: async (operationId: string) => {
      attachmentEvents.push(`commit:${operationId}`);
    },
    rollbackDeletion: async (operationId: string) => {
      attachmentEvents.push(`rollback:${operationId}`);
    },
  };

  return {
    journalStore,
    appStateStore,
    attachmentStore,
    attachmentEvents,
    getAppState: () => appState,
    getProviderSessions: () => providerSessions,
    getJournal: () => journal,
    setJournal: (next: ThreadDeletionJournal) => {
      journal = structuredClone(next);
    },
  };
}

function request() {
  return {
    beforeAppState,
    afterAppState,
    threadData: {
      threadIds: ["thread-1"],
      attachmentStorageKeys: ["attachment.png"],
    },
  };
}

describe("thread deletion transaction", () => {
  it("commits App State, sessions, and attachments as one operation", async () => {
    const harness = createHarness();
    const manager = createThreadDeletionTransactionManager({
      journalStore: harness.journalStore,
      appStateStore: harness.appStateStore,
      attachmentStore: harness.attachmentStore,
      sessionManager: {
        deleteThreadData: async () => ({
          threadIds: ["thread-1"],
          removedProviderSessions: {
            "kimi:thread-1": "session-1",
          },
          detachedRuntimeSessions: {},
        }),
        rollbackThreadDataDeletion: async () => {},
      },
      createOperationId: () => "operation-1",
    });

    await manager.deleteThread(request());

    expect(harness.getAppState()).toEqual(afterAppState);
    expect(harness.attachmentEvents).toEqual([
      "prepare:operation-1:attachment.png",
      "commit:operation-1",
    ]);
    expect(harness.getJournal()).toBe(null);
  });

  it("rolls every store back when a pre-commit write fails", async () => {
    const harness = createHarness();
    let appStateSaveAttempts = 0;
    const manager = createThreadDeletionTransactionManager({
      journalStore: harness.journalStore,
      appStateStore: {
        ...harness.appStateStore,
        saveAppStateSnapshot: async (snapshot) => {
          appStateSaveAttempts += 1;
          if (appStateSaveAttempts === 1) throw new Error("disk full");
          await harness.appStateStore.saveAppStateSnapshot(snapshot);
        },
      },
      attachmentStore: harness.attachmentStore,
      sessionManager: {
        deleteThreadData: async () => ({
          threadIds: ["thread-1"],
          removedProviderSessions: {
            "kimi:thread-1": "session-1",
          },
          detachedRuntimeSessions: {},
        }),
        rollbackThreadDataDeletion: async () => {},
      },
      createOperationId: () => "operation-2",
    });

    let deletionError: unknown;
    try {
      await manager.deleteThread(request());
    } catch (error) {
      deletionError = error;
    }
    expect(String(deletionError)).toContain("disk full");

    expect(harness.getAppState()).toEqual(beforeAppState);
    expect(harness.attachmentEvents).toEqual([
      "prepare:operation-2:attachment.png",
      "rollback:operation-2",
    ]);
    expect(harness.getJournal()).toBe(null);
  });

  for (const testCase of [
    {
      name: "Association cascade",
      scope: {
        kind: "association" as const,
        workspaceId: "workspace-1",
        projectId: "project-1",
      },
    },
    {
      name: "Workspace cascade",
      scope: { kind: "workspace" as const, workspaceId: "workspace-1" },
    },
  ]) {
    it(`rolls back the complete ${testCase.name} when persistence fails`, async () => {
      const harness = createHarness();
      let appStateSaveAttempts = 0;
      const manager = createThreadDeletionTransactionManager({
        journalStore: harness.journalStore,
        appStateStore: {
          ...harness.appStateStore,
          saveAppStateSnapshot: async (snapshot) => {
            appStateSaveAttempts += 1;
            if (appStateSaveAttempts === 1) throw new Error("disk full");
            await harness.appStateStore.saveAppStateSnapshot(snapshot);
          },
        },
        attachmentStore: harness.attachmentStore,
        sessionManager: {
          deleteThreadData: async () => ({
            threadIds: ["thread-1"],
            removedProviderSessions: {},
            detachedRuntimeSessions: {},
          }),
          rollbackThreadDataDeletion: async () => {},
        },
        createOperationId: () => `operation-${testCase.scope.kind}-rollback`,
      });

      let deletionError: unknown;
      try {
        await manager.deleteThread({ ...request(), scope: testCase.scope });
      } catch (error) {
        deletionError = error;
      }
      expect(String(deletionError)).toContain("disk full");

      expect(harness.getAppState()).toEqual(beforeAppState);
      expect(harness.getJournal()).toBe(null);
      expect(harness.attachmentEvents.at(-1)).toBe(
        `rollback:operation-${testCase.scope.kind}-rollback`,
      );
    });
  }

  it("keeps independent writes blocked while rollback recovery is pending", async () => {
    const harness = createHarness();
    const activeChanges: boolean[] = [];
    const manager = createThreadDeletionTransactionManager({
      journalStore: harness.journalStore,
      appStateStore: {
        ...harness.appStateStore,
        saveAppStateSnapshot: async () => {
          throw new Error("disk full");
        },
      },
      attachmentStore: {
        ...harness.attachmentStore,
        rollbackDeletion: async () => {
          throw new Error("backup unavailable");
        },
      },
      sessionManager: {
        deleteThreadData: async () => ({
          threadIds: ["thread-1"],
          removedProviderSessions: {},
          detachedRuntimeSessions: {},
        }),
        rollbackThreadDataDeletion: async () => {},
      },
      createOperationId: () => "operation-recovery-pending",
      onActiveChange: (active) => activeChanges.push(active),
    });

    let deletionError: unknown;
    try {
      await manager.deleteThread(request());
    } catch (error) {
      deletionError = error;
    }

    expect(String(deletionError)).toContain("could not be fully rolled back");
    expect(activeChanges).toEqual([true]);
    expect(harness.getJournal()?.phase).toBe("preparing");
  });

  it("drains queued writes and deletes from authoritative snapshots", async () => {
    const harness = createHarness();
    const latestAppState: AppStateSnapshot = {
      ...beforeAppState,
      threads: [
        ...beforeAppState.threads!,
        {
          id: "thread-2",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Live",
          createdAt: "2026-07-27T01:00:00.000Z",
          lastActivityAt: "2026-07-27T02:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadMessages: [
        {
          id: "message-2",
          threadId: "thread-2",
          role: "assistant",
          content: "Arrived before deletion",
          createdAt: "2026-07-27T02:00:00.000Z",
          attachments: [],
        },
      ],
    };
    await harness.appStateStore.saveAppStateSnapshot(latestAppState);
    const readOrder: string[] = [];
    const manager = createThreadDeletionTransactionManager({
      journalStore: harness.journalStore,
      appStateStore: {
        ...harness.appStateStore,
        waitForWrites: async () => {
          readOrder.push("drain");
        },
        loadAppStateSnapshot: async () => {
          readOrder.push("load-app-state");
          return harness.appStateStore.loadAppStateSnapshot();
        },
      },
      attachmentStore: harness.attachmentStore,
      sessionManager: {
        deleteThreadData: async () => ({
          threadIds: ["thread-1"],
          removedProviderSessions: {},
          detachedRuntimeSessions: {},
        }),
        rollbackThreadDataDeletion: async () => {},
      },
      createOperationId: () => "operation-authoritative",
    });

    await manager.deleteThread(request());

    expect(readOrder.slice(0, 2)).toEqual(["drain", "load-app-state"]);
    expect(harness.getAppState().threads?.map((thread) => thread.id)).toEqual(["thread-2"]);
    expect(harness.getAppState().threadMessages?.map((message) => message.id)).toEqual([
      "message-2",
    ]);
  });

  it("removes a Workspace cascade while preserving a shared Project", async () => {
    const harness = createHarness();
    const sharedAppState: AppStateSnapshot = {
      ...beforeAppState,
      workspaces: [...beforeAppState.workspaces, { id: "workspace-2", name: "Work", order: 1 }],
      associations: [
        ...beforeAppState.associations,
        {
          workspaceId: "workspace-2",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
    };
    await harness.appStateStore.saveAppStateSnapshot(sharedAppState);
    const manager = createThreadDeletionTransactionManager({
      journalStore: harness.journalStore,
      appStateStore: harness.appStateStore,
      attachmentStore: harness.attachmentStore,
      sessionManager: {
        deleteThreadData: async () => ({
          threadIds: ["thread-1"],
          removedProviderSessions: {},
          detachedRuntimeSessions: {},
        }),
        rollbackThreadDataDeletion: async () => {},
      },
    });

    await manager.deleteThread({
      ...request(),
      scope: { kind: "workspace", workspaceId: "workspace-1" },
    });

    expect(harness.getAppState().workspaces.map((workspace) => workspace.id)).toEqual([
      "workspace-2",
    ]);
    expect(harness.getAppState().associations).toEqual([sharedAppState.associations[1]]);
    expect(harness.getAppState().projects).toEqual(beforeAppState.projects);
    expect(harness.getAppState().activeWorkspaceId).toBe("workspace-2");
  });

  it("removes the Project record with its final Association", async () => {
    const harness = createHarness();
    const manager = createThreadDeletionTransactionManager({
      journalStore: harness.journalStore,
      appStateStore: harness.appStateStore,
      attachmentStore: harness.attachmentStore,
      sessionManager: {
        deleteThreadData: async () => ({
          threadIds: ["thread-1"],
          removedProviderSessions: {},
          detachedRuntimeSessions: {},
        }),
        rollbackThreadDataDeletion: async () => {},
      },
    });

    await manager.deleteThread({
      ...request(),
      scope: {
        kind: "association",
        workspaceId: "workspace-1",
        projectId: "project-1",
      },
    });

    expect(harness.getAppState().workspaces).toEqual(beforeAppState.workspaces);
    expect(harness.getAppState().associations).toEqual([]);
    expect(harness.getAppState().projects).toEqual([]);
  });

  it("rolls back a preparing transaction during startup recovery", async () => {
    const harness = createHarness();
    harness.setJournal({
      version: 1,
      operationId: "operation-3",
      phase: "preparing",
      request: request(),
      removedProviderSessions: {
        "kimi:thread-1": "session-1",
      },
    });
    await harness.appStateStore.saveAppStateSnapshot(afterAppState);
    await harness.appStateStore.saveProviderSessions({
      version: 1,
      sessions: { "kimi:thread-2": "session-2" },
    });

    await recoverThreadDeletionTransaction({
      journalStore: harness.journalStore,
      appStateStore: harness.appStateStore,
      attachmentStore: harness.attachmentStore,
    });

    expect(harness.getAppState()).toEqual(beforeAppState);
    expect(harness.getProviderSessions().sessions).toEqual({
      "kimi:thread-1": "session-1",
      "kimi:thread-2": "session-2",
    });
    expect(harness.attachmentEvents).toEqual(["rollback:operation-3"]);
    expect(harness.getJournal()).toBe(null);
  });

  it("finishes a committed transaction during startup recovery", async () => {
    const harness = createHarness();
    harness.setJournal({
      version: 1,
      operationId: "operation-4",
      phase: "committed",
      request: request(),
      removedProviderSessions: {
        "kimi:thread-1": "session-1",
      },
    });
    await harness.appStateStore.saveAppStateSnapshot(afterAppState);
    await harness.appStateStore.saveProviderSessions({
      version: 1,
      sessions: { "kimi:thread-2": "session-2" },
    });

    await recoverThreadDeletionTransaction({
      journalStore: harness.journalStore,
      appStateStore: harness.appStateStore,
      attachmentStore: harness.attachmentStore,
    });

    expect(harness.getAppState()).toEqual(afterAppState);
    expect(harness.getProviderSessions().sessions).toEqual({
      "kimi:thread-2": "session-2",
    });
    expect(harness.attachmentEvents).toEqual(["commit:operation-4"]);
    expect(harness.getJournal()).toBe(null);
  });

  it("reports committed deletion as successful while attachment cleanup awaits recovery", async () => {
    const harness = createHarness();
    let commitAttempts = 0;
    const activeChanges: boolean[] = [];
    const attachmentStore = {
      ...harness.attachmentStore,
      commitDeletion: async (operationId: string) => {
        commitAttempts += 1;
        if (commitAttempts <= 2) throw new Error("directory busy");
        harness.attachmentEvents.push(`commit:${operationId}`);
      },
    };
    const manager = createThreadDeletionTransactionManager({
      journalStore: harness.journalStore,
      appStateStore: harness.appStateStore,
      attachmentStore,
      sessionManager: {
        deleteThreadData: async () => ({
          threadIds: ["thread-1"],
          removedProviderSessions: {},
          detachedRuntimeSessions: {},
        }),
        rollbackThreadDataDeletion: async () => {},
      },
      createOperationId: () => "operation-5",
      onActiveChange: (active) => activeChanges.push(active),
    });

    await manager.deleteThread(request());

    expect(harness.getAppState()).toEqual(afterAppState);
    expect(harness.getJournal()?.phase).toBe("committed");
    expect(activeChanges).toEqual([true, false]);

    await recoverThreadDeletionTransaction({
      journalStore: harness.journalStore,
      appStateStore: harness.appStateStore,
      attachmentStore,
    });

    expect(commitAttempts).toBe(3);
    expect(harness.getJournal()).toBe(null);
  });
});
