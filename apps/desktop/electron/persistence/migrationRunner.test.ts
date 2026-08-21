import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openBunSqliteClient } from "./bunSqliteDriver";
import {
  INITIAL_APP_STATE_SCHEMA_SQL,
  MIGRATIONS,
  assertMigrationsWellFormed,
  type Migration,
} from "./migrations";
import { runMigrations } from "./migrationRunner";
import { readAppStateSnapshot } from "./sqliteAppStateRepository";

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "carrent-sqlite-migrations-"));
}

describe("migration registry", () => {
  it("is the contiguous sequence 1..n", () => {
    expect(() => assertMigrationsWellFormed(MIGRATIONS)).not.toThrow();
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("rejects a reordered or gapped registry", () => {
    const bad: Migration[] = [
      { version: 1, name: "a", up: () => {} },
      { version: 3, name: "c", up: () => {} },
    ];
    expect(() => assertMigrationsWellFormed(bad)).toThrow(/malformed/u);
  });
});

describe("runMigrations", () => {
  it("migrates legacy permission modes into valid Agent Modes", async () => {
    const dir = await makeTempDir();
    try {
      const db = openBunSqliteClient(join(dir, "app.db"));
      db.exec(
        INITIAL_APP_STATE_SCHEMA_SQL.replaceAll(
          "('ask', 'auto-edit', 'full-project')",
          "('approval-required', 'auto-accept-edits', 'full-access')",
        ),
      );
      db.run(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        1,
        "initial-app-state-schema",
        "2026-08-09T00:00:00.000Z",
      );
      runMigrations(db, MIGRATIONS.slice(0, 3), {
        now: () => "2026-08-09T00:00:01.000Z",
      });
      db.exec("PRAGMA foreign_keys = ON");
      db.run('INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)', "w1", "Work", 0);
      db.run(
        `INSERT INTO projects (id, name, working_directory, working_directory_identity)
         VALUES (?, ?, ?, ?)`,
        "p1",
        "Project",
        "/work/project",
        "/work/project",
      );
      db.run(
        `INSERT INTO workspace_project_associations
           (workspace_id, project_id, "order", default_runtime_id, default_runtime_mode)
         VALUES (?, ?, ?, ?, ?)`,
        "w1",
        "p1",
        0,
        "kimi",
        "approval-required",
      );
      db.run(
        `INSERT INTO threads (
           id, workspace_id, project_id, title, created_at, last_activity_at,
           runtime_id, runtime_mode, plan_mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "thread-1",
        "w1",
        "p1",
        "Existing",
        "2026-08-09T00:00:00.000Z",
        "2026-08-09T00:00:00.000Z",
        "kimi",
        "auto-accept-edits",
        0,
      );
      db.run(
        `INSERT INTO thread_messages (id, thread_id, role, message, created_at, payload)
         VALUES (?, ?, ?, ?, ?, ?)`,
        "message-1",
        "thread-1",
        "user",
        "legacy request",
        "2026-08-09T00:00:00.000Z",
        '{"attachments":[]}',
      );
      db.run(
        `INSERT INTO thread_runs (
           id, thread_id, message_id, started_at, runtime_id, runtime_mode, plan_mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        "run-1",
        "thread-1",
        "message-1",
        "2026-08-09T00:00:00.000Z",
        "kimi",
        "approval-required",
        0,
      );
      db.run(
        `INSERT INTO thread_drafts (
           id, reserved_thread_id, workspace_id, project_id, content,
           attached_skill_names, attachments, runtime_id, runtime_mode, plan_mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "draft-1",
        "future-thread-1",
        "w1",
        "p1",
        "legacy draft",
        "[]",
        "[]",
        "kimi",
        "full-access",
        0,
      );
      db.run(
        `INSERT INTO promotion_intents (
           draft_id, thread_id, workspace_id, project_id, title, run_id, message_id,
           message, attachments, started_at, runtime_id, runtime_mode, plan_mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "draft-1",
        "future-thread-1",
        "w1",
        "p1",
        "Future",
        "future-run-1",
        "future-message-1",
        "legacy promotion",
        "[]",
        "2026-08-09T00:00:00.000Z",
        "kimi",
        "auto-accept-edits",
        0,
      );

      runMigrations(db, MIGRATIONS, { now: () => "2026-08-09T00:00:02.000Z" });

      const snapshot = readAppStateSnapshot(db);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.associations[0]?.defaultAgentMode).toBe("ask");
      expect(snapshot?.threads?.[0]?.agentMode).toBe("auto-edit");
      expect(snapshot?.threadDrafts?.[0]?.agentMode).toBe("full-project");
      expect(snapshot?.threadRuns?.[0]?.agentMode).toBe("ask");
      expect(snapshot?.threadPromotionIntents?.[0]?.agentMode).toBe("auto-edit");
      expect(() =>
        db.run("UPDATE threads SET agent_mode = ? WHERE id = ?", "auto-accept-edits", "thread-1"),
      ).toThrow();
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("creates the schema from an empty database and records every migration", async () => {
    const dir = await makeTempDir();
    try {
      const db = openBunSqliteClient(join(dir, "app.db"));
      const outcome = runMigrations(db, MIGRATIONS, { now: () => "2026-08-09T00:00:00.000Z" });

      expect(outcome.appliedVersion).toBe(6);
      expect(outcome.newlyApplied).toEqual([1, 2, 3, 4, 5, 6]);

      const recorded = db.get<{ version: number; name: string; applied_at: string }>(
        "SELECT version, name, applied_at FROM schema_migrations WHERE version = ?",
        1,
      );
      expect(recorded).toEqual({
        version: 1,
        name: "initial-app-state-schema",
        applied_at: "2026-08-09T00:00:00.000Z",
      });

      // Every PRD-required table exists.
      const tables = db
        .all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .map((row) => row.name);
      for (const expected of [
        "schema_migrations",
        "app_metadata",
        "workspaces",
        "projects",
        "workspace_project_associations",
        "threads",
        "thread_drafts",
        "thread_messages",
        "thread_runs",
        "promotion_intents",
        "thread_work",
        "workspace_last_threads",
        "settings",
      ]) {
        expect(tables).toContain(expected);
      }

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent: repeated startup does not reapply completed migrations", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "app.db");
      const first = openBunSqliteClient(path);
      runMigrations(first, MIGRATIONS, { now: () => "2026-08-09T00:00:00.000Z" });
      first.close();

      const second = openBunSqliteClient(path);
      const outcome = runMigrations(second, MIGRATIONS, { now: () => "2026-08-09T00:00:01.000Z" });
      expect(outcome.appliedVersion).toBe(6);
      expect(outcome.newlyApplied).toEqual([]);

      // No duplicate migration rows exist after a second run.
      const count = second.get<{ c: number }>("SELECT COUNT(*) AS c FROM schema_migrations")?.c;
      expect(count).toBe(6);
      second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back the whole migration when its body throws, including the migration record", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "app.db");
      // Run the real initial migration first.
      const setup = openBunSqliteClient(path);
      runMigrations(setup, MIGRATIONS, { now: () => "2026-08-09T00:00:00.000Z" });
      setup.close();

      // Append a failing migration that creates a sentinel table then throws.
      const failingRegistry: Migration[] = [
        ...MIGRATIONS,
        {
          version: 7,
          name: "failing",
          up: (ctx) => {
            ctx.exec("CREATE TABLE sentinel (id INTEGER PRIMARY KEY)");
            throw new Error("injected failure");
          },
        },
      ];

      const db = openBunSqliteClient(path);
      expect(() => runMigrations(db, failingRegistry)).toThrow("injected failure");

      // The failed migration left no trace: no sentinel table, no version-7 row.
      const sentinel = db
        .all<{ name: string }>(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sentinel'",
        )
        .map((row) => row.name);
      expect(sentinel).toEqual([]);
      const recorded = db
        .all<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version")
        .map((row) => row.version);
      expect(recorded).toEqual([1, 2, 3, 4, 5, 6]);
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects an edited released migration name as a corrupted registry", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "app.db");
      const setup = openBunSqliteClient(path);
      runMigrations(setup, MIGRATIONS, { now: () => "2026-08-09T00:00:00.000Z" });
      setup.close();

      // Rewrite the registry so migration 1 has a different name than recorded.
      const edited: Migration[] = [{ version: 1, name: "tampered-name", up: () => {} }];
      const db = openBunSqliteClient(path);
      expect(() => runMigrations(db, edited)).toThrow(/must not be renamed/u);
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("enforces the Thread Draft reserved-thread-id uniqueness without a threads foreign key", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "app.db");
      const db = openBunSqliteClient(path);
      runMigrations(db, MIGRATIONS, { now: () => "2026-08-09T00:00:00.000Z" });
      db.exec("PRAGMA foreign_keys = ON");

      // Minimal association row to satisfy the composite FK.
      db.run('INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)', "w1", "Work", 0);
      db.run(
        "INSERT INTO projects (id, name, working_directory, working_directory_identity) VALUES (?, ?, ?, ?)",
        "p1",
        "Proj",
        "/tmp/proj",
        "/tmp/proj",
      );
      db.run(
        `INSERT INTO workspace_project_associations
           (workspace_id, project_id, "order", default_provider_profile_id, default_agent_mode)
         VALUES (?, ?, ?, ?, ?)`,
        "w1",
        "p1",
        0,
        "default",
        "ask",
      );

      db.run(
        `INSERT INTO thread_drafts
           (id, reserved_thread_id, workspace_id, project_id, content,
            attached_skill_names, attachments, provider_profile_id, agent_mode)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "d1",
        "future-thread-1",
        "w1",
        "p1",
        "hello",
        "[]",
        "[]",
        "default",
        "ask",
      );

      // Reserved thread id must be unique across drafts (no threads row exists).
      expect(() =>
        db.run(
          `INSERT INTO thread_drafts
             (id, reserved_thread_id, workspace_id, project_id, content,
              attached_skill_names, attachments, provider_profile_id, agent_mode)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          "d2",
          "future-thread-1",
          "w1",
          "p1",
          "again",
          "[]",
          "[]",
          "default",
          "ask",
        ),
      ).toThrow();

      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a version-1 database with an existing reserved Thread ID conflict", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "app.db");
      const setup = openBunSqliteClient(path);
      runMigrations(setup, MIGRATIONS.slice(0, 1), {
        now: () => "2026-08-09T00:00:00.000Z",
      });
      setup.exec("PRAGMA foreign_keys = ON");
      setup.run('INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)', "w1", "Work", 0);
      setup.run(
        `INSERT INTO projects (id, name, working_directory, working_directory_identity)
         VALUES (?, ?, ?, ?)`,
        "p1",
        "Project",
        "/work/project",
        "/work/project",
      );
      setup.run(
        `INSERT INTO workspace_project_associations
           (workspace_id, project_id, "order", default_runtime_id, default_runtime_mode)
         VALUES (?, ?, ?, ?, ?)`,
        "w1",
        "p1",
        0,
        "kimi",
        "ask",
      );
      setup.run(
        `INSERT INTO threads (
           id, workspace_id, project_id, title, created_at, last_activity_at,
           runtime_id, runtime_mode, plan_mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "reserved-1",
        "w1",
        "p1",
        "Existing",
        "2026-08-09T00:00:00.000Z",
        "2026-08-09T00:00:00.000Z",
        "kimi",
        "ask",
        0,
      );
      setup.run(
        `INSERT INTO thread_drafts (
           id, reserved_thread_id, workspace_id, project_id, content,
           attached_skill_names, attachments, runtime_id, runtime_mode, plan_mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "draft-1",
        "reserved-1",
        "w1",
        "p1",
        "Conflict",
        "[]",
        "[]",
        "kimi",
        "ask",
        0,
      );
      setup.close();

      const upgrade = openBunSqliteClient(path);
      expect(() => runMigrations(upgrade, MIGRATIONS)).toThrow(
        /conflicts with an existing Thread/u,
      );
      expect(
        upgrade
          .all<{ version: number }>("SELECT version FROM schema_migrations ORDER BY version")
          .map((row) => row.version),
      ).toEqual([1]);
      upgrade.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("upgrades a version-2 database by adding and backfilling message payloads", async () => {
    const dir = await makeTempDir();
    try {
      const path = join(dir, "app.db");
      const setup = openBunSqliteClient(path);
      runMigrations(setup, MIGRATIONS.slice(0, 2), {
        now: () => "2026-08-09T00:00:00.000Z",
      });
      setup.exec("PRAGMA foreign_keys = ON");
      setup.run('INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)', "w1", "Work", 0);
      setup.run(
        `INSERT INTO projects (id, name, working_directory, working_directory_identity)
         VALUES (?, ?, ?, ?)`,
        "p1",
        "Project",
        "/work/project",
        "/work/project",
      );
      setup.run(
        `INSERT INTO workspace_project_associations
           (workspace_id, project_id, "order", default_runtime_id, default_runtime_mode)
         VALUES (?, ?, ?, ?, ?)`,
        "w1",
        "p1",
        0,
        "kimi",
        "ask",
      );
      setup.run(
        `INSERT INTO threads (
           id, workspace_id, project_id, title, created_at, last_activity_at,
           runtime_id, runtime_mode, plan_mode
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        "thread-1",
        "w1",
        "p1",
        "Existing",
        "2026-08-09T00:00:00.000Z",
        "2026-08-09T00:00:00.000Z",
        "kimi",
        "ask",
        0,
      );
      // A message row written before payloads existed.
      setup.run(
        `INSERT INTO thread_messages (id, thread_id, role, message, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        "message-1",
        "thread-1",
        "user",
        "pre-payload",
        "2026-08-09T00:00:00.000Z",
      );
      setup.close();

      const upgrade = openBunSqliteClient(path);
      const outcome = runMigrations(upgrade, MIGRATIONS, {
        now: () => "2026-08-09T00:00:01.000Z",
      });
      expect(outcome.appliedVersion).toBe(6);
      expect(outcome.newlyApplied).toEqual([3, 4, 5, 6]);

      const message = upgrade.get<{ payload: string }>(
        "SELECT payload FROM thread_messages WHERE id = ?",
        "message-1",
      );
      expect(message?.payload).toBe('{"attachments":[]}');
      upgrade.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
