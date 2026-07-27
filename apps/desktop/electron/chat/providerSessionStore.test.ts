import { describe, expect, it } from "bun:test";
import { createPersistentProviderSessionStore } from "./providerSessionStore";
import type { ProviderSessionSnapshot } from "../../src/shared/workspacePersistence";

function snapshot(sessions: Record<string, string> = {}): ProviderSessionSnapshot {
  return { version: 1, sessions };
}

async function waitForSavedCount(saved: ProviderSessionSnapshot[], count: number) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (saved.length >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("createPersistentProviderSessionStore", () => {
  it("serializes concurrent writes without dropping sessions", async () => {
    const saved: ProviderSessionSnapshot[] = [];
    const blockers: Array<() => void> = [];
    const store = createPersistentProviderSessionStore(
      {
        saveProviderSessions: async (nextSnapshot) => {
          saved.push(nextSnapshot);
          await new Promise<void>((resolve) => blockers.push(resolve));
        },
      },
      snapshot({ existing: "session-existing" }),
    );

    const firstWrite = store.set("thread-a", "session-a");
    const secondWrite = store.set("thread-b", "session-b");
    await waitForSavedCount(saved, 1);

    expect(saved).toEqual([
      { version: 1, sessions: { existing: "session-existing", "thread-a": "session-a" } },
    ]);

    blockers.shift()?.();
    await waitForSavedCount(saved, 2);
    expect(saved).toEqual([
      { version: 1, sessions: { existing: "session-existing", "thread-a": "session-a" } },
      {
        version: 1,
        sessions: {
          existing: "session-existing",
          "thread-a": "session-a",
          "thread-b": "session-b",
        },
      },
    ]);

    blockers.shift()?.();
    await Promise.all([firstWrite, secondWrite]);
    expect(store.get("thread-a")).toBe("session-a");
    expect(store.get("thread-b")).toBe("session-b");
  });

  it("does not delete a newer session when clearing a stale session id", async () => {
    const saved: ProviderSessionSnapshot[] = [];
    const store = createPersistentProviderSessionStore(
      {
        saveProviderSessions: async (nextSnapshot) => {
          saved.push(nextSnapshot);
        },
      },
      snapshot({ "thread-a": "session-new" }),
    );

    await store.delete?.("thread-a", "session-old");

    expect(saved).toEqual([]);
    expect(store.get("thread-a")).toBe("session-new");
  });

  it("isolates one invalid runtime and thread mapping when it is read", async () => {
    const saved: ProviderSessionSnapshot[] = [];
    const store = createPersistentProviderSessionStore(
      {
        saveProviderSessions: async (nextSnapshot) => {
          saved.push(nextSnapshot);
        },
      },
      snapshot({
        "kimi:thread-a": "session-a",
        "kimi:thread-b": "",
        "kimi:project:/tmp/project:thread-c": "session-c",
        "claude-code:thread-b": "claude-session-b",
      }),
    );

    expect(store.get("kimi:thread-b")).toBeUndefined();
    expect(store.consumeInvalidMappingNotice?.("kimi:thread-b")).toBe(true);
    expect(store.consumeInvalidMappingNotice?.("kimi:thread-b")).toBe(false);
    expect(store.get("kimi:thread-c")).toBeUndefined();
    expect(store.consumeInvalidMappingNotice?.("kimi:thread-c")).toBe(true);
    expect(store.get("kimi:thread-a")).toBe("session-a");
    expect(store.get("claude-code:thread-b")).toBe("claude-session-b");

    await waitForSavedCount(saved, 2);
    expect(saved.at(-1)).toEqual(
      snapshot({
        "kimi:thread-a": "session-a",
        "claude-code:thread-b": "claude-session-b",
      }),
    );
  });

  it("keeps memory unchanged when persistence fails", async () => {
    const store = createPersistentProviderSessionStore(
      {
        saveProviderSessions: async () => {
          throw new Error("disk full");
        },
      },
      snapshot({ "thread-a": "session-old" }),
    );

    let error: unknown;
    try {
      await store.set("thread-a", "session-new");
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof Error).toBe(true);
    expect((error as Error).message).toBe("disk full");
    expect(store.get("thread-a")).toBe("session-old");
  });

  it("deletes every provider session for requested threads", async () => {
    const saved: ProviderSessionSnapshot[] = [];
    const store = createPersistentProviderSessionStore(
      {
        saveProviderSessions: async (nextSnapshot) => {
          saved.push(nextSnapshot);
        },
      },
      snapshot({
        "kimi:thread-a": "kimi-session",
        "claude-code:thread-a": "claude-session",
        "kimi:thread-ab": "unrelated-suffix",
        "kimi:thread-b": "unrelated-thread",
      }),
    );

    await store.deleteThreads?.(["thread-a", "thread-a"]);

    expect(saved).toEqual([
      {
        version: 1,
        sessions: {
          "kimi:thread-ab": "unrelated-suffix",
          "kimi:thread-b": "unrelated-thread",
        },
      },
    ]);
    expect(store.get("kimi:thread-a")).toBeUndefined();
    expect(store.get("kimi:thread-b")).toBe("unrelated-thread");
  });

  it("restores provider sessions when a destructive operation rolls back", async () => {
    const saved: ProviderSessionSnapshot[] = [];
    const key = "kimi:thread-a";
    const store = createPersistentProviderSessionStore(
      {
        saveProviderSessions: async (nextSnapshot) => {
          saved.push(nextSnapshot);
        },
      },
      snapshot({ [key]: "session-a", "kimi:thread-b": "session-b" }),
    );

    const removed = await store.deleteThreads?.(["thread-a"]);
    await store.restoreThreads?.(removed ?? {});

    expect(saved.at(-1)).toEqual(
      snapshot({ [key]: "session-a", "kimi:thread-b": "session-b" }),
    );
    expect(store.get(key)).toBe("session-a");
  });

  it("keeps memory unchanged when bulk deletion persistence fails", async () => {
    const key = "kimi:thread-a";
    const store = createPersistentProviderSessionStore(
      {
        saveProviderSessions: async () => {
          throw new Error("disk full");
        },
      },
      snapshot({ [key]: "session-old" }),
    );

    let error: unknown;
    try {
      await store.deleteThreads?.(["thread-a"]);
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof Error ? error.message : String(error)).toBe("disk full");
    expect(store.get(key)).toBe("session-old");
  });
});
