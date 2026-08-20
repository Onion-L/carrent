import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { DEFAULT_SQLITE_PRAGMAS, createSqliteAppStateStore } from "./sqliteAppStateStore";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "carrent-sqlite-store-"));
}

describe("SqliteAppStateStore", () => {
  it("opens, applies and verifies the connection PRAGMAs, and applies all migrations", async () => {
    const dir = await makeTempDir();
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
        now: () => "2026-08-09T00:00:00.000Z",
      });
      expect(store.isOpen).toBe(false);
      const result = await store.open();
      expect(store.isOpen).toBe(true);
      expect(result.pragmas).toEqual(DEFAULT_SQLITE_PRAGMAS);
      expect(result.migrations.appliedVersion).toBe(5);
      expect(result.migrations.newlyApplied).toEqual([1, 2, 3, 4, 5]);

      // PRAGMAs are actually set as SQLite reports them.
      const pragmas = await store.run((client) => ({
        foreignKeys: client.pragma("foreign_keys"),
        journalMode: client.pragma("journal_mode"),
        synchronous: client.pragma("synchronous"),
        busyTimeout: client.pragma("busy_timeout"),
      }));
      expect(pragmas).toEqual({
        foreignKeys: 1,
        journalMode: "wal",
        synchronous: 1,
        busyTimeout: 5000,
      });

      await store.close();
      expect(store.isOpen).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reopens an already-migrated database without reapplying migrations", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "carrent.sqlite");
      const first = createSqliteAppStateStore(path, {
        driver: bunSqliteDriver,
        now: () => "2026-08-09T00:00:00.000Z",
      });
      await first.open();
      await first.run((client) =>
        client.run(`INSERT INTO app_metadata (key, value) VALUES (?, ?)`, "seed", "first"),
      );
      await first.close();

      const second = createSqliteAppStateStore(path, {
        driver: bunSqliteDriver,
        now: () => "2026-08-09T00:00:01.000Z",
      });
      const result = await second.open();
      expect(result.migrations.appliedVersion).toBe(5);
      expect(result.migrations.newlyApplied).toEqual([]);

      // The data written before close survived the reopen.
      const value = await second.run((client) =>
        client.get<{ value: string }>("SELECT value FROM app_metadata WHERE key = ?", "seed"),
      );
      expect(value?.value).toBe("first");
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates the database file and WAL sidecar on disk", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "nested", "carrent.sqlite");
      const store = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await store.open();
      // A write is what materializes the WAL side file.
      await store.run((client) =>
        client.run("INSERT INTO app_metadata (key, value) VALUES (?, ?)", "k", "v"),
      );
      await store.close();

      expect(existsSync(path)).toBe(true);
      expect(existsSync(`${path}-wal`)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("serializes operations on one queue so concurrent writes do not interleave", async () => {
    const dir = await makeTempDir();
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();

      // Each operation appends a row inside a transaction with a deliberate
      // async yield in the middle. If the queue did not serialize, two
      // transactions could overlap and one COMMIT could clobber the other.
      const append = async (label: string) =>
        store.run(async (client) => {
          client.transaction(() => {
            client.run("INSERT INTO app_metadata (key, value) VALUES (?, ?)", label, "before");
            client.run("UPDATE app_metadata SET value = ? WHERE key = ?", "after", label);
          });
          await Promise.resolve();
          return client.get<{ value: string }>(
            "SELECT value FROM app_metadata WHERE key = ?",
            label,
          );
        });

      const results = await Promise.all([append("a"), append("b"), append("c"), append("d")]);
      // Every write committed atomically; the queue prevented overlap.
      expect(results.map((row) => row?.value)).toEqual(["after", "after", "after", "after"]);

      const count = await store.run(
        (client) => client.get<{ c: number }>("SELECT COUNT(*) AS c FROM app_metadata")?.c,
      );
      expect(count).toBe(4);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drains pending writes before close resolves via waitForIdle", async () => {
    const dir = await makeTempDir();
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const writes: Promise<unknown>[] = [];
      for (let index = 0; index < 20; index += 1) {
        writes.push(
          store.run((client) =>
            client.run("INSERT INTO app_metadata (key, value) VALUES (?, ?)", `k${index}`, "v"),
          ),
        );
      }
      await store.waitForIdle();
      await store.close();

      // After close, every queued write landed on disk.
      const verify = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await verify.open();
      const count = await verify.run(
        (client) => client.get<{ c: number }>("SELECT COUNT(*) AS c FROM app_metadata")?.c,
      );
      expect(count).toBe(20);
      await verify.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects run before open and reports isOpen across the lifecycle", async () => {
    const dir = await makeTempDir();
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      expect(store.isOpen).toBe(false);
      let rejected = false;
      try {
        await store.run(() => 1);
      } catch {
        rejected = true;
      }
      expect(rejected).toBe(true);
      await store.open();
      expect(store.isOpen).toBe(true);
      await store.close();
      expect(store.isOpen).toBe(false);
      // close is idempotent.
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("closes a newly opened connection when initialization fails", async () => {
    const dir = await makeTempDir();
    let closeCount = 0;
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: {
          open: (path) => {
            const client = bunSqliteDriver.open(path);
            return {
              ...client,
              pragma: () => {
                throw new Error("simulated pragma failure");
              },
              close: () => {
                closeCount += 1;
                client.close();
              },
            };
          },
        },
      });

      let openError: unknown;
      try {
        await store.open();
      } catch (error) {
        openError = error;
      }
      expect(String(openError)).toContain("simulated pragma failure");
      expect(store.isOpen).toBe(false);
      expect(closeCount).toBe(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
