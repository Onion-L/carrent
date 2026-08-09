import { describe, expect, it } from "bun:test";
import { registerAppStateIpc } from "./appStateIpc";
import {
  createEmptyAppStateSnapshot,
  type AppStateLoadResult,
  type ProviderSessionSnapshot,
} from "../../src/shared/workspacePersistence";
import { createAppStateStoreStub } from "./appStateStore.testUtils";
import { createAppStateIpcGate } from "./appStateIpcGate";

const readyAppStateResult: AppStateLoadResult = {
  status: "ready",
  snapshot: createEmptyAppStateSnapshot(),
};
const preserveAppStateResult = (result: AppStateLoadResult) => result;

async function caughtError(operation: () => unknown): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
}

describe("registerAppStateIpc", () => {
  it("registers App State and provider session channels", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerAppStateIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      createAppStateStoreStub(),
      readyAppStateResult,
      preserveAppStateResult,
    );

    expect([...handlers.keys()].sort()).toEqual([
      "app-state:full-reset",
      "app-state:load",
      "app-state:reread",
      "provider-sessions:load",
      "provider-sessions:save",
    ]);
  });

  it("loads, re-reads, and fully resets through the recovery boundary", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ready = {
      status: "ready" as const,
      snapshot: {
        version: 1 as const,
        workspaces: [],
        projects: [],
        associations: [],
        activeWorkspaceId: null,
      },
    };
    const recovery = {
      status: "recovery-required" as const,
      diagnostics: [
        {
          appVersion: "0.0.0",
          subsystem: "app-state" as const,
          stage: "parse" as const,
          summary: "malformed",
          dataPath: "/tmp/app-state.json",
          occurredAt: "2026-07-27T08:00:00.000Z",
        },
      ],
    };
    let initializeCalls = 0;
    let resetCalls = 0;

    registerAppStateIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      createAppStateStoreStub({
        initializeAppState: async () => {
          initializeCalls += 1;
          return recovery;
        },
        fullResetAppState: async () => {
          resetCalls += 1;
          return ready;
        },
      }),
      ready,
      preserveAppStateResult,
    );

    expect(await handlers.get("app-state:load")?.({})).toEqual(ready);
    expect(await handlers.get("app-state:reread")?.({})).toEqual(recovery);
    expect(await handlers.get("app-state:full-reset")?.({})).toEqual(ready);
    expect(initializeCalls).toBe(1);
    expect(resetCalls).toBe(1);
  });

  it("keeps App State commands blocked for the full reread and reset transaction", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const activity: boolean[] = [];
    registerAppStateIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      createAppStateStoreStub(),
      readyAppStateResult,
      async (result) => {
        expect(activity.at(-1)).toBe(true);
        return result;
      },
      (active) => activity.push(active),
    );

    await handlers.get("app-state:reread")?.({});
    await handlers.get("app-state:full-reset")?.({});

    expect(activity).toEqual([true, false, true, false]);
  });

  it("serializes overlapping reread and reset operations while both hold the command gate", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const events: string[] = [];
    let finishReread!: () => void;
    const rereadGate = new Promise<void>((resolve) => {
      finishReread = resolve;
    });
    registerAppStateIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      createAppStateStoreStub({
        initializeAppState: async () => {
          events.push("reread:start");
          await rereadGate;
          events.push("reread:end");
          return readyAppStateResult;
        },
        fullResetAppState: async () => {
          events.push("reset:start");
          return readyAppStateResult;
        },
      }),
      readyAppStateResult,
      preserveAppStateResult,
      (active) => events.push(active ? "gate:on" : "gate:off"),
    );

    const reread = Promise.resolve(handlers.get("app-state:reread")?.({}));
    const reset = Promise.resolve(handlers.get("app-state:full-reset")?.({}));
    await Promise.resolve();
    await Promise.resolve();
    expect(events).toEqual(["gate:on", "gate:on", "reread:start"]);

    finishReread();
    await Promise.all([reread, reset]);
    expect(events).toEqual([
      "gate:on",
      "gate:on",
      "reread:start",
      "reread:end",
      "gate:off",
      "reset:start",
      "gate:off",
    ]);
  });

  it("delivers reset notices only once", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const snapshot = {
      version: 1 as const,
      workspaces: [],
      projects: [],
      associations: [],
      activeWorkspaceId: null,
    };

    registerAppStateIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      createAppStateStoreStub({
        fullResetAppState: async () => ({ status: "ready", snapshot, notice: "full-reset" }),
      }),
      { status: "ready", snapshot, notice: "legacy-reset" },
      preserveAppStateResult,
    );

    expect(await handlers.get("app-state:load")?.({})).toEqual({
      status: "ready",
      snapshot,
      notice: "legacy-reset",
    });
    expect(await handlers.get("app-state:load")?.({})).toEqual({ status: "ready", snapshot });
    expect(await handlers.get("app-state:full-reset")?.({})).toEqual({
      status: "ready",
      snapshot,
      notice: "full-reset",
    });
    expect(await handlers.get("app-state:load")?.({})).toEqual({ status: "ready", snapshot });
  });

  for (const recoveryChannel of ["app-state:reread", "app-state:full-reset"] as const) {
    it(`keeps normal IPC blocked until ${recoveryChannel} preparation completes`, async () => {
      const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
      const initialResult: AppStateLoadResult = {
        status: "recovery-required",
        diagnostics: [],
      };
      let finishPreparation: (() => void) | undefined;
      const preparation = new Promise<void>((resolve) => {
        finishPreparation = resolve;
      });
      const gate = createAppStateIpcGate(
        {
          handle: (channel: string, listener: (event: unknown, ...args: unknown[]) => unknown) =>
            handlers.set(channel, listener),
          on() {},
        },
        initialResult,
      );

      registerAppStateIpc(
        gate.ipcMain,
        createAppStateStoreStub({
          initializeAppState: async () => readyAppStateResult,
          fullResetAppState: async () => readyAppStateResult,
        }),
        initialResult,
        async (result) => {
          await preparation;
          gate.update(result);
          return result;
        },
      );

      const recoveryRequest = Promise.resolve(handlers.get(recoveryChannel)?.({}));
      expect(
        String(await caughtError(() => handlers.get("provider-sessions:load")?.({}))),
      ).toContain("App State recovery is required");

      finishPreparation?.();
      expect(await recoveryRequest).toEqual(readyAppStateResult);
      expect(await handlers.get("provider-sessions:load")?.({})).toEqual({
        version: 1,
        sessions: {},
      });
    });
  }

  it("returns and caches the authoritative App State produced by reread recovery", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const staleResult: AppStateLoadResult = {
      status: "ready",
      snapshot: createEmptyAppStateSnapshot(),
    };
    const authoritativeResult: AppStateLoadResult = {
      status: "ready",
      snapshot: {
        ...createEmptyAppStateSnapshot(),
        workspaces: [{ id: "workspace-restored", name: "Restored", order: 0 }],
        activeWorkspaceId: "workspace-restored",
      },
    };

    registerAppStateIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      createAppStateStoreStub({ initializeAppState: async () => staleResult }),
      { status: "recovery-required", diagnostics: [] },
      async (result, source) => {
        expect(result).toEqual(staleResult);
        expect(source).toBe("reread");
        return authoritativeResult;
      },
    );

    expect(await handlers.get("app-state:reread")?.({})).toEqual(authoritativeResult);
    expect(await handlers.get("app-state:load")?.({})).toEqual(authoritativeResult);
  });

  it("provider-sessions:load returns sessions from store", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const sessions: ProviderSessionSnapshot = { version: 1, sessions: { k1: "s1" } };

    registerAppStateIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      createAppStateStoreStub({
        loadProviderSessions: async () => sessions,
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );

    const result = await handlers.get("provider-sessions:load")?.({});
    expect(result).toEqual(sessions);
  });
});
