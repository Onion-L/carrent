import type { SqliteClient } from "./sqliteClient";

/**
 * Provider Session repository.
 *
 * Runtime Session mappings are keyed by `${runtimeId}:${threadId}` and persist
 * the provider session id that lets a Thread resume an existing runtime session
 * across runs and restarts. The `provider_sessions` table stores one row per
 * mapping (`session_key` primary key, `session_id` NOT NULL) and deliberately
 * has no foreign key to `threads`, so a mapping can outlive a mid-promotion
 * Thread and a single corrupted mapping can be isolated without touching
 * conversation history (PRD user story 27, issue 04).
 *
 * These functions are pure clients of a {@link RepositoryClient}: they run
 * bound statements against the connection or the caller's current transaction
 * and never open their own connection, start their own transaction, or maintain
 * a write queue. A top-level command owns one transaction and may call any of
 * these inside it; because the SQLite adapter runs a nested `transaction`
 * inline, calling these from inside a caller-owned transaction does not create
 * a competing transaction (issue 04: "repository operations may join a
 * caller-owned database transaction without creating nested transactions").
 *
 * Row-level writes replace the old full-snapshot JSON writes. A single set or
 * delete changes one row, so a concurrent writer can no longer resurrect a
 * deleted mapping by saving a stale full in-memory snapshot.
 */

/**
 * The slice of {@link SqliteClient} repository functions need. Narrowing the
 * dependency makes it obvious the repository never takes control of a
 * transaction or connection lifecycle, and lets a caller pass the in-transaction
 * client directly.
 */
export type ProviderSessionRepositoryClient = Pick<SqliteClient, "get" | "all" | "run">;

type ProviderSessionRow = { session_key: string; session_id: string };

/**
 * Read every Runtime Session mapping into a plain object keyed by
 * `${runtimeId}:${threadId}`. Used to seed the in-memory cache on startup (and
 * by the one-time JSON import). Invalid rows are not filtered here: the store's
 * read path isolates empty session ids and inconsistent legacy keys so a single
 * bad mapping never blocks the others.
 */
export function readProviderSessions(
  client: ProviderSessionRepositoryClient,
): Record<string, string> {
  const rows = client.all<ProviderSessionRow>(
    "SELECT session_key, session_id FROM provider_sessions",
  );
  const sessions: Record<string, string> = {};
  for (const row of rows) {
    if (typeof row.session_key !== "string" || typeof row.session_id !== "string") continue;
    sessions[row.session_key] = row.session_id;
  }
  return sessions;
}

/**
 * Replace every Runtime Session mapping. Used only by the one-time import,
 * explicit recovery/reset, and test fixture setup — never for ordinary
 * commands. The caller wraps this in one transaction so a failure leaves no
 * partial replacement (PRD: full-snapshot replacement is limited to import,
 * recovery, reset, and test setup).
 */
export function replaceProviderSessions(
  client: ProviderSessionRepositoryClient,
  sessions: Record<string, string>,
): void {
  client.run("DELETE FROM provider_sessions");
  for (const [key, sessionId] of Object.entries(sessions)) {
    upsertProviderSession(client, key, sessionId);
  }
}

/**
 * Insert or update a single mapping by key. Uses `ON CONFLICT DO UPDATE` so a
 * newer session id overwrites an older one atomically, without rewriting any
 * other row. This is the row-level replacement for the old full-snapshot save.
 */
export function upsertProviderSession(
  client: ProviderSessionRepositoryClient,
  key: string,
  sessionId: string,
): void {
  client.run(
    `INSERT INTO provider_sessions (session_key, session_id)
     VALUES (?, ?)
     ON CONFLICT(session_key) DO UPDATE SET session_id = excluded.session_id`,
    key,
    sessionId,
  );
}

/**
 * Delete a single mapping by exact key. Returns the removed session id, or
 * `null` when no row matched. Used to isolate an invalid mapping: the caller
 * already removed it from the in-memory cache, so a persistence failure leaves
 * the row in place to be re-isolated on the next read.
 */
export function deleteProviderSessionByKey(
  client: ProviderSessionRepositoryClient,
  key: string,
): string | null {
  const row = client.get<{ session_id: string }>(
    "SELECT session_id FROM provider_sessions WHERE session_key = ?",
    key,
  );
  if (!row) return null;
  client.run("DELETE FROM provider_sessions WHERE session_key = ?", key);
  return typeof row.session_id === "string" ? row.session_id : null;
}

/**
 * Conditionally delete a mapping: remove it only if the stored session id
 * matches `expectedSessionId`. Implemented as a single parameterized statement
 * so a stale caller cannot delete a newer session id mid-flight — the check and
 * the delete commit atomically inside the caller's transaction.
 *
 * Returns `true` when a row was removed. When `expectedSessionId` is omitted
 * the row is removed unconditionally if present.
 */
export function deleteProviderSessionIfMatching(
  client: ProviderSessionRepositoryClient,
  key: string,
  expectedSessionId?: string,
): boolean {
  const result =
    expectedSessionId === undefined
      ? client.run("DELETE FROM provider_sessions WHERE session_key = ?", key)
      : client.run(
          "DELETE FROM provider_sessions WHERE session_key = ? AND session_id = ?",
          key,
          expectedSessionId,
        );
  return result.changes > 0;
}

/**
 * Re-insert previously removed mappings. Used to restore Runtime Sessions when
 * a Thread deletion or Project relocation rolls back. Each mapping is upserted
 * independently so a partially-restored set still leaves the database usable;
 * the caller wraps the batch in one transaction.
 */
export function restoreProviderSessions(
  client: ProviderSessionRepositoryClient,
  sessions: Record<string, string>,
): void {
  for (const [key, sessionId] of Object.entries(sessions)) {
    upsertProviderSession(client, key, sessionId);
  }
}
