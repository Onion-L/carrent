import { describe, expect, it } from "bun:test";
import type { WorkspaceSnapshot } from "../src/shared/workspacePersistence";
import type { WorkspaceStore } from "./workspace/workspaceStore";
import { createWorkspaceStoreStub } from "./workspace/workspaceStore.testUtils";
import { createAppShutdown } from "./appShutdown";

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
  return createWorkspaceStoreStub({
    saveWorkspaceSnapshot,
  });
}

describe("createAppShutdown", () => {
  it("waits for an active Thread deletion before saving the shutdown snapshot", async () => {
    let releaseDeletion!: () => void;
    const deletion = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const events: string[] = [];
    const shutdown = createAppShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () =>
        createWorkspaceStoreStub({
          saveWorkspaceSnapshot: async () => {
            events.push("save");
          },
        }),
      beforeSave: async () => {
        events.push("wait");
        await deletion;
      },
      quit: () => events.push("quit"),
    });

    const pending = shutdown.beforeQuit({ preventDefault() {} });
    await Promise.resolve();
    expect(events).toEqual(["wait"]);

    releaseDeletion();
    await pending;
    expect(events).toEqual(["wait", "save", "quit"]);
  });

  it("saves the latest snapshot exactly once before quitting", async () => {
    const calls: string[] = [];
    const store = createStore(async (savedSnapshot) => {
      expect(savedSnapshot).toEqual(snapshot);
      calls.push("save");
    });
    const shutdown = createAppShutdown({
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
    const shutdown = createAppShutdown({
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
    const shutdown = createAppShutdown({
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

  it("reports save errors and keeps the app open", async () => {
    const saveError = new Error("save failed");
    const reported: unknown[] = [];
    let quitCount = 0;
    const shutdown = createAppShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () =>
        createStore(async () => {
          throw saveError;
        }),
      quit: () => {
        quitCount += 1;
      },
      reportShutdownError: (error) => reported.push(error),
    });

    await shutdown.beforeQuit({ preventDefault() {} });

    expect(reported).toEqual([saveError]);
    expect(quitCount).toBe(0);
    expect(shutdown.isQuitting()).toBe(false);
  });

  it("allows the recursive quit event through without saving twice", async () => {
    let saveCount = 0;
    let firstPreventCount = 0;
    let recursivePreventCount = 0;
    let shutdown: ReturnType<typeof createAppShutdown>;
    shutdown = createAppShutdown({
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

  it("prevents repeated quit events while shutdown is still pending", async () => {
    let finishSave!: () => void;
    const save = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    let firstPreventCount = 0;
    let repeatedPreventCount = 0;
    const shutdown = createAppShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () =>
        createStore(async () => {
          await save;
        }),
      quit: () => {},
    });

    const pendingShutdown = shutdown.beforeQuit({
      preventDefault: () => {
        firstPreventCount += 1;
      },
    });
    await Promise.resolve();
    await shutdown.beforeQuit({
      preventDefault: () => {
        repeatedPreventCount += 1;
      },
    });

    expect(firstPreventCount).toBe(1);
    expect(repeatedPreventCount).toBe(1);
    expect(shutdown.isQuitting()).toBe(false);

    finishSave();
    await pendingShutdown;
  });

  it("returns to the app when quitting with a live Run is not confirmed", async () => {
    const calls: string[] = [];
    const shutdown = createAppShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () =>
        createStore(async () => {
          calls.push("save");
        }),
      liveRunQuitPolicy: {
        hasLiveRuns: () => true,
        confirmQuitWithLiveRuns: async () => false,
        cancelLiveRuns: async () => {
          calls.push("cancel");
        },
      },
      quit: () => calls.push("quit"),
    });

    await shutdown.beforeQuit({ preventDefault: () => calls.push("prevent") });

    expect(calls).toEqual(["prevent"]);
    expect(shutdown.isQuitting()).toBe(false);
  });

  it("keeps quit protection active when the live Run confirmation fails", async () => {
    const confirmationError = new Error("dialog failed");
    const reported: unknown[] = [];
    const shutdown = createAppShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () => createStore(async () => {}),
      liveRunQuitPolicy: {
        hasLiveRuns: () => true,
        confirmQuitWithLiveRuns: async () => {
          throw confirmationError;
        },
        cancelLiveRuns: async () => {},
      },
      reportShutdownError: (error) => reported.push(error),
      quit: () => {
        throw new Error("must not quit");
      },
    });

    await shutdown.beforeQuit({ preventDefault() {} });

    expect(reported).toEqual([confirmationError]);
    expect(shutdown.isQuitting()).toBe(false);
  });

  it("cancels live Runs, saves state, and exits after confirmation", async () => {
    const calls: string[] = [];
    let finishCancellation!: () => void;
    const cancellation = new Promise<void>((resolve) => {
      finishCancellation = resolve;
    });
    const shutdown = createAppShutdown({
      getLastWorkspaceSnapshot: () => snapshot,
      getWorkspaceStore: () =>
        createStore(async () => {
          calls.push("save");
        }),
      liveRunQuitPolicy: {
        hasLiveRuns: () => true,
        confirmQuitWithLiveRuns: async () => {
          calls.push("confirm");
          return true;
        },
        cancelLiveRuns: async () => {
          calls.push("cancel");
          await cancellation;
          calls.push("cancelled");
        },
      },
      quit: () => calls.push("quit"),
    });

    const pendingShutdown = shutdown.beforeQuit({ preventDefault: () => calls.push("prevent") });
    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toEqual(["prevent", "confirm", "cancel"]);

    finishCancellation();
    await pendingShutdown;

    expect(calls).toEqual(["prevent", "confirm", "cancel", "cancelled", "save", "quit"]);
    expect(shutdown.isQuitting()).toBe(true);
  });
});
