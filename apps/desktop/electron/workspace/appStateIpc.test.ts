import { describe, expect, it } from "bun:test";
import {
  clearStagedAppStateSnapshot,
  getStagedAppStateSnapshot,
  registerAppStateIpc,
  setAppStateTransactionActive,
} from "./appStateIpc";
import {
  createEmptyAppStateSnapshot,
  type AppStateLoadResult,
  type ProviderSessionSnapshot,
  type AppStateSnapshot,
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
      "app-state:save",
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

  it("app-state:save validates and forwards the snapshot to the store", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const saved: AppStateSnapshot[] = [];
    const snapshot: AppStateSnapshot = {
      version: 1,
      workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
      projects: [],
      associations: [],
      activeWorkspaceId: "workspace-1",
    };

    registerAppStateIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      createAppStateStoreStub({
        saveAppStateSnapshot: async (value) => {
          saved.push(value);
        },
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );

    await handlers.get("app-state:save")?.({}, snapshot);
    expect(saved).toEqual([snapshot]);

    let saveError: unknown;
    try {
      handlers.get("app-state:save")?.(
        {},
        {
          ...snapshot,
          workspaces: [{ id: "workspace-1", name: " ", order: 0 }],
        },
      );
    } catch (error) {
      saveError = error;
    }
    expect(String(saveError)).toContain("Invalid App State snapshot");
  });

  it("rejects App State image attachments without an explicit kind before saving", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    let saveCalls = 0;
    const snapshot = {
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
          title: "Attachment schema",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
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
          content: "Inspect this image",
          createdAt: "2026-07-27T08:00:00.000Z",
          attachments: [
            {
              id: "attachment-1",
              name: "screen.png",
              mimeType: "image/png",
              size: 10,
              storageKey: "attachment-1.png",
            },
          ],
        },
      ],
      activeWorkspaceId: "workspace-1",
    };

    registerAppStateIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      createAppStateStoreStub({
        saveAppStateSnapshot: async () => {
          saveCalls += 1;
        },
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );

    let saveError: unknown;
    try {
      handlers.get("app-state:save")?.({}, snapshot);
    } catch (error) {
      saveError = error;
    }

    expect(String(saveError)).toContain("Invalid App State snapshot");
    expect(saveCalls).toBe(0);
  });

  it("blocks independent App State writes during a Thread deletion transaction", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const saved: AppStateSnapshot[] = [];
    const snapshot = createEmptyAppStateSnapshot();
    registerAppStateIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      createAppStateStoreStub({
        saveAppStateSnapshot: async (next) => {
          saved.push(next);
        },
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );

    setAppStateTransactionActive(true);
    let saveError: unknown;
    try {
      await handlers.get("app-state:save")?.({}, snapshot);
    } catch (error) {
      saveError = error;
    } finally {
      setAppStateTransactionActive(false);
    }

    expect(String(saveError)).toContain("App State transaction is in progress");
    expect(saved).toHaveLength(0);
  });

  it("stages the latest valid App State for shutdown and clears it after a durable save", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => void>();
    const snapshot = createEmptyAppStateSnapshot();

    registerAppStateIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
        on: (channel, listener) => listeners.set(channel, listener),
      },
      createAppStateStoreStub(),
      readyAppStateResult,
      preserveAppStateResult,
    );

    listeners.get("app-state:stage")?.({}, snapshot);
    expect(getStagedAppStateSnapshot()).toEqual(snapshot);

    await handlers.get("app-state:save")?.({}, snapshot);
    expect(getStagedAppStateSnapshot()).toBe(null);
    clearStagedAppStateSnapshot();
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
