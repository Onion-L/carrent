import type { SqliteAppStateStore } from "./sqliteAppStateStore";
import {
  deleteProviderSessionByKey,
  deleteProviderSessionIfMatching,
  replaceProviderSessions,
  restoreProviderSessions,
  upsertProviderSession,
} from "./providerSessionRepository";
import { isInconsistentProviderSessionKey } from "../../src/shared/providerSessions";
import { runtimeIds, type RuntimeId } from "../../src/shared/runtimes";
import type { ProviderSessionStore } from "../chat/chatSessionManager";
import type { ProviderSessionSnapshot } from "../../src/shared/workspacePersistence";

/**
 * A {@link ProviderSessionStore} persisted by the SQLite App State Store.
 *
 * Runtime Session mappings live in the `provider_sessions` table and flow
 * through the Store's single serialized operation queue, so load, set,
 * conditional delete, batch delete, and restore all share one queue with App
 * State commands, Thread deletion, and Project relocation (PRD: the Store owns
 * one queue shared by Provider Session writes). The old JSON store kept a
 * competing write queue and rewrote the whole file on every change; this store
 * does row-level `INSERT`/`DELETE` so a concurrent writer can no longer
 * resurrect a deleted mapping by saving a stale full in-memory snapshot.
 *
 * Reads stay synchronous: the store keeps an in-memory cache seeded from
 * SQLite on startup (and re-seeded by {@link reinitialize}) and updates it only
 * after the corresponding database write commits. If the database write fails,
 * the cache is left at the pre-commit state, so callers observe the same
 * consistency guarantee the chat session manager already relies on (issue 04:
 * the in-memory mapping changes only after the database commits).
 *
 * Isolated-failure behavior is preserved. An empty session id or a legacy
 * inconsistent key is detached from the cache and removed from the database on
 * the next serialized op; one bad mapping never blocks the others and never
 * enters global recovery-required.
 */
export type SqliteProviderSessionStore = ProviderSessionStore & {
  /**
   * Reset the in-memory cache and persisted mappings from `snapshot`. Used by
   * Full Reset and reload after recovery: the existing JSON-backed store's
   * `reinitialize` owned the same responsibility.
   */
  reinitialize: (snapshot: ProviderSessionSnapshot) => Promise<void>;
  adoptCommittedProviderSessionDeletion: (removedSessions: Record<string, string>) => void;
  detachThreadsFromCache: (threadIds: string[]) => Record<string, string>;
  restoreThreadsToCache: (sessions: Record<string, string>) => void;
};

function buildInvalidKeyDiagnostic(storedKey: string, requestKey: string): string {
  // Never include the session id or Thread id in the diagnostic. A bad key shape
  // is enough context for a log message; the contents stay out of any local
  // diagnostic surface.
  return `Dropped invalid Runtime Session mapping (stored key shape mismatch for request key shape). stored=${storedKey.length}ch request=${requestKey.length}ch`;
}

function parseRuntimeId(key: string): RuntimeId | null {
  const separator = key.indexOf(":");
  if (separator === -1) return null;
  const candidate = key.slice(0, separator) as RuntimeId;
  return runtimeIds.includes(candidate) ? candidate : null;
}

function partitionSessionsByThreads(
  current: Record<string, string>,
  threadIds: string[],
): { removed: Record<string, string>; remaining: Record<string, string> } {
  const suffixes = [...new Set(threadIds)].map((threadId) => `:${threadId}`);
  const removed: Record<string, string> = {};
  const remaining: Record<string, string> = {};
  for (const [key, sessionId] of Object.entries(current)) {
    (suffixes.some((suffix) => key.endsWith(suffix)) ? removed : remaining)[key] = sessionId;
  }
  return { removed, remaining };
}

export function createSqliteProviderSessionStore(
  sqliteStore: SqliteAppStateStore,
  initial: ProviderSessionSnapshot,
  options: { onDiagnostic?: (message: string) => void } = {},
): SqliteProviderSessionStore {
  const onDiagnostic = options.onDiagnostic ?? (() => {});
  let sessions: Record<string, string> = { ...initial.sessions };
  const invalidRequests = new Set<string>();

  const detachInvalid = (requestKey: string, storedKey: string): void => {
    delete sessions[storedKey];
    invalidRequests.add(requestKey);
    onDiagnostic(buildInvalidKeyDiagnostic(storedKey, requestKey));
    // The invalid row is removed on the shared queue. A failure leaves the row
    // in the database; the next read detaches it again, so a single persistence
    // fault can never wedge the mapping set.
    void sqliteStore
      .run((client) => {
        deleteProviderSessionByKey(client, storedKey);
      })
      .catch(() => {
        // The invalid entry stays detached in memory; a later write can persist
        // the repair. The queue keeps serving subsequent operations.
      });
  };

  return {
    get: (key) => {
      const sessionId = sessions[key];
      if (sessionId !== undefined) {
        if (sessionId.trim().length === 0) {
          detachInvalid(key, key);
          return undefined;
        }
        return sessionId;
      }

      const runtimeId = parseRuntimeId(key);
      if (runtimeId) {
        const threadId = key.slice(key.indexOf(":") + 1);
        const inconsistentKey = Object.keys(sessions).find(
          (storedKey) =>
            runtimeIds.includes(runtimeId) &&
            isInconsistentProviderSessionKey(storedKey, runtimeId, threadId),
        );
        if (inconsistentKey) {
          detachInvalid(key, inconsistentKey);
        }
      }
      return undefined;
    },
    consumeInvalidMappingNotice: (key) => invalidRequests.delete(key),
    set: (key, sessionId) =>
      sqliteStore.run((client) =>
        // The database write and the cache update commit in one transaction: if
        // the write throws, the transaction rolls back and the cache stays at
        // the pre-commit state (issue 04: the in-memory mapping changes only
        // after the database commits).
        client.transaction(() => {
          upsertProviderSession(client, key, sessionId);
          sessions = { ...sessions, [key]: sessionId };
        }),
      ),
    delete: (key, sessionId) =>
      sqliteStore.run((client) =>
        client.transaction(() => {
          // Conditional delete: skip when the caller supplied a stale session
          // id, so a concurrent newer mapping cannot be cleared by an older
          // one. The check and the row-level delete run in one transaction.
          if (sessionId !== undefined && sessions[key] !== sessionId) {
            return;
          }
          deleteProviderSessionIfMatching(client, key, sessionId);
          const nextSessions = { ...sessions };
          delete nextSessions[key];
          sessions = nextSessions;
        }),
      ),
    deleteThreads: (threadIds) =>
      sqliteStore.run((client) =>
        client.transaction(() => {
          // Compute the removed set from the in-memory cache — which mirrors
          // the committed database state — so the caller can restore exactly
          // what was detached, including a mapping loaded but not yet
          // rewritten. Every row delete and the cache update commit together,
          // so a partial failure cannot leave the database diverged from the
          // caller-observed cache.
          const { removed, remaining } = partitionSessionsByThreads(sessions, threadIds);
          // `deleteProviderSessionByKey` is a no-op when the row was never
          // persisted, so a restore can always re-insert it.
          for (const key of Object.keys(removed)) {
            deleteProviderSessionByKey(client, key);
          }
          sessions = remaining;
          return removed;
        }),
      ),
    restoreThreads: (restoredSessions) =>
      sqliteStore.run((client) =>
        client.transaction(() => {
          restoreProviderSessions(client, restoredSessions);
          sessions = { ...sessions, ...restoredSessions };
        }),
      ),
    adoptCommittedProviderSessionDeletion: (removedSessions) => {
      const nextSessions = { ...sessions };
      for (const [key, sessionId] of Object.entries(removedSessions)) {
        if (nextSessions[key] === sessionId) delete nextSessions[key];
      }
      sessions = nextSessions;
    },
    detachThreadsFromCache: (threadIds) => {
      const { removed, remaining } = partitionSessionsByThreads(sessions, threadIds);
      sessions = remaining;
      return removed;
    },
    restoreThreadsToCache: (restoredSessions) => {
      sessions = { ...sessions, ...restoredSessions };
    },
    reinitialize: (nextSnapshot) =>
      sqliteStore.run((client) =>
        client.transaction(() => {
          replaceProviderSessions(client, nextSnapshot.sessions);
          sessions = { ...nextSnapshot.sessions };
          invalidRequests.clear();
        }),
      ),
  };
}
