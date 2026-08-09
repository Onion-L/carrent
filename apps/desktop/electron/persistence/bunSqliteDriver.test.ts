import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openBunSqliteClient } from "./bunSqliteDriver";
import { isBunRuntime } from "./runtimeSqlite";
import { SqliteError } from "./sqliteClient";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "carrent-sqlite-bun-"));
}

describe("bunSqliteDriver contract", () => {
  it("runs under the Bun runtime", () => {
    expect(isBunRuntime()).toBe(true);
  });

  it("binds parameters and reads single and multiple rows", () => {
    const db = openBunSqliteClient(":memory:");
    db.exec("CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO item (name) VALUES (?)");
    const first = insert.run("alpha");
    const second = insert.run("beta");
    expect(first.changes).toBe(1);
    expect(first.lastInsertRowid).toBe(1);
    expect(second.lastInsertRowid).toBe(2);

    const row = db.get<{ id: number; name: string }>(
      "SELECT id, name FROM item WHERE name = ?",
      "alpha",
    );
    expect(row).toEqual({ id: 1, name: "alpha" });

    const all = db.all<{ id: number; name: string }>("SELECT id, name FROM item ORDER BY id");
    expect(all).toEqual([
      { id: 1, name: "alpha" },
      { id: 2, name: "beta" },
    ]);

    const missing = db.get("SELECT id FROM item WHERE name = ?", "nope");
    expect(missing).toEqual(null);

    db.close();
  });

  it("classifies unique, not-null, check, and foreign-key constraint errors", () => {
    const db = openBunSqliteClient(":memory:");
    db.exec(`
      CREATE TABLE parent (id INTEGER PRIMARY KEY)
    ;
      CREATE TABLE child (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        parent_id INTEGER REFERENCES parent(id),
        n INTEGER CHECK (n >= 0)
      )
    `);
    const insert = db.prepare("INSERT INTO child (name, parent_id, n) VALUES (?, ?, ?)");

    insert.run("a", null, 1);
    // Foreign-key enforcement is off until PRAGMA foreign_keys is enabled; turn
    // it on so the foreign-key classification actually fires.
    db.exec("PRAGMA foreign_keys = ON");

    function classify(fn: () => unknown): string {
      try {
        fn();
        throw new Error("expected throw");
      } catch (error) {
        if (error instanceof SqliteError) return error.result;
        throw error;
      }
    }

    expect(classify(() => insert.run("b", null, -1))).toBe("check");
    expect(classify(() => db.run("INSERT INTO child (parent_id, n) VALUES (?, ?)", 1, 1))).toBe(
      "not-null",
    );
    expect(classify(() => insert.run("c", 999, 1))).toBe("foreign-key");
    expect(classify(() => insert.run("a", null, 1))).toBe("unique");

    db.close();
  });

  it("commits a successful transaction and rolls back on throw", () => {
    const db = openBunSqliteClient(":memory:");
    db.exec("CREATE TABLE account (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL)");
    db.run("INSERT INTO account (balance) VALUES (?)", 10);
    db.run("INSERT INTO account (balance) VALUES (?)", 20);

    const committed = db.transaction(() => {
      db.run("UPDATE account SET balance = balance - ? WHERE id = ?", 5, 1);
      db.run("UPDATE account SET balance = balance + ? WHERE id = ?", 5, 2);
      return "committed";
    });
    expect(committed).toBe("committed");
    expect(db.get<{ balance: number }>("SELECT balance FROM account WHERE id = 2")).toEqual({
      balance: 25,
    });

    let caught: unknown;
    try {
      db.transaction(() => {
        db.run("UPDATE account SET balance = balance - ? WHERE id = ?", 100, 1);
        throw new Error("boom");
      });
    } catch (error) {
      caught = error;
    }
    expect(caught instanceof Error).toBe(true);
    // The rolled-back update never reached disk.
    expect(db.get<{ balance: number }>("SELECT balance FROM account WHERE id = 1")).toEqual({
      balance: 5,
    });

    db.close();
  });

  it("rejects an async transaction callback so it cannot commit early", () => {
    const db = openBunSqliteClient(":memory:");
    db.exec("CREATE TABLE account (id INTEGER PRIMARY KEY, balance INTEGER NOT NULL)");
    db.run("INSERT INTO account (balance) VALUES (?)", 10);

    // An async callback returns a Promise; the contract must refuse to commit
    // it, because the awaited body would settle after COMMIT and its rejection
    // would escape rollback.
    let rejected = false;
    try {
      db.transaction(async () => {
        db.run("UPDATE account SET balance = balance - ? WHERE id = ?", 5, 1);
      });
    } catch (error) {
      rejected = error instanceof Error && /synchronous/u.test(error.message);
    }
    expect(rejected).toBe(true);
    // Nothing committed: the rejected transaction left the row unchanged.
    expect(db.get<{ balance: number }>("SELECT balance FROM account WHERE id = 1")).toEqual({
      balance: 10,
    });

    db.close();
  });

  it("persists to a real file and reopens with the same data", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "roundtrip.db");
      {
        const db = openBunSqliteClient(path);
        db.exec("CREATE TABLE note (id INTEGER PRIMARY KEY, body TEXT NOT NULL)");
        db.run("INSERT INTO note (body) VALUES (?)", "hello");
        db.close();
      }
      expect(existsSync(path)).toBe(true);
      {
        const db = openBunSqliteClient(path);
        const row = db.get<{ id: number; body: string }>(
          "SELECT id, body FROM note WHERE id = ?",
          1,
        );
        expect(row).toEqual({ id: 1, body: "hello" });
        db.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports the opened path on the connection", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "path-check.db");
      const db = openBunSqliteClient(path);
      expect(db.path).toBe(path);
      db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
      db.run("INSERT INTO t DEFAULT VALUES");
      expect(db.get<{ id: number }>("SELECT id FROM t")?.id).toBe(1);
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects use after close with a SqliteError", () => {
    const db = openBunSqliteClient(":memory:");
    db.close();
    expect(() => db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)")).toThrow(SqliteError);
    // Closing twice is a safe no-op.
    expect(() => db.close()).not.toThrow();
  });
});
