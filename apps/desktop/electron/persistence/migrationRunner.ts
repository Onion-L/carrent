import { migrationContextOf } from "./sqliteClientAdapter";
import {
  assertMigrationsWellFormed,
  readAppliedMigrationVersion,
  type Migration,
} from "./migrations";
import type { SqliteClient } from "./sqliteClient";

export interface MigrationOutcome {
  /** Highest migration version now recorded in the database. */
  readonly appliedVersion: number;
  /** Versions applied during this run (empty when the database was up to date). */
  readonly newlyApplied: readonly number[];
}

export interface MigrationRunnerOptions {
  /**
   * Source of canonical UTC ISO timestamps written to `schema_migrations`.
   * Defaults to `new Date().toISOString()`. Tests inject a fixed clock.
   */
  readonly now?: () => string;
}

/**
 * Apply all pending migrations from {@link migrations} in order.
 *
 * Guarantees the PRD requires:
 * - Monotonic order: the registry is validated as `1..n` before any work, and
 *   migrations run strictly in ascending version order.
 * - Atomicity: each migration's DDL, data changes, and `schema_migrations` row
 *   commit in the same exclusive transaction. A throw inside `up` rolls all of
 *   it back and propagates as the original error.
 * - Immutability: a migration already recorded with a different `name` than the
 *   registry entry is treated as a corrupted registry and rejected, so a
 *   released migration definition cannot be silently edited.
 * - Idempotency: migrations at or below the recorded version are skipped, so
 *   repeated startup never reapplies completed work.
 */
export function runMigrations(
  client: SqliteClient,
  registry: readonly Migration[],
  options: MigrationRunnerOptions = {},
): MigrationOutcome {
  assertMigrationsWellFormed(registry);
  const now = options.now ?? (() => new Date().toISOString());
  const context = migrationContextOf(client);

  const alreadyApplied = readAppliedMigrationVersion(context);

  // Guard the immutability of every released migration recorded so far. Only
  // run when `schema_migrations` exists (i.e. migration 1 has applied); on a
  // fresh database there is nothing to compare against.
  const hasMigrationTable = context
    .all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'",
    )
    .map((row) => row.name)
    .includes("schema_migrations");
  if (hasMigrationTable) {
    const recorded = context.all<{ version: number; name: string }>(
      "SELECT version, name FROM schema_migrations WHERE version <= ? ORDER BY version",
      alreadyApplied,
    );
    for (const row of recorded) {
      const entry = registry.find((migration) => migration.version === row.version);
      if (!entry) {
        throw new Error(
          `Migration registry is missing recorded version ${row.version}; released migrations must not be removed.`,
        );
      }
      if (entry.name !== row.name) {
        throw new Error(
          `Migration version ${row.version} was recorded as '${row.name}' but the registry now defines '${entry.name}'; released migrations must not be renamed.`,
        );
      }
    }
  }

  const newlyApplied: number[] = [];
  for (const migration of registry) {
    if (migration.version <= alreadyApplied) continue;
    client.transaction(() => {
      migration.up(context);
      client.run(
        "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        migration.version,
        migration.name,
        now(),
      );
    });
    newlyApplied.push(migration.version);
  }

  return {
    appliedVersion: readAppliedMigrationVersion(context),
    newlyApplied,
  };
}
