import { describe, expect, it } from "bun:test";
import {
  getLastWorkspaceSnapshot,
  registerWorkspaceIpc,
  setWorkspaceTransactionActive,
} from "./workspaceIpc";
import {
  createEmptyAppStateSnapshot,
  type AppStateLoadResult,
  type WorkspaceSnapshot,
  type ProviderSessionSnapshot,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { createWorkspaceStoreStub } from "./workspaceStore.testUtils";
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

describe("registerWorkspaceIpc", () => {
  it("registers App State, legacy workspace, and provider session channels", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on(channel, listener) {
          listeners.set(channel, listener);
        },
      },
      createWorkspaceStoreStub(),
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
      "workspace:load",
      "workspace:save",
    ]);
    expect([...listeners.keys()]).toEqual(["workspace:remember"]);
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

    registerWorkspaceIpc(
      { handle: (channel, listener) => handlers.set(channel, listener), on() {} },
      createWorkspaceStoreStub({
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

    registerWorkspaceIpc(
      { handle: (channel, listener) => handlers.set(channel, listener), on() {} },
      createWorkspaceStoreStub({
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

      registerWorkspaceIpc(
        gate.ipcMain,
        createWorkspaceStoreStub({
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
      expect(String(await caughtError(() => handlers.get("workspace:load")?.({})))).toContain(
        "App State recovery is required",
      );

      finishPreparation?.();
      expect(await recoveryRequest).toEqual(readyAppStateResult);
      expect(await handlers.get("workspace:load")?.({})).toBe(null);
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

    registerWorkspaceIpc(
      { handle: (channel, listener) => handlers.set(channel, listener), on() {} },
      createWorkspaceStoreStub({ initializeAppState: async () => staleResult }),
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

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on() {},
      },
      createWorkspaceStoreStub({
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

    registerWorkspaceIpc(
      { handle: (channel, listener) => handlers.set(channel, listener), on() {} },
      createWorkspaceStoreStub({
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

  it("workspace:load returns snapshot from store", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: null,
    };

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on() {},
      },
      createWorkspaceStoreStub({
        loadWorkspaceSnapshot: async () => snapshot,
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );

    const result = await handlers.get("workspace:load")?.({});
    expect(result).toEqual(snapshot);
  });

  it("workspace:save forwards snapshot to store", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const saved: WorkspaceSnapshot[] = [];
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      chats: [],
      messages: [],
      activeThreadId: null,
    };

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on() {},
      },
      createWorkspaceStoreStub({
        saveWorkspaceSnapshot: async (s) => {
          saved.push(s);
        },
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );

    await handlers.get("workspace:save")?.({}, snapshot);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(snapshot);
    expect(getLastWorkspaceSnapshot()).toEqual(snapshot);
  });

  it("does not replace the shutdown snapshot when workspace:save fails", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const before: WorkspaceSnapshot = {
      version: 1,
      projects: [{ id: "p1", name: "P1", path: "/tmp/p1", threads: [] }],
      chats: [],
      messages: [],
      activeThreadId: null,
    };
    const after: WorkspaceSnapshot = { ...before, projects: [] };

    registerWorkspaceIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
        on: (channel, listener) => listeners.set(channel, listener),
      },
      createWorkspaceStoreStub({
        saveWorkspaceSnapshot: async () => {
          throw new Error("disk full");
        },
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );
    listeners.get("workspace:remember")?.({}, before);

    let saveError: unknown;
    try {
      await handlers.get("workspace:save")?.({}, after);
    } catch (error) {
      saveError = error;
    }
    expect(String(saveError)).toContain("disk full");
    expect(getLastWorkspaceSnapshot()).toEqual(before);
  });

  it("blocks independent snapshot writes during a Thread deletion transaction", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const saved: WorkspaceSnapshot[] = [];
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [],
      chats: [],
      messages: [],
      activeThreadId: null,
    };
    registerWorkspaceIpc(
      { handle: (channel, listener) => handlers.set(channel, listener), on() {} },
      createWorkspaceStoreStub({
        saveWorkspaceSnapshot: async (next) => {
          saved.push(next);
        },
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );

    setWorkspaceTransactionActive(true);
    let saveError: unknown;
    try {
      await handlers.get("workspace:save")?.({}, snapshot);
    } catch (error) {
      saveError = error;
    } finally {
      setWorkspaceTransactionActive(false);
    }

    expect(String(saveError)).toContain("Workspace transaction is in progress");
    expect(saved).toHaveLength(0);
  });

  it("workspace:remember updates the latest snapshot without writing to disk", () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const saved: WorkspaceSnapshot[] = [];
    const snapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [{ id: "p2", name: "P2", path: "/tmp/p2", threads: [] }],
      chats: [],
      messages: [],
      activeThreadId: null,
    };

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on(channel, listener) {
          listeners.set(channel, listener);
        },
      },
      createWorkspaceStoreStub({
        saveWorkspaceSnapshot: async (s) => {
          saved.push(s);
        },
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );

    listeners.get("workspace:remember")?.({}, snapshot);
    expect(getLastWorkspaceSnapshot()).toEqual(snapshot);
    expect(saved).toHaveLength(0);
  });

  it("workspace:remember stores a normalized snapshot", () => {
    const listeners = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const snapshot = {
      version: 1,
      projects: [],
      chats: [],
      messages: [
        {
          id: "m1",
          role: "user",
          threadId: "t1",
          content: "",
          timestamp: "09:00",
          attachments: [
            {
              id: "a1",
              name: "screen.png",
              mimeType: "image/png",
              size: 10,
              storageKey: "a1.png",
              localPath: "/tmp/attachments/a1.png",
            },
          ],
        },
      ],
      activeThreadId: null,
    } as unknown as WorkspaceSnapshot;

    registerWorkspaceIpc(
      {
        handle() {},
        on(channel, listener) {
          listeners.set(channel, listener);
        },
      },
      createWorkspaceStoreStub(),
      readyAppStateResult,
      preserveAppStateResult,
    );

    listeners.get("workspace:remember")?.({}, snapshot);
    const attachment = (getLastWorkspaceSnapshot()!.messages[0] as { attachments?: unknown[] })
      .attachments![0] as Record<string, unknown>;
    expect("localPath" in attachment).toBe(false);
  });

  it("provider-sessions:load returns sessions from store", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const sessions: ProviderSessionSnapshot = { version: 1, sessions: { k1: "s1" } };

    registerWorkspaceIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
        on() {},
      },
      createWorkspaceStoreStub({
        loadProviderSessions: async () => sessions,
      }),
      readyAppStateResult,
      preserveAppStateResult,
    );

    const result = await handlers.get("provider-sessions:load")?.({});
    expect(result).toEqual(sessions);
  });
});
