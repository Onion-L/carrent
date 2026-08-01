import { describe, expect, it } from "bun:test";
import { createAppStateAuthority } from "./appStateAuthority";
import { createAppStateFlush } from "./appStateFlush";
import { createEmptyAppStateSnapshot } from "../../src/shared/workspacePersistence";
import { createAppStateStoreStub } from "./appStateStore.testUtils";

function createHarness() {
  const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
  const sent: Array<{ subscriberId: number }> = [];
  const saved: unknown[] = [];
  const authority = createAppStateAuthority({
    store: createAppStateStoreStub({
      saveAppStateSnapshot: async (snapshot) => {
        saved.push(snapshot);
      },
    }),
    initialResult: { status: "ready", snapshot: createEmptyAppStateSnapshot() },
    reducers: {
      "add-workspace": addWorkspace,
    },
    publish: () => {},
  });
  const flush = createAppStateFlush(
    {
      handle(channel, listener) {
        handlers.set(channel, listener);
      },
    },
    authority,
    (subscriberId) => ({
      isDestroyed: () => false,
      send: () => {
        sent.push({ subscriberId });
      },
    }),
  );
  return { handlers, sent, saved, authority, flush };
}

function addWorkspace(snapshot: ReturnType<typeof createEmptyAppStateSnapshot>, payload: unknown) {
  return {
    ...snapshot,
    workspaces: [
      ...snapshot.workspaces,
      {
        id: `workspace-${snapshot.workspaces.length + 1}`,
        name: String((payload as { name?: unknown })?.name ?? "W"),
        order: snapshot.workspaces.length,
      },
    ],
  };
}

describe("createAppStateFlush", () => {
  it("notifies subscribers, waits for their acknowledgements, and drains the queue", async () => {
    const { handlers, sent, saved, authority, flush } = createHarness();
    authority.subscribe(1);
    authority.subscribe(2);

    const pending = flush.flush();
    // The flush only settles after both subscribers acknowledge.
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sent).toEqual([{ subscriberId: 1 }, { subscriberId: 2 }]);
    expect(settled).toBe(false);

    // A renderer flushes its pending command, then acknowledges.
    const submitted = authority.submit(1, {
      commandId: "cmd-1",
      type: "add-workspace",
      payload: { name: "Core" },
    });
    await handlers.get("app-state:flush-done")?.({ sender: { id: 1 } });
    await handlers.get("app-state:flush-done")?.({ sender: { id: 2 } });
    await pending;

    expect(settled).toBe(true);
    expect(await submitted).toMatchObject({ status: "accepted" });
    expect(saved).toHaveLength(1);
  });

  it("settles without subscribers and still drains the authority queue", async () => {
    const { sent, saved, authority, flush } = createHarness();
    const submitted = authority.submit(1, {
      commandId: "cmd-1",
      type: "add-workspace",
      payload: { name: "Core" },
    });

    await flush.flush();

    expect(sent).toEqual([]);
    expect(await submitted).toMatchObject({ status: "accepted" });
    expect(saved).toHaveLength(1);
  });
});
