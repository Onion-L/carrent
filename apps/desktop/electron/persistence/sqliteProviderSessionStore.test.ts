import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";
import {
  createSqliteProviderSessionStore,
  type SqliteProviderSessionStore,
} from "./sqliteProviderSessionStore";
import {
  deleteProviderSessionByKey,
  readProviderSessions,
  replaceProviderSessions,
} from "./providerSessionRepository";
import type { ProviderSessionSnapshot } from "../../src/shared/workspacePersistence";

function snapshot(sessions: Record<string, string> = {}): ProviderSessionSnapshot {
  return { version: 1, sessions };
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "carrent-sqlite-provider-"));
}

async function reloadFromDisk(
  dir: string,
): Promise<{ sqlite: ReturnType<typeof createSqliteAppStateStore>; store: SqliteProviderSessionStore }> {
  // The production reload path reads the persisted mappings from SQLite and
  // hands them to a fresh store as the seed snapshot. Reconstructing the same
  // path here proves the store is round-trippable across restarts.
  const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
    driver: bunSqliteDriver,
  });
  await sqlite.open();
  const sessions = await sqlite.run((client) => readProviderSessions(client));
  const store = createSqliteProviderSessionStore(sqlite, snapshot(sessions));
  return { sqlite, store };
}

describe("createSqliteProviderSessionStore", () => {
  it("persists sets across close and reopen so a fresh store resumes the mappings", async () => {
    const dir = await makeTempDir();
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await sqlite.open();
      const store = createSqliteProviderSessionStore(sqlite, snapshot());
      await store.set("kimi:thread-a", "session-a");
      await store.set("kimi:thread-b", "session-b");
      await sqlite.waitForIdle();
      await sqlite.close();

      const reopened = await reloadFromDisk(dir);
      expect(reopened.store.get("kimi:thread-a")).toBe("session-a");
      expect(reopened.store.get("kimi:thread-b")).toBe("session-b");
      await reopened.sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("isolates invalid mappings (empty session id and inconsistent legacy key) without blocking others", async () => {
    const dir = await makeTempDir();
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await sqlite.open();
      const seed = snapshot({
        "kimi:thread-a": "session-a",
        "kimi:thread-b": "",
        "kimi:project:/tmp/project:thread-c": "session-c",
      });
      // Persist the seed — including the invalid rows — so the store reflects
      // what a real reload sees: the database is authoritative, the cache is
      // seeded from it, and the read path isolates the bad rows.
      await sqlite.run((client) => replaceProviderSessions(client, seed.sessions));
      const store = createSqliteProviderSessionStore(sqlite, seed);

      // An empty session id is detached and noticed once.
      expect(store.get("kimi:thread-b")).toBeUndefined();
      expect(store.consumeInvalidMappingNotice?.("kimi:thread-b")).toBe(true);
      expect(store.consumeInvalidMappingNotice?.("kimi:thread-b")).toBe(false);

      // An inconsistent legacy key for the same runtime+thread is also detached.
      expect(store.get("kimi:thread-c")).toBeUndefined();
      expect(store.consumeInvalidMappingNotice?.("kimi:thread-c")).toBe(true);

      // The valid mapping is untouched.
      expect(store.get("kimi:thread-a")).toBe("session-a");

      // The invalid rows are removed from the database on the shared queue.
      await sqlite.waitForIdle();
      const persisted = await sqlite.run((client) => readProviderSessions(client));
      expect(persisted).toEqual({ "kimi:thread-a": "session-a" });
      await sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the in-memory cache unchanged when a set persistence fails", async () => {
    const dir = await makeTempDir();
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await sqlite.open();
      const store = createSqliteProviderSessionStore(
        sqlite,
        snapshot({ "kimi:thread-a": "session-old" }),
      );
      // Closing the connection makes every subsequent queued run reject,
      // simulating a database failure without coupling the test to driver
      // internals.
      await sqlite.close();

      let error: unknown;
      try {
        await store.set("kimi:thread-a", "session-new");
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error).toBe(true);
      // The cache was not advanced to the new value because the write did not commit.
      expect(store.get("kimi:thread-a")).toBe("session-old");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes interleaved set and delete so a stale snapshot cannot resurrect a deleted mapping", async () => {
    const dir = await makeTempDir();
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await sqlite.open();
      const store = createSqliteProviderSessionStore(sqlite, snapshot());
      await store.set("kimi:thread-a", "session-a");
      await sqlite.waitForIdle();

      // Interleave a set, a conditional delete of the older session, and another
      // set. The unified queue serializes them; a stale full-snapshot write can
      // no longer bring back the older session id.
      await Promise.all([
        store.set("kimi:thread-a", "session-new"),
        store.delete?.("kimi:thread-a", "session-a"),
        store.set("kimi:thread-b", "session-b"),
      ]);
      await sqlite.waitForIdle();

      expect(store.get("kimi:thread-a")).toBe("session-new");
      expect(store.get("kimi:thread-b")).toBe("session-b");
      await sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not delete a newer session when clearing a stale session id", async () => {
    const dir = await makeTempDir();
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await sqlite.open();
      const seed = snapshot({ "kimi:thread-a": "session-new" });
      await sqlite.run((client) => replaceProviderSessions(client, seed.sessions));
      const store = createSqliteProviderSessionStore(sqlite, seed);
      await store.delete?.("kimi:thread-a", "session-old");
      await sqlite.waitForIdle();
      expect(store.get("kimi:thread-a")).toBe("session-new");

      // The newer row survived the stale delete.
      const persisted = await sqlite.run((client) => readProviderSessions(client));
      expect(persisted).toEqual({ "kimi:thread-a": "session-new" });
      await sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deletes every provider session for requested threads and restores on rollback", async () => {
    const dir = await makeTempDir();
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await sqlite.open();
      const store = createSqliteProviderSessionStore(
        sqlite,
        snapshot({
          "kimi:thread-a": "kimi-session",
          "kimi:thread-ab": "unrelated-suffix",
          "kimi:thread-b": "unrelated-thread",
        }),
      );

      const removed = (await store.deleteThreads?.(["thread-a", "thread-a"])) ?? {};
      expect(removed).toEqual({ "kimi:thread-a": "kimi-session" });
      expect(store.get("kimi:thread-a")).toBeUndefined();
      expect(store.get("kimi:thread-ab")).toBe("unrelated-suffix");
      expect(store.get("kimi:thread-b")).toBe("unrelated-thread");

      // A destructive operation rolls back: the removed mappings come back.
      await store.restoreThreads?.(removed);
      expect(store.get("kimi:thread-a")).toBe("kimi-session");
      await sqlite.waitForIdle();
      await sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reinitializes mappings after a Full Reset and only persists the new set", async () => {
    const dir = await makeTempDir();
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await sqlite.open();
      const store = createSqliteProviderSessionStore(
        sqlite,
        snapshot({ "kimi:thread-a": "session-old" }),
      );
      await store.reinitialize(snapshot());
      await store.set("kimi:thread-b", "session-new");
      await sqlite.waitForIdle();

      expect(store.get("kimi:thread-a")).toBeUndefined();
      expect(store.get("kimi:thread-b")).toBe("session-new");

      const persisted = await sqlite.run((client) => readProviderSessions(client));
      expect(persisted).toEqual({ "kimi:thread-b": "session-new" });
      await sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("joins a caller-owned transaction without creating a nested transaction", async () => {
    const dir = await makeTempDir();
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await sqlite.open();
      const store = createSqliteProviderSessionStore(
        sqlite,
        snapshot({ "kimi:thread-a": "session-a" }),
      );
      // Persist the seed so the rollback assertion is meaningful — the row must
      // exist in the database before the caller-owned transaction deletes it.
      await store.reinitialize(snapshot({ "kimi:thread-a": "session-a" }));

      // A top-level command owns the transaction and deletes a mapping inside
      // it alongside an unrelated write. The repository calls run inline under
      // the outer transaction; a rollback undoes both. If the repository had
      // started its own transaction, the rollback would still leave its row
      // deleted.
      let threw = false;
      try {
        await sqlite.run((client) =>
          client.transaction(() => {
            deleteProviderSessionByKey(client, "kimi:thread-a");
            client.run(
              "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
              "touched",
              "1",
            );
            throw new Error("command rolled back");
          }),
        );
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);

      // The mapping survived because the whole transaction rolled back together.
      expect(store.get("kimi:thread-a")).toBe("session-a");
      const persisted = await sqlite.run((client) => ({
        sessions: readProviderSessions(client),
        touched: client.get<{ value: string }>(
          "SELECT value FROM app_metadata WHERE key = ?",
          "touched",
        ),
      }));
      expect(persisted.sessions).toEqual({ "kimi:thread-a": "session-a" });
      expect(persisted.touched === null).toBe(true);
      await sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back the whole batch delete when the database fails mid-operation so the cache and database never diverge", async () => {
    const dir = await makeTempDir();
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await sqlite.open();
      const seed = snapshot({
        "kimi:thread-a": "session-a",
        "kimi:thread-b": "session-b",
      });
      await sqlite.run((client) => replaceProviderSessions(client, seed.sessions));

      // Inject a mid-batch failure: wrap the client's `run` so the second
      // provider-session DELETE throws. The repository issues one DELETE per
      // removed mapping inside one transaction, so the first DELETE must roll
      // back with the failed second one — neither the database nor the cache
      // loses a mapping the caller still observes.
      let deleteCount = 0;
      const wrappedStore: typeof sqlite = {
        ...sqlite,
        run: ((work) =>
          sqlite.run((client) => {
            const originalRun = client.run.bind(client);
            const failingClient = {
              ...client,
              run: (sql: string, ...params: Parameters<typeof originalRun>[1][]) => {
                if (
                  typeof sql === "string" &&
                  sql.startsWith("DELETE FROM provider_sessions")
                ) {
                  deleteCount += 1;
                  if (deleteCount === 2) {
                    throw new Error("simulated mid-batch disk fault");
                  }
                }
                return originalRun(sql, ...params);
              },
            };
            return work(failingClient);
          })) as typeof sqlite.run,
      };

      const store = createSqliteProviderSessionStore(wrappedStore, seed);
      let error: unknown;
      try {
        await store.deleteThreads?.(["thread-a", "thread-b"]);
      } catch (caught) {
        error = caught;
      }
      expect(error instanceof Error ? error.message : String(error)).toBe(
        "simulated mid-batch disk fault",
      );

      // Both mappings survived in memory and on disk because the batch was one
      // transaction: a partial commit would have left one thread deleted while
      // the cache still showed it (or vice versa).
      expect(store.get("kimi:thread-a")).toBe("session-a");
      expect(store.get("kimi:thread-b")).toBe("session-b");
      const persisted = await sqlite.run((client) => readProviderSessions(client));
      expect(persisted).toEqual({ "kimi:thread-a": "session-a", "kimi:thread-b": "session-b" });
      await sqlite.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
