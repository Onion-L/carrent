import { describe, expect, it } from "bun:test";
import type { WorkspaceSnapshot } from "../../src/shared/workspacePersistence";
import type { WorkspaceStore } from "./workspaceStore";
import { createWorkspaceShutdown } from "./workspaceShutdown";

const snapshot: WorkspaceSnapshot = {
  version: 1,
  projects: [],
  chats: [],
  messages: [],
  activeThreadId: null,
};

function createStore(
  saveWorkspaceSnapshot: WorkspaceStore["saveWorkspaceSnapshot"],
): WorkspaceStore {
  return {
    loadWorkspaceSnapshot: async () => null,
    saveWorkspaceSnapshot,
    loadProviderSessions: async () => ({ version: 1, sessions: {} }),
    saveProviderSessions: async () => {},
  };
}

describe("createWorkspaceShutdown", () => {
  it("saves the latest snapshot exactly once before quitting", async () => {
    const calls: string[] = [];
    const store = createStore(async (savedSnapshot) => {
      expect(savedSnapshot).toEqual(snapshot);
      calls.push("save");
    });
    const shutdown = createWorkspaceShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () => store,
      quit: () => calls.push("quit"),
    });
    let prevented = false;

    await shutdown.beforeQuit({
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(prevented).toBe(true);
    expect(calls).toEqual(["save", "quit"]);
  });

  it("flushes without requiring a window count", async () => {
    let saveCount = 0;
    let quitCount = 0;
    const shutdown = createWorkspaceShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () =>
        createStore(async () => {
          saveCount += 1;
        }),
      quit: () => {
        quitCount += 1;
      },
    });

    await shutdown.beforeQuit({ preventDefault() {} });

    expect(saveCount).toBe(1);
    expect(quitCount).toBe(1);
  });

  it("quits when no snapshot has been remembered", async () => {
    let prevented = false;
    let quitCount = 0;
    const shutdown = createWorkspaceShutdown({
      getLastWorkspaceSnapshot: () => null,
      getWorkspaceStore: () => createStore(async () => {}),
      quit: () => {
        quitCount += 1;
      },
    });

    await shutdown.beforeQuit({
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(prevented).toBe(true);
    expect(quitCount).toBe(1);
  });

  it("reports save errors and still quits", async () => {
    const saveError = new Error("save failed");
    const reported: unknown[] = [];
    let quitCount = 0;
    const shutdown = createWorkspaceShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () =>
        createStore(async () => {
          throw saveError;
        }),
      quit: () => {
        quitCount += 1;
      },
      reportSaveError: (error) => reported.push(error),
    });

    await shutdown.beforeQuit({ preventDefault() {} });

    expect(reported).toEqual([saveError]);
    expect(quitCount).toBe(1);
  });

  it("allows the recursive quit event through without saving twice", async () => {
    let saveCount = 0;
    let firstPreventCount = 0;
    let recursivePreventCount = 0;
    let shutdown: ReturnType<typeof createWorkspaceShutdown>;
    shutdown = createWorkspaceShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () =>
        createStore(async () => {
          saveCount += 1;
        }),
      quit: () => {
        void shutdown.beforeQuit({
          preventDefault: () => {
            recursivePreventCount += 1;
          },
        });
      },
    });

    await shutdown.beforeQuit({
      preventDefault: () => {
        firstPreventCount += 1;
      },
    });

    expect(firstPreventCount).toBe(1);
    expect(recursivePreventCount).toBe(0);
    expect(saveCount).toBe(1);
  });
});
