import { describe, expect, it } from "bun:test";
import {
  createAppStateAuthority,
  registerAppStateAuthorityIpc,
  type AppStateAuthorityState,
  type AppStateCommand,
} from "./appStateAuthority";
import {
  createEmptyAppStateSnapshot,
  type AppStateDiagnostic,
  type AppStateLoadResult,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { createAppStateStoreStub } from "./appStateStore.testUtils";

const readyResult = (snapshot: AppStateSnapshot = createEmptyAppStateSnapshot()) =>
  ({ status: "ready", snapshot }) satisfies AppStateLoadResult;

const recoveryDiagnostic: AppStateDiagnostic = {
  appVersion: "0.0.0",
  subsystem: "app-state",
  stage: "parse",
  summary: "malformed",
  dataPath: "/tmp/app-state.json",
  occurredAt: "2026-07-27T08:00:00.000Z",
};

const recoveryResult = (): AppStateLoadResult => ({
  status: "recovery-required",
  diagnostics: [recoveryDiagnostic],
});

function command(partial: Partial<AppStateCommand> = {}): AppStateCommand {
  return { commandId: "cmd-1", type: "add-workspace", payload: { name: "Core" }, ...partial };
}

const addWorkspaceReducer = (snapshot: AppStateSnapshot, payload: unknown) => {
  const name =
    typeof payload === "object" && payload !== null
      ? (payload as { name?: unknown }).name
      : undefined;
  if (typeof name !== "string" || name.length === 0) return null;
  return {
    ...snapshot,
    workspaces: [
      ...snapshot.workspaces,
      {
        id: `workspace-${snapshot.workspaces.length + 1}`,
        name,
        order: snapshot.workspaces.length,
      },
    ],
  };
};

function createHarness(
  options: {
    initialResult?: AppStateLoadResult;
    saveAppStateSnapshot?: (snapshot: AppStateSnapshot) => Promise<void>;
  } = {},
) {
  const published: Array<{ subscriberId: number; state: AppStateAuthorityState }> = [];
  const saved: AppStateSnapshot[] = [];
  const authority = createAppStateAuthority({
    store: createAppStateStoreStub({
      saveAppStateSnapshot: async (snapshot) => {
        saved.push(snapshot);
        await options.saveAppStateSnapshot?.(snapshot);
      },
    }),
    initialResult: options.initialResult ?? readyResult(),
    reducers: { "add-workspace": addWorkspaceReducer },
    publish: (subscriberId, state) => {
      published.push({ subscriberId, state });
    },
  });
  return { authority, published, saved };
}

describe("createAppStateAuthority", () => {
  it("initializes authoritative state from the persisted ready result", () => {
    const snapshot = createEmptyAppStateSnapshot();
    const { authority } = createHarness({ initialResult: readyResult(snapshot) });

    expect(authority.getState()).toEqual({ revision: 0, snapshot });
  });

  it("serves the current revision and snapshot to a late subscriber", async () => {
    const { authority } = createHarness();
    authority.subscribe(1);
    await authority.submit(1, command());

    const state = authority.subscribe(2);

    expect(state.revision).toBe(1);
    expect(state.snapshot.workspaces).toHaveLength(1);
  });

  it("accepts a command, advances the revision, persists, and broadcasts to every subscriber", async () => {
    const { authority, published, saved } = createHarness();
    authority.subscribe(1);
    authority.subscribe(2);

    const result = await authority.submit(1, command({ payload: { name: "Core" } }));

    expect(result).toEqual({ status: "accepted", revision: 1 });
    expect(saved).toHaveLength(1);
    expect(saved[0].workspaces[0]?.name).toBe("Core");
    expect(published).toHaveLength(2);
    expect(published[0]).toEqual({
      subscriberId: 1,
      state: { revision: 1, snapshot: saved[0] },
    });
    expect(published[1]).toEqual({
      subscriberId: 2,
      state: { revision: 1, snapshot: saved[0] },
    });
  });

  it("does not apply a retried command twice", async () => {
    const { authority, published, saved } = createHarness();
    authority.subscribe(1);

    const first = await authority.submit(1, command({ payload: { name: "Core" } }));
    const retry = await authority.submit(1, command({ payload: { name: "Core" } }));

    expect(first).toEqual({ status: "accepted", revision: 1 });
    expect(retry).toEqual({ status: "rejected", reason: "duplicate", revision: 1 });
    expect(authority.getState().snapshot.workspaces).toHaveLength(1);
    expect(saved).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  it("rejects a stale command without mutating state and returns the latest revision", async () => {
    const { authority, published, saved } = createHarness();
    authority.subscribe(1);
    await authority.submit(1, command({ payload: { name: "Core" } }));

    const stale = await authority.submit(
      2,
      command({ commandId: "cmd-2", payload: { name: "Stale" }, baseRevision: 0 }),
    );

    expect(stale).toEqual({ status: "rejected", reason: "stale", revision: 1 });
    expect(authority.getState().snapshot.workspaces.map((w) => w.name)).toEqual(["Core"]);
    expect(saved).toHaveLength(1);
    expect(published).toHaveLength(1);
  });

  it("accepts a command whose base revision matches the current revision", async () => {
    const { authority } = createHarness();
    await authority.submit(1, command({ payload: { name: "Core" } }));

    const result = await authority.submit(
      2,
      command({ commandId: "cmd-2", payload: { name: "Second" }, baseRevision: 1 }),
    );

    expect(result).toEqual({ status: "accepted", revision: 2 });
    expect(authority.getState().snapshot.workspaces).toHaveLength(2);
  });

  it("rejects an unknown command type as invalid", async () => {
    const { authority, saved } = createHarness();

    const result = await authority.submit(1, command({ type: "unknown-command" }));

    expect(result).toMatchObject({ status: "rejected", reason: "invalid", revision: 0 });
    expect(saved).toHaveLength(0);
  });

  it("rejects a command whose reducer refuses the transition", async () => {
    const { authority, saved } = createHarness();

    const result = await authority.submit(1, command({ payload: { name: "" } }));

    expect(result).toEqual({ status: "rejected", reason: "invalid", revision: 0 });
    expect(saved).toHaveLength(0);
  });

  it("rejects malformed command envelopes as invalid", async () => {
    const { authority, saved } = createHarness();

    const missingId = await authority.submit(1, command({ commandId: "" }));
    const missingType = await authority.submit(1, command({ type: "" }));

    expect(missingId).toMatchObject({ status: "rejected", reason: "invalid", revision: 0 });
    expect(missingType).toMatchObject({ status: "rejected", reason: "invalid", revision: 0 });
    expect(saved).toHaveLength(0);
  });

  it("keeps the previous state when persistence fails", async () => {
    const { authority, published } = createHarness({
      saveAppStateSnapshot: async () => {
        throw new Error("disk full");
      },
    });
    authority.subscribe(1);

    const result = await authority.submit(1, command({ payload: { name: "Core" } }));

    expect(result.status).toBe("rejected");
    expect(result).toMatchObject({ reason: "persistence-failed", revision: 0 });
    expect(authority.getState()).toEqual({
      revision: 0,
      snapshot: createEmptyAppStateSnapshot(),
    });
    expect(published).toHaveLength(0);
  });

  it("serializes concurrent commands against the latest accepted state", async () => {
    const { authority, published } = createHarness();
    authority.subscribe(1);

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        authority.submit(1, command({ commandId: `cmd-${index}`, payload: { name: `W${index}` } })),
      ),
    );

    expect(results.every((result) => result.status === "accepted")).toBe(true);
    expect(authority.getState().revision).toBe(10);
    expect(authority.getState().snapshot.workspaces).toHaveLength(10);
    expect(new Set(published.map((entry) => entry.state.revision)).size).toBe(10);
    expect(published.map((entry) => entry.state.revision)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("rejects commands while recovery is required", async () => {
    const { authority, saved } = createHarness({ initialResult: recoveryResult() });

    const result = await authority.submit(1, command());

    expect(result).toEqual({ status: "rejected", reason: "unavailable", revision: 0 });
    expect(saved).toHaveLength(0);
  });

  it("rejects commands while an App State transaction is active", async () => {
    const { authority, saved } = createHarness();
    authority.setTransactionActive(true);

    const blocked = await authority.submit(1, command());

    expect(blocked).toEqual({ status: "rejected", reason: "unavailable", revision: 0 });
    expect(saved).toHaveLength(0);

    authority.setTransactionActive(false);
    const after = await authority.submit(1, command({ commandId: "cmd-2" }));
    expect(after).toEqual({ status: "accepted", revision: 1 });
  });

  it("replaces state from a reread or full reset without resetting the revision", async () => {
    const { authority } = createHarness();
    await authority.submit(1, command({ payload: { name: "Core" } }));

    const replacement = createEmptyAppStateSnapshot();
    authority.replaceState(readyResult(replacement));

    expect(authority.getState()).toEqual({ revision: 1, snapshot: replacement });

    authority.replaceState(recoveryResult());
    const blocked = await authority.submit(1, command({ commandId: "cmd-2" }));
    expect(blocked).toEqual({ status: "rejected", reason: "unavailable", revision: 1 });
  });

  it("stops broadcasting to an unsubscribed client", async () => {
    const { authority, published } = createHarness();
    authority.subscribe(1);
    authority.subscribe(2);
    authority.unsubscribe(2);

    await authority.submit(1, command());

    expect(published.map((entry) => entry.subscriberId)).toEqual([1]);
  });

  it("adopts an externally saved snapshot, bumps the revision, and broadcasts", () => {
    const { authority, published } = createHarness();
    authority.subscribe(1);
    authority.subscribe(2);

    const external = {
      ...createEmptyAppStateSnapshot(),
      workspaces: [{ id: "workspace-1", name: "External", order: 0 }],
      activeWorkspaceId: "workspace-1",
    };
    authority.adoptExternalSnapshot(external);

    expect(authority.getState()).toEqual({ revision: 1, snapshot: external });
    expect(published).toEqual([
      { subscriberId: 1, state: { revision: 1, snapshot: external } },
      { subscriberId: 2, state: { revision: 1, snapshot: external } },
    ]);
  });

  it("ignores external snapshots while recovery is required", () => {
    const { authority, published } = createHarness({ initialResult: recoveryResult() });
    authority.subscribe(1);

    authority.adoptExternalSnapshot(createEmptyAppStateSnapshot());

    expect(authority.getState().revision).toBe(0);
    expect(published).toHaveLength(0);
  });

  it("bounds the remembered command identities", async () => {
    const { authority } = createHarness();
    for (let index = 0; index < 1100; index += 1) {
      await authority.submit(
        1,
        command({ commandId: `cmd-${index}`, payload: { name: `W${index}` } }),
      );
    }

    const replayed = await authority.submit(
      1,
      command({ commandId: "cmd-0", payload: { name: "W1100" } }),
    );

    expect(replayed.status).toBe("accepted");
  });
});

describe("registerAppStateAuthorityIpc", () => {
  function createIpcHarness() {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const published: Array<{ subscriberId: number; state: AppStateAuthorityState }> = [];
    const authority = createAppStateAuthority({
      store: createAppStateStoreStub(),
      initialResult: readyResult(),
      reducers: { "add-workspace": addWorkspaceReducer },
      publish: (subscriberId, state) => {
        published.push({ subscriberId, state });
      },
    });
    registerAppStateAuthorityIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      authority,
    );
    return { handlers, authority, published };
  }

  it("registers subscribe, unsubscribe, and command channels", () => {
    const { handlers } = createIpcHarness();

    expect([...handlers.keys()].sort()).toEqual([
      "app-state:command",
      "app-state:subscribe",
      "app-state:unsubscribe",
    ]);
  });

  it("lets two renderer clients subscribe and submit commands", async () => {
    const { handlers, published } = createIpcHarness();
    const windowA = { sender: { id: 11 } };
    const windowB = { sender: { id: 22 } };

    const stateA = await handlers.get("app-state:subscribe")?.(windowA);
    const stateB = await handlers.get("app-state:subscribe")?.(windowB);
    expect(stateA).toEqual({ revision: 0, snapshot: createEmptyAppStateSnapshot() });
    expect(stateB).toEqual(stateA);

    const accepted = await handlers.get("app-state:command")?.(
      windowA,
      command({ payload: { name: "Core" } }),
    );
    expect(accepted).toEqual({ status: "accepted", revision: 1 });

    const duplicate = await handlers.get("app-state:command")?.(
      windowB,
      command({ payload: { name: "Core" } }),
    );
    expect(duplicate).toEqual({ status: "rejected", reason: "duplicate", revision: 1 });

    expect(published.map((entry) => entry.subscriberId)).toEqual([11, 22]);

    await handlers.get("app-state:unsubscribe")?.(windowB);
    await handlers.get("app-state:command")?.(
      windowA,
      command({ commandId: "cmd-2", payload: { name: "Second" } }),
    );
    expect(published.map((entry) => entry.subscriberId)).toEqual([11, 22, 11]);
  });

  it("rejects commands from senders without an identity", async () => {
    const { handlers } = createIpcHarness();

    let thrown: unknown = null;
    try {
      await handlers.get("app-state:command")?.({}, command());
    } catch (error) {
      thrown = error;
    }

    expect(thrown instanceof Error).toBe(true);
  });
});
