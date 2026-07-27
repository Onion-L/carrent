import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import type { AppStateLoadResult } from "../../src/shared/workspacePersistence";
import { createAppStateIpcGate, loadProviderSessionsForAppState } from "./appStateIpcGate";

const recovery: AppStateLoadResult = {
  status: "recovery-required",
  diagnostics: [],
};

const ready: AppStateLoadResult = {
  status: "ready",
  snapshot: {
    version: 1,
    workspaces: [],
    projects: [],
    associations: [],
    activeWorkspaceId: null,
  },
};

describe("createAppStateIpcGate", () => {
  it("preserves the IPC receiver when registering handlers and listeners", () => {
    class IpcMainLike extends EventEmitter {
      handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

      handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) {
        this.handlers.set(channel, listener);
      }
    }

    const ipcMainLike = new IpcMainLike();
    const gate = createAppStateIpcGate(ipcMainLike, ready);

    gate.ipcMain.handle("app-state:load", () => undefined);
    gate.ipcMain.on("app-state:stage", () => undefined);

    expect(ipcMainLike.handlers.has("app-state:load")).toBe(true);
    expect(ipcMainLike.listenerCount("app-state:stage")).toBe(1);
  });

  it("does not load Runtime Session mappings while initial App State is blocked", async () => {
    let loadCalls = 0;
    const store = {
      loadProviderSessions: async () => {
        loadCalls += 1;
        return { version: 1 as const, sessions: { "kimi:thread-1": "session-1" } };
      },
    };

    expect(await loadProviderSessionsForAppState(store, recovery)).toEqual({
      version: 1,
      sessions: {},
    });
    expect(loadCalls).toBe(0);
    expect(await loadProviderSessionsForAppState(store, ready)).toEqual({
      version: 1,
      sessions: { "kimi:thread-1": "session-1" },
    });
    expect(loadCalls).toBe(1);
  });

  it("allows only recovery IPC while App State is blocked", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const gate = createAppStateIpcGate(
      {
        handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) =>
          handlers.set(channel, listener),
        on() {},
      },
      recovery,
    );
    let runsStarted = 0;
    let snapshotsSaved = 0;
    let diagnosticsCopied = 0;

    gate.ipcMain.handle("chat:send", () => {
      runsStarted += 1;
    });
    gate.ipcMain.handle("app-state:save", () => {
      snapshotsSaved += 1;
    });
    gate.ipcMain.handle("clipboard:write-text", () => {
      diagnosticsCopied += 1;
    });

    let runError: unknown;
    try {
      await handlers.get("chat:send")?.({});
    } catch (error) {
      runError = error;
    }
    const saveError = await caughtError(() => handlers.get("app-state:save")?.({}));
    expect(String(runError)).toContain("App State recovery is required");
    expect(String(saveError)).toContain("App State recovery is required");
    expect(await handlers.get("clipboard:write-text")?.({})).toBeUndefined();
    expect(runsStarted).toBe(0);
    expect(snapshotsSaved).toBe(0);
    expect(diagnosticsCopied).toBe(1);

    gate.update(ready);
    expect(await handlers.get("chat:send")?.({})).toBeUndefined();
    await handlers.get("app-state:save")?.({});
    expect(runsStarted).toBe(1);
    expect(snapshotsSaved).toBe(1);
  });
});

async function caughtError(operation: () => unknown): Promise<unknown> {
  try {
    return await operation();
  } catch (error) {
    return error;
  }
}
