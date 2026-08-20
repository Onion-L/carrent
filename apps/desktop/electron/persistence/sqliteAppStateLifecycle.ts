import { mkdir, readdir, rename as renameFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
  createEmptyAppStateSnapshot,
  type AppStateDiagnostic,
  type AppStateLoadResult,
  type AppStateRecoveryStage,
} from "../../src/shared/workspacePersistence";
import {
  JSON_IMPORT_MARKER,
  initializeSqliteAppState,
  type SqliteAppStateImportOptions,
} from "./sqliteAppStateImport";
import { readAppStateSnapshot, replaceAppStateSnapshot } from "./sqliteAppStateRepository";
import type { SqliteAppStateStore } from "./sqliteAppStateStore";

/**
 * SQLite App State recovery lifecycle.
 *
 * This is the SQLite analogue of the JSON store's
 * {@link import("./../workspace/appStateStore").createAppStateStore} recovery
 * behavior: it owns startup load (`initialize`), reload (`reread`), and Full
 * Reset (`fullReset`) for the SQLite App State Store, returning the same
 * {@link AppStateLoadResult} contract the existing
 * `createAppStateLifecycle` / `appStateIpc` / `appStateAuthority` machinery
 * already speaks. Production wiring (replacing the JSON store in `main.ts`) is
 * the issue 12 cutover; this module is built and contract-tested here.
 *
 * The lifecycle never exposes a half-initialized state: a load, migration,
 * schema, constraint, or repository validation failure produces
 * `recovery-required`, a reread replaces the authoritative snapshot only on
 * full success, and Full Reset stages its removals so a staging/write/cleanup
 * failure restores the moved files and stays `recovery-required` instead of
 * surfacing a ready state that mixes old and new data.
 *
 * Diagnostics carry only the app version, failure area, stage, summary, path,
 * time, and stable ids — never message, Draft, attachment, or Provider Session
 * content.
 */
export type SqliteAppStateLifecycleOptions = SqliteAppStateImportOptions & {
  /**
   * Override the on-disk database filename (default `carrent.sqlite`). Reset
   * derives the WAL/SHM sidecar paths from it.
   */
  databaseName?: string;
  /** Override filesystem rename (test seam mirroring the JSON store). */
  rename?: (from: string, to: string) => Promise<void>;
  /** Override filesystem remove (test seam mirroring the JSON store). */
  remove?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
  /** Override directory listing (test seam mirroring the import module). */
  readDirectory?: (path: string) => Promise<readonly string[]>;
};

const DEFAULT_DATABASE_NAME = "carrent.sqlite";
const RESET_STAGING_DIRECTORY = ".app-state-reset";

// Carrent-owned paths reset must clean. Mirrors the JSON store's
// RESETTABLE_PATHS plus the SQLite database, its WAL/SHM sidecars, and the
// import/recovery artifacts the SQLite path introduces. Project working
// directories, project files, and Git state are intentionally absent: Full
// Reset never scans or modifies them.
const RESETTABLE_OWNED_PATHS = [
  "app-state.json",
  "app-state.initialized",
  "workspace.json",
  "provider-sessions.json",
  "attachments",
  "carrent-chat",
  "thread-deletion-journal.json",
] as const;

const RESETTABLE_PREFIXES = [
  "app-state.json.tmp-",
  "app-state.initialized.tmp-",
  "workspace.json.tmp-",
  "provider-sessions.json.tmp-",
  "provider-sessions.corrupt-",
  "thread-deletion-journal.json.tmp-",
  "app-state.recovery-",
  "app-state.imported-",
  "attachments-delete-",
  "attachments-backup-",
] as const;

function buildDiagnostic(
  appVersion: string,
  occurredAt: string,
  dataPath: string,
  stage: AppStateRecoveryStage,
  summary: string,
): AppStateDiagnostic {
  return {
    appVersion,
    subsystem: "app-state",
    stage,
    summary,
    dataPath,
    occurredAt,
  };
}

/**
 * Diagnostics surface the failure area and stage but never interpolate a raw
 * error message: a thrown value can carry a Provider Profile id, a Thread title,
 * or attachment content, and the diagnostic summary is a content-bearing surface.
 * The store logs the underlying error separately; the diagnostic keeps a fixed,
 * stage-specific description so message/Draft/attachment/Provider content cannot
 * leak into a recovery-required result.
 */

function recoveryResult(diagnostics: AppStateDiagnostic[]): AppStateLoadResult {
  return { status: "recovery-required", diagnostics: [...diagnostics] };
}

/**
 * Create the SQLite App State recovery lifecycle for `store` rooted at
 * `baseDir`. Construction never touches the filesystem; each method opens or
 * reuses the store connection as needed.
 */
export function createSqliteAppStateLifecycle(
  store: SqliteAppStateStore,
  baseDir: string,
  options: SqliteAppStateLifecycleOptions = {},
) {
  const appVersion = options.appVersion ?? "unknown";
  const databaseName = options.databaseName ?? DEFAULT_DATABASE_NAME;
  const rename = options.rename ?? renameFile;
  const remove = options.remove ?? rm;
  const readDirectory = options.readDirectory ?? readdir;
  const now = options.now ?? (() => new Date().toISOString());
  const dataPath = join(baseDir, databaseName);

  function diagnostic(stage: AppStateRecoveryStage, summary: string): AppStateDiagnostic {
    return buildDiagnostic(appVersion, now(), dataPath, stage, summary);
  }

  /**
   * Startup load. Opens (applying PRAGMAs + migrations) and runs the JSON→SQLite
   * import decision. Any open, migration, schema, constraint, or repository
   * validation failure becomes `recovery-required`, which the existing IPC gate
   * and authority treat as a block on normal navigation, Runs, and writes.
   */
  async function initialize(): Promise<AppStateLoadResult> {
    try {
      await store.open();
    } catch {
      // Open covers connection, PRAGMA, migration, and schema failures. The
      // underlying error is logged by the store; the diagnostic uses a fixed
      // area description so no thrown content reaches the recovery summary.
      return recoveryResult([
        diagnostic("read", "SQLite App State could not be opened or migrated."),
      ]);
    }

    const importResult = await initializeSqliteAppState(store, baseDir, options);
    if (importResult.status === "recovery-required") {
      return recoveryResult(importResult.diagnostics);
    }
    return { status: "ready", snapshot: importResult.snapshot };
  }

  /**
   * Reload the authoritative snapshot over the safe single connection, re-running
   * repository validation. The authoritative snapshot is replaced only on full
   * success; a failed reread returns `recovery-required` and the caller keeps the
   * prior in-memory snapshot.
   */
  async function reread(): Promise<AppStateLoadResult> {
    if (!store.isOpen) {
      try {
        await store.open();
      } catch {
        return recoveryResult([
          diagnostic("read", "SQLite App State could not be reopened for reread."),
        ]);
      }
    }
    const snapshot = await store.loadAppStateSnapshot();
    if (!snapshot) {
      return recoveryResult([
        diagnostic("validate", "SQLite App State repository validation failed on reread."),
      ]);
    }
    return { status: "ready", snapshot };
  }

  async function pathExists(name: string): Promise<boolean> {
    try {
      const entries = await readDirectory(baseDir);
      return entries.includes(name);
    } catch {
      return false;
    }
  }

  /**
   * Enumerate the owned reset targets that currently exist in `baseDir`: the
   * fixed owned paths, the SQLite database and its WAL/SHM sidecars, plus any
   * dynamic entries matching the reset prefixes (import/recovery artifacts and
   * attachment staging directories). Reads the directory once.
   */
  async function collectResetTargets(): Promise<string[]> {
    let entries: readonly string[];
    try {
      entries = await readDirectory(baseDir);
    } catch {
      entries = [];
    }
    const present = new Set(entries);
    const candidateNames = [
      ...RESETTABLE_OWNED_PATHS,
      databaseName,
      `${databaseName}-wal`,
      `${databaseName}-shm`,
    ];
    const targets: string[] = candidateNames.filter((name) => present.has(name));
    for (const entry of entries) {
      if (
        RESETTABLE_PREFIXES.some((prefix) => entry.startsWith(prefix)) &&
        !targets.includes(entry)
      ) {
        targets.push(entry);
      }
    }
    return targets;
  }

  async function rollbackReset(stagedNames: string[]): Promise<void> {
    const errors: unknown[] = [];
    for (const name of stagedNames.reverse()) {
      try {
        await rename(join(RESET_STAGING_DIRECTORY, name), join(baseDir, name));
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length === 0) {
      try {
        await remove(join(baseDir, RESET_STAGING_DIRECTORY), {
          recursive: true,
          force: true,
        });
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "SQLite App State reset rollback failed.");
    }
  }

  /**
   * Full Reset. Quiesces and closes the connection, stages the owned reset
   * targets, removes them, initializes a fresh empty database with the no-source
   * import marker, and cleans up staging — without an application restart. A
   * staging, write, or cleanup failure restores the staged files and stays
   * `recovery-required`, so a half-old/half-new ready state is never exposed.
   * Project working directories, project files, and Git state are untouched.
   */
  async function fullReset(): Promise<AppStateLoadResult> {
    const stagingPath = join(baseDir, RESET_STAGING_DIRECTORY);
    // Quiesce pending writes before removing the database so no accepted change
    // overlaps the removal.
    await store.waitForIdle();
    try {
      await store.close();
    } catch (error) {
      // Closing is best-effort before removal: the process must still reach a
      // clean state. A close failure is recorded but does not abort reset.
      void error;
    }

    // A leftover staging directory means an earlier reset did not finish; treat
    // it as recovery-required rather than guessing at partial state.
    if (await pathExists(RESET_STAGING_DIRECTORY)) {
      return recoveryResult([
        diagnostic("reset-cleanup", "An earlier SQLite App State reset did not finish cleanup."),
      ]);
    }

    let stagedNames: string[] = [];
    try {
      await remove(stagingPath, { recursive: true, force: true });
      await mkdir(stagingPath, { recursive: true });
      const targets = await collectResetTargets();
      for (const name of targets) {
        await rename(join(baseDir, name), join(stagingPath, name));
        stagedNames.push(name);
      }
    } catch {
      try {
        await rollbackReset(stagedNames);
      } catch {
        return recoveryResult([
          diagnostic("reset-stage", "Reset staging failed and could not be rolled back."),
        ]);
      }
      return recoveryResult([
        diagnostic("reset-stage", "Reset staging failed; staged files were restored."),
      ]);
    }

    // Initialize a fresh empty database with the no-source import marker in one
    // transaction so the empty snapshot and the marker commit together.
    const empty = createEmptyAppStateSnapshot();
    const completedAt = now();
    try {
      await store.open();
      await store.run((client) =>
        client.transaction(() => {
          replaceAppStateSnapshot(client, empty);
          client.run(
            "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
            JSON_IMPORT_MARKER,
            JSON.stringify({ source: "none", completedAt }),
          );
        }),
      );
    } catch {
      try {
        await store.close();
      } catch {
        // Best-effort: rolling back the file state is what matters.
      }
      try {
        await rollbackReset(stagedNames);
      } catch {
        return recoveryResult([
          diagnostic("reset-write", "Reset write failed and could not be rolled back."),
        ]);
      }
      return recoveryResult([
        diagnostic(
          "reset-write",
          "Reset fresh database initialization failed; staged files were restored.",
        ),
      ]);
    }

    try {
      await remove(stagingPath, { recursive: true, force: true });
    } catch {
      // The fresh database and marker already committed, so the next startup
      // reopens ready; but per the JSON-store contract a cleanup failure stays
      // recovery-required rather than surfacing ready.
      return recoveryResult([
        diagnostic("reset-cleanup", "Reset cleanup of the staging directory failed."),
      ]);
    }

    return { status: "ready", snapshot: empty, notice: "full-reset" };
  }

  return {
    initialize,
    reread,
    fullReset,
    /** Exposed for tests/inspection: the resolved database path. */
    get path() {
      return dataPath;
    },
  };
}

export type SqliteAppStateLifecycle = ReturnType<typeof createSqliteAppStateLifecycle>;

/**
 * Read the persisted App State Snapshot directly from a client, used by the
 * lifecycle's contract tests and any caller that needs the raw repository read
 * without going through the store queue. Re-exported from the repository.
 */
export { readAppStateSnapshot };
