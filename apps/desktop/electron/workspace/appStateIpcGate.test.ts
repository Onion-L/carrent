import { describe, expect, it } from "bun:test";

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
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const gate = createAppStateIpcGate(
      {
        handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) =>
          handlers.set(channel, listener),
        on: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) =>
          listeners.set(channel, listener),
      },
      recovery,
    );
    let runsStarted = 0;
    let snapshotsRemembered = 0;
    let diagnosticsCopied = 0;

    gate.ipcMain.handle("chat:send", () => {
      runsStarted += 1;
    });
    gate.ipcMain.on("workspace:remember", () => {
      snapshotsRemembered += 1;
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
    listeners.get("workspace:remember")?.({});
    expect(String(runError)).toContain("App State recovery is required");
    expect(await handlers.get("clipboard:write-text")?.({})).toBeUndefined();
    expect(runsStarted).toBe(0);
    expect(snapshotsRemembered).toBe(0);
    expect(diagnosticsCopied).toBe(1);

    gate.update(ready);
    expect(await handlers.get("chat:send")?.({})).toBeUndefined();
    listeners.get("workspace:remember")?.({});
    expect(runsStarted).toBe(1);
    expect(snapshotsRemembered).toBe(1);
  });
});
