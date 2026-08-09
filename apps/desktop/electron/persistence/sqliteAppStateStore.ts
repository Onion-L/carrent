import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { MIGRATIONS } from "./migrations";
import { runMigrations } from "./migrationRunner";
import { getSqliteDriver } from "./runtimeSqlite";
import { readAppStateSnapshot, replaceAppStateSnapshot } from "./sqliteAppStateRepository";
import { deleteThreadsFromAppState, threadDeletionOperationKey } from "./sqliteAppStateDeletion";
import type { SqliteClient, SqliteDriver } from "./sqliteClient";
import type { AppStateCommand } from "../../src/shared/appStateAuthority";
import type { ThreadDeletionScope } from "../../src/shared/chat";
import {
  normalizePersistedAppStateSnapshot,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { persistIncrementalAppStateCommand } from "./sqliteAppStateCommands";
import { relocateProjectInAppState } from "./sqliteAppStateRelocation";

/**
 * Connection PRAGMAs applied on every fresh database. The PRD fixes these:
 * foreign keys enforce referential integrity, WAL keeps reads around short
 * transactions, NORMAL synchronous mode trades a little durability for the
 * throughput WAL enables, and the busy timeout lets the single writer wait out
 * a brief lock instead of failing fast.
 */
export interface SqliteConnectionPragmas {
  readonly foreignKeys: boolean;
  readonly journalMode: "wal";
  readonly synchronous: "normal";
  /** Busy timeout in milliseconds. */
  readonly busyTimeoutMs: number;
}

export const DEFAULT_SQLITE_PRAGMAS: SqliteConnectionPragmas = {
  foreignKeys: true,
  journalMode: "wal",
  synchronous: "normal",
  busyTimeoutMs: 5000,
};

/**
 * Result of opening and migrating a SQLite App State database.
 *
 * `migrations` reports what the migration runner did this run so the store can
 * distinguish a fresh database (created and migrated) from an already-up-to-date
 * reopening. The completion of the one-time JSON import is tracked separately
 * (issue 05) and is intentionally not part of this kernel lifecycle.
 */
export interface SqliteAppStateOpenResult {
  readonly migrations: {
    readonly appliedVersion: number;
    readonly newlyApplied: readonly number[];
  };
  readonly pragmas: SqliteConnectionPragmas;
}

export interface SqliteAppStateStoreOptions {
  /**
   * Override the runtime driver. Tests inject the Bun adapter directly so they
   * do not pay the dynamic-load cost on every open. Production leaves it
   * unset and the runtime selector resolves `bun:sqlite` or `node:sqlite`.
   */
  readonly driver?: SqliteDriver | (() => Promise<SqliteDriver>);
  /** Connection PRAGMAs. Defaults to {@link DEFAULT_SQLITE_PRAGMAS}. */
  readonly pragmas?: SqliteConnectionPragmas;
  /** Override the migration registry. Defaults to the released set. */
  readonly migrations?: typeof MIGRATIONS;
  /** Source of `schema_migrations.applied_at`. Defaults to real time. */
  readonly now?: () => string;
}

/**
 * The SQLite App State Store.
 *
 * Owns the single application-lifetime SQLite connection and the one serialized
 * operation queue shared by App State commands, Provider Session writes, Thread
 * deletion, Project relocation, import, reset, and shutdown draining.
 * Repositories receive the connection (or the current transaction's client)
 * from the store and never open their own database or maintain a competing
 * write queue (PRD "Implementation Decisions").
 *
 * The kernel scope of this store is connection lifecycle: opening with PRAGMAs,
 * running ordered schema migrations, serializing work, closing and reopening,
 * and draining pending writes on quit. Repository-backed command persistence
 * (issue 02+) layers on top via {@link run}.
 */
export interface SqliteAppStateStore {
  /**
   * Open the connection, apply and verify PRAGMAs, and run pending migrations.
   * Safe to call after {@link close} to reopen the same file.
   */
  open(): Promise<SqliteAppStateOpenResult>;
  /**
   * Run `work` against the live connection on the serialized queue. `work`
   * receives the {@link SqliteClient} and may return a Promise; the queue
   * guarantees no two operations interleave. This is the seam repositories and
   * the command-aware persistence use.
   */
  run<T>(work: (client: SqliteClient) => T | Promise<T>): Promise<T>;
  /** Replace the persisted App State Snapshot atomically after validating it. */
  saveAppStateSnapshot(snapshot: AppStateSnapshot): Promise<void>;
  /** Persist one validated ordinary command by updating only its owned rows. */
  persistAppStateCommand(
    command: AppStateCommand,
    before: AppStateSnapshot,
    after: AppStateSnapshot,
  ): Promise<void>;
  /** Load the persisted App State Snapshot, or null when stored rows are invalid. */
  loadAppStateSnapshot(): Promise<AppStateSnapshot | null>;
  /**
   * Permanently delete the Thread-owned relational state for `threadIds`,
   * scoped by `scope` (threads / association / workspace), in one database
   * transaction. Returns the removed Provider Session mappings so the caller
   * can restore them on rollback. A failure rolls back every deleted row.
   */
  deleteAppStateForThreads(
    operationId: string,
    threadIds: string[],
    scope?: ThreadDeletionScope,
    onCommitted?: (removedProviderSessions: Record<string, string>) => void,
  ): Promise<{
    appState: AppStateSnapshot;
    removedProviderSessions: Record<string, string>;
  }>;
  hasCommittedThreadDeletion(operationId: string): Promise<boolean>;
  clearCommittedThreadDeletionMarker(operationId: string): Promise<void>;
  /** Update one Project path and detach its Runtime Session mappings atomically. */
  relocateProject(request: {
    projectId: string;
    beforeWorkingDirectory: string;
    targetDirectory: string;
    threadIds: string[];
    providerSessions: Record<string, string>;
  }): Promise<{
    appState: AppStateSnapshot;
    removedProviderSessions: Record<string, string>;
  }>;
  /**
   * Resolves once every operation submitted so far has settled, so quit-time
   * flows can drain pending writes before the process exits.
   */
  waitForIdle(): Promise<void>;
  /** Close the connection. Safe to call multiple times; `open` can reopen. */
  close(): Promise<void>;
  /** Whether the connection is currently open. */
  readonly isOpen: boolean;
  /** The database path this store was created for. */
  readonly path: string;
}

/**
 * Apply the connection PRAGMAs and verify SQLite actually reports them.
 *
 * The store does not trust that a `PRAGMA foreign_keys = ON` call silently
 * succeeded: it writes each PRAGMA and reads the effective value back, because
 * some PRAGMAs (notably `journal_mode`) cannot take effect in every mode and a
 * silent no-op would leave the database weaker than the PRD requires. A
 * mismatch throws so a misconfigured database never silently becomes
 * authoritative.
 */
function applyAndVerifyPragmas(
  client: SqliteClient,
  expected: SqliteConnectionPragmas,
): SqliteConnectionPragmas {
  client.pragma("foreign_keys", expected.foreignKeys ? "ON" : "OFF");
  client.pragma("journal_mode", expected.journalMode);
  client.pragma("synchronous", expected.synchronous === "normal" ? "NORMAL" : "FULL");
  client.pragma("busy_timeout", expected.busyTimeoutMs);

  const foreignKeys = client.pragma("foreign_keys");
  if (foreignKeys !== (expected.foreignKeys ? 1 : 0)) {
    throw new Error(
      `PRAGMA foreign_keys expected ${expected.foreignKeys ? 1 : 0} but got ${String(foreignKeys)}.`,
    );
  }
  const journalMode = client.pragma("journal_mode");
  if (String(journalMode).toLowerCase() !== expected.journalMode) {
    throw new Error(
      `PRAGMA journal_mode expected ${expected.journalMode} but got ${String(journalMode)}.`,
    );
  }
  const synchronous = client.pragma("synchronous");
  if (Number(synchronous) !== (expected.synchronous === "normal" ? 1 : 2)) {
    throw new Error(
      `PRAGMA synchronous expected ${expected.synchronous} but got ${String(synchronous)}.`,
    );
  }
  const busyTimeout = client.pragma("busy_timeout");
  if (Number(busyTimeout) !== expected.busyTimeoutMs) {
    throw new Error(
      `PRAGMA busy_timeout expected ${expected.busyTimeoutMs} but got ${String(busyTimeout)}.`,
    );
  }
  return {
    foreignKeys: expected.foreignKeys,
    journalMode: expected.journalMode,
    synchronous: expected.synchronous,
    busyTimeoutMs: expected.busyTimeoutMs,
  };
}

/**
 * Create a {@link SqliteAppStateStore} for the database at `path`.
 *
 * The store does not open the connection until {@link SqliteAppStateStore.open}
 * is called, so construction never touches the filesystem and tests can build a
 * store for a not-yet-existing temp path.
 */
export function createSqliteAppStateStore(
  path: string,
  options: SqliteAppStateStoreOptions = {},
): SqliteAppStateStore {
  const pragmas = options.pragmas ?? DEFAULT_SQLITE_PRAGMAS;
  const migrations = options.migrations ?? MIGRATIONS;
  const now = options.now ?? (() => new Date().toISOString());
  const driverProvider =
    options.driver === undefined
      ? getSqliteDriver
      : typeof options.driver === "function"
        ? (options.driver as () => Promise<SqliteDriver>)
        : () => Promise.resolve(options.driver);

  let client: SqliteClient | null = null;
  let queue: Promise<unknown> = Promise.resolve();

  async function open(): Promise<SqliteAppStateOpenResult> {
    if (client) {
      // Already open: nothing to migrate this run. Report the configured
      // PRAGMAs without re-verifying (they were verified on the first open).
      return { migrations: { appliedVersion: 0, newlyApplied: [] }, pragmas };
    }

    // Ensure the parent directory exists; both drivers open read/write/create
    // and fail if the directory is missing.
    await mkdir(dirname(path), { recursive: true });
    const driver = (await driverProvider()) as {
      open(p: string): SqliteClient;
    };
    const opened = driver.open(path);
    try {
      const verified = applyAndVerifyPragmas(opened, pragmas);
      const outcome = runMigrations(opened, migrations, { now });
      client = opened;
      return {
        migrations: {
          appliedVersion: outcome.appliedVersion,
          newlyApplied: outcome.newlyApplied,
        },
        pragmas: verified,
      };
    } catch (error) {
      try {
        opened.close();
      } catch {
        // Preserve the initialization error that caused recovery-required.
      }
      throw error;
    }
  }

  function run<T>(work: (client: SqliteClient) => T | Promise<T>): Promise<T> {
    const result = queue.then(async () => {
      if (!client) throw new Error("SQLite App State Store is not open.");
      return work(client);
    });
    queue = result.then(
      () => {},
      () => {},
    );
    return result as Promise<T>;
  }

  function waitForIdle(): Promise<void> {
    return queue.then(() => {});
  }

  function saveAppStateSnapshot(snapshot: AppStateSnapshot): Promise<void> {
    // Full replacement is reserved for complete snapshots (import, recovery,
    // reset, test fixtures): the persisted-snapshot normalizer requires every
    // history collection to be present, so a partial snapshot is rejected
    // loudly instead of silently wiping the rows it omits.
    const normalized = normalizePersistedAppStateSnapshot(snapshot);
    if (!normalized) return Promise.reject(new Error("Invalid App State snapshot."));
    return run((connection) =>
      connection.transaction(() => replaceAppStateSnapshot(connection, normalized)),
    );
  }

  function loadAppStateSnapshot(): Promise<AppStateSnapshot | null> {
    return run((connection) => readAppStateSnapshot(connection));
  }

  function deleteAppStateForThreads(
    operationId: string,
    threadIds: string[],
    scope?: ThreadDeletionScope,
    onCommitted?: (removedProviderSessions: Record<string, string>) => void,
  ): Promise<{
    appState: AppStateSnapshot;
    removedProviderSessions: Record<string, string>;
  }> {
    // The whole row-level deletion owns one transaction on the serialized
    // queue, so any constraint or statement failure rolls back every deleted
    // row and leaves the pre-deletion state authoritative.
    return run((connection) => {
      const result = connection.transaction(() => {
        const deletion = deleteThreadsFromAppState(connection, operationId, threadIds, scope);
        const appState = readAppStateSnapshot(connection);
        if (!appState) throw new Error("Thread deletion produced invalid App State.");
        return { appState, ...deletion };
      });
      onCommitted?.(result.removedProviderSessions);
      return result;
    });
  }

  function hasCommittedThreadDeletion(operationId: string): Promise<boolean> {
    return run(
      (connection) =>
        connection.get(
          "SELECT key FROM app_metadata WHERE key = ?",
          threadDeletionOperationKey(operationId),
        ) !== null,
    );
  }

  function clearCommittedThreadDeletionMarker(operationId: string): Promise<void> {
    return run((connection) => {
      connection.run(
        "DELETE FROM app_metadata WHERE key = ?",
        threadDeletionOperationKey(operationId),
      );
    });
  }

  function relocateProject(request: {
    projectId: string;
    beforeWorkingDirectory: string;
    targetDirectory: string;
    threadIds: string[];
    providerSessions: Record<string, string>;
  }): Promise<{
    appState: AppStateSnapshot;
    removedProviderSessions: Record<string, string>;
  }> {
    return run((connection) => {
      return connection.transaction(() => {
        const result = relocateProjectInAppState(connection, request);
        const appState = readAppStateSnapshot(connection);
        if (!appState) throw new Error("Project relocation produced invalid App State.");
        return { appState, ...result };
      });
    });
  }

  function persistAppStateCommand(
    command: AppStateCommand,
    before: AppStateSnapshot,
    after: AppStateSnapshot,
  ): Promise<void> {
    const normalizedBefore = normalizePersistedAppStateSnapshot(before);
    const normalizedAfter = normalizePersistedAppStateSnapshot(after);
    if (!normalizedBefore || !normalizedAfter) {
      return Promise.reject(new Error("Invalid App State command snapshots."));
    }
    return run((connection) =>
      connection.transaction(() =>
        persistIncrementalAppStateCommand(connection, command, normalizedBefore, normalizedAfter),
      ),
    );
  }

  async function close(): Promise<void> {
    await queue.then(() => {
      if (client) {
        client.close();
        client = null;
      }
    });
  }

  return {
    open,
    run,
    saveAppStateSnapshot,
    persistAppStateCommand,
    loadAppStateSnapshot,
    deleteAppStateForThreads,
    hasCommittedThreadDeletion,
    clearCommittedThreadDeletionMarker,
    relocateProject,
    waitForIdle,
    close,
    get isOpen() {
      return client !== null;
    },
    get path() {
      return path;
    },
  };
}
