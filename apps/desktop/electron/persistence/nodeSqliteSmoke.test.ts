import { describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { INITIAL_APP_STATE_SCHEMA_SQL } from "./migrations";

/**
 * The production SQLite adapter runs under Electron/Node's built-in
 * `node:sqlite`, which Bun cannot resolve. Bun imports the canonical migration
 * DDL from `migrations.ts`, then spawns `node` to run a self-contained smoke
 * module that exercises the real `node:sqlite` driver: opening a temporary
 * on-disk database, applying the production PRAGMAs, binding parameters,
 * enforcing foreign keys, committing and rolling back transactions, applying
 * the exact initial schema, and reopening with the data intact.
 *
 * The DDL is embedded verbatim from the single source of truth rather than
 * duplicated, so a schema change that is valid under Bun is also validated
 * under the production driver. No third-party native SQLite addon is involved.
 */
describe("node:sqlite production adapter smoke", () => {
  it("runs the production adapter smoke suite under node", () => {
    const dir = mkdtempSync(join(tmpdir(), "carrent-node-sqlite-smoke-runner-"));
    try {
      // Embed the canonical DDL as a JSON string literal so the generated Node
      // module stays self-contained and resolves only `node:sqlite`.
      const script = `
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCHEMA_SQL = ${JSON.stringify(INITIAL_APP_STATE_SCHEMA_SQL)};

const failures = [];
const check = (name, fn) => {
  try { fn(); console.log("ok - " + name); }
  catch (error) { const m = error && error.message ? error.message : String(error); console.log("not ok - " + name + ": " + m); failures.push({ name, m }); }
};

const dir = mkdtempSync(join(tmpdir(), "carrent-node-sqlite-smoke-"));
try {
  const path = join(dir, "carrent.sqlite");
  const db = new DatabaseSync(path);

  check("opens a connection", () => {});
  check("applies and verifies foreign_keys, WAL, NORMAL synchronous, busy timeout", () => {
    db.exec("PRAGMA foreign_keys = ON");
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA synchronous = NORMAL");
    db.exec("PRAGMA busy_timeout = 5000");
    const fk = db.prepare("PRAGMA foreign_keys").get();
    const jm = db.prepare("PRAGMA journal_mode").get();
    const sy = db.prepare("PRAGMA synchronous").get();
    const bt = db.prepare("PRAGMA busy_timeout").get();
    if (fk.foreign_keys !== 1) throw new Error("foreign_keys=" + JSON.stringify(fk));
    if (String(jm.journal_mode).toLowerCase() !== "wal") throw new Error("journal_mode=" + JSON.stringify(jm));
    if (sy.synchronous !== 1) throw new Error("synchronous=" + JSON.stringify(sy));
    if (bt.timeout !== 5000) throw new Error("busy_timeout=" + JSON.stringify(bt));
  });

  check("binds parameters and reads single and multiple rows", () => {
    db.exec("CREATE TABLE probe (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE)");
    const ins = db.prepare("INSERT INTO probe (name) VALUES (?)");
    const r = ins.run("alpha");
    if (r.changes !== 1) throw new Error("changes=" + r.changes);
    if (Number(r.lastInsertRowid) !== 1) throw new Error("rowid=" + r.lastInsertRowid);
    const row = db.prepare("SELECT id, name FROM probe WHERE name = ?").get("alpha");
    if (!row || row.id !== 1 || row.name !== "alpha") throw new Error("row=" + JSON.stringify(row));
    ins.run("beta");
    const all = db.prepare("SELECT name FROM probe ORDER BY id").all();
    if (all.length !== 2) throw new Error("len=" + all.length);
  });

  check("enforces a UNIQUE constraint", () => {
    try { db.prepare("INSERT INTO probe (name) VALUES (?)").run("alpha"); }
    catch { return; }
    throw new Error("duplicate insert did not fail");
  });

  check("commits and rolls back transactions", () => {
    db.exec("CREATE TABLE txn (id INTEGER PRIMARY KEY, n INTEGER NOT NULL)");
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO txn (n) VALUES (?)").run(1);
    db.prepare("INSERT INTO txn (n) VALUES (?)").run(2);
    db.exec("COMMIT");
    try {
      db.exec("BEGIN IMMEDIATE");
      db.prepare("INSERT INTO txn (n) VALUES (?)").run(3);
      throw new Error("rollback me");
    } catch (e) {
      try { db.exec("ROLLBACK"); } catch {}
      if (!e || e.message !== "rollback me") throw e;
    }
    const c = db.prepare("SELECT COUNT(*) AS c FROM txn").get();
    if (c.c !== 2) throw new Error("count=" + c.c);
  });

  check("enforces a FOREIGN KEY with foreign_keys ON", () => {
    db.exec("CREATE TABLE parent (id INTEGER PRIMARY KEY)");
    db.exec("CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))");
    try { db.prepare("INSERT INTO child (parent_id) VALUES (?)").run(999); }
    catch { return; }
    throw new Error("FK violation did not fail");
  });

  check("applies the canonical initial schema under node:sqlite", () => {
    db.exec(SCHEMA_SQL);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(r => r.name);
    for (const expected of ["schema_migrations", "app_metadata", "workspaces", "projects", "workspace_project_associations", "threads", "thread_drafts", "thread_messages", "thread_runs", "promotion_intents", "thread_work", "workspace_last_threads", "settings"]) {
      if (!tables.includes(expected)) throw new Error("missing table " + expected);
    }
  });

  check("persists and reopens with the data intact", () => {
    db.prepare("INSERT INTO app_metadata (key, value) VALUES (?, ?)").run("seed", "first");
    db.close();
    const again = new DatabaseSync(path);
    const row = again.prepare("SELECT value FROM app_metadata WHERE key = ?").get("seed");
    if (!row || row.value !== "first") throw new Error("row=" + JSON.stringify(row));
    again.close();
  });

  console.log("smoke: " + (failures.length === 0 ? "PASS" : "FAIL") + " (" + failures.length + " failures)");
  process.exitCode = failures.length === 0 ? 0 : 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
`;
      const scriptPath = join(dir, "smoke.mjs");
      writeFileSync(scriptPath, script, "utf8");

      const result = spawnSync(process.env.NODE_BINARY ?? "node", [scriptPath], {
        encoding: "utf8",
      });
      if (result.error) throw new Error(`failed to spawn node: ${String(result.error)}`);
      if (result.status !== 0) {
        console.log(result.stdout);
        console.log(result.stderr);
      }
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("smoke: PASS");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
