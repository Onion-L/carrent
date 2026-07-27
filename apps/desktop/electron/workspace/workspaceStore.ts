import {
  mkdir,
  readFile,
  readdir,
  rename as renameFile,
  rm,
  writeFile as writeFileContents,
} from "node:fs/promises";
import { join } from "node:path";
import {
  APP_STATE_SNAPSHOT_VERSION,
  createEmptyAppStateSnapshot,
  normalizeAppStateSnapshotForWrite,
  normalizePersistedAppStateSnapshot,
  normalizeProviderSessionSnapshot,
  normalizeWorkspaceSnapshot,
  type AppStateDiagnostic,
  type AppStateLoadResult,
  type AppStateSnapshot,
  type ProviderSessionSnapshot,
  type WorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";

export type WorkspaceStore = {
  waitForWrites: () => Promise<void>;
  initializeAppState: () => Promise<AppStateLoadResult>;
  fullResetAppState: () => Promise<AppStateLoadResult>;
  loadAppStateSnapshot: () => Promise<AppStateSnapshot | null>;
  saveAppStateSnapshot: (snapshot: AppStateSnapshot) => Promise<void>;
  loadWorkspaceSnapshot: () => Promise<WorkspaceSnapshot | null>;
  saveWorkspaceSnapshot: (snapshot: WorkspaceSnapshot) => Promise<void>;
  loadProviderSessions: () => Promise<ProviderSessionSnapshot>;
  saveProviderSessions: (snapshot: ProviderSessionSnapshot) => Promise<void>;
};

type WorkspaceStoreOptions = {
  appVersion?: string;
  now?: () => Date;
  rename?: (from: string, to: string) => Promise<void>;
  writeFile?: (path: string, data: string, encoding: "utf-8") => Promise<void>;
  remove?: (path: string, options: { recursive: true; force: true }) => Promise<void>;
};

const INITIALIZED_MARKER = "app-state.initialized";
const RESET_STAGING_DIRECTORY = ".app-state-reset";
const MISSING_APP_STATE_EVIDENCE_PATHS = [
  "provider-sessions.json",
  "attachments",
  "carrent-chat",
  "thread-deletion-journal.json",
] as const;
const MISSING_APP_STATE_EVIDENCE_PREFIXES = [
  "app-state.json.tmp-",
  `${INITIALIZED_MARKER}.tmp-`,
  "workspace.json.tmp-",
  "provider-sessions.json.tmp-",
  "thread-deletion-journal.json.tmp-",
] as const;
const RESETTABLE_PATHS = [
  "app-state.json",
  INITIALIZED_MARKER,
  "workspace.json",
  "provider-sessions.json",
  "attachments",
  "carrent-chat",
  "thread-deletion-journal.json",
] as const;

export function createWorkspaceStore(
  baseDir: string,
  options: WorkspaceStoreOptions = {},
): WorkspaceStore {
  const appStatePath = join(baseDir, "app-state.json");
  const initializedMarkerPath = join(baseDir, INITIALIZED_MARKER);
  const resetStagingPath = join(baseDir, RESET_STAGING_DIRECTORY);
  const workspacePath = join(baseDir, "workspace.json");
  const providerSessionsPath = join(baseDir, "provider-sessions.json");
  const rename = options.rename ?? renameFile;
  const writeFile = options.writeFile ?? writeFileContents;
  const remove = options.remove ?? rm;
  const now = options.now ?? (() => new Date());
  const appVersion = options.appVersion ?? "unknown";
  let writeQueue = Promise.resolve();
  let appStateBlocked = false;
  let diagnostics: AppStateDiagnostic[] = [];

  function enqueueWrite(write: () => Promise<void>) {
    const nextWrite = writeQueue.catch(() => {}).then(write);
    writeQueue = nextWrite.then(
      () => {},
      () => {},
    );
    return nextWrite;
  }

  async function atomicWrite(targetPath: string, data: string): Promise<void> {
    await mkdir(baseDir, { recursive: true });
    const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    try {
      await writeFile(tmpPath, data, "utf-8");
      await rename(tmpPath, targetPath);
    } catch (error) {
      await remove(tmpPath, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async function pathExists(path: string): Promise<boolean> {
    try {
      await readFile(path);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EISDIR") return true;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async function hasMissingAppStateEvidence(): Promise<boolean> {
    for (const name of MISSING_APP_STATE_EVIDENCE_PATHS) {
      if (await pathExists(join(baseDir, name))) return true;
    }
    const entries = await readdir(baseDir, { withFileTypes: true });
    return entries.some(
      (entry) =>
        (entry.isFile() &&
          MISSING_APP_STATE_EVIDENCE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) ||
        (entry.isDirectory() &&
          (entry.name.startsWith("attachments-delete-") ||
            entry.name.startsWith("attachments-backup-"))),
    );
  }

  function diagnostic(stage: AppStateDiagnostic["stage"], summary: string): AppStateDiagnostic {
    return {
      appVersion,
      subsystem: "app-state",
      stage,
      summary,
      dataPath: appStatePath,
      occurredAt: now().toISOString(),
    };
  }

  function requireAppStateRecovery(nextDiagnostic: AppStateDiagnostic): AppStateLoadResult {
    appStateBlocked = true;
    diagnostics = [...diagnostics, nextDiagnostic];
    return { status: "recovery-required", diagnostics: [...diagnostics] };
  }

  function markAppStateReady(
    snapshot: AppStateSnapshot,
    notice?: "legacy-reset" | "full-reset",
  ): AppStateLoadResult {
    appStateBlocked = false;
    diagnostics = [];
    return { status: "ready", snapshot, ...(notice ? { notice } : {}) };
  }

  function assertAppStateWritable() {
    if (appStateBlocked) throw new Error("App State recovery is required.");
  }

  async function rollbackReset(movedNames: string[], removeReplacementFiles: boolean) {
    const rollbackErrors: unknown[] = [];
    if (removeReplacementFiles) {
      for (const path of [appStatePath, initializedMarkerPath]) {
        try {
          await remove(path, { recursive: true, force: true });
        } catch (error) {
          rollbackErrors.push(error);
        }
      }
    }
    for (const name of movedNames.reverse()) {
      try {
        await rename(join(resetStagingPath, name), join(baseDir, name));
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length === 0) {
      try {
        await remove(resetStagingPath, { recursive: true, force: true });
      } catch (error) {
        rollbackErrors.push(error);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(rollbackErrors, "App State reset rollback failed.");
    }
  }

  async function resetOwnedData(
    notice: "legacy-reset" | "full-reset",
  ): Promise<AppStateLoadResult> {
    const snapshot = createEmptyAppStateSnapshot();
    const movedNames: string[] = [];
    try {
      await remove(resetStagingPath, { recursive: true, force: true });
      await mkdir(resetStagingPath, { recursive: true });
      const resetTransactionPaths = (await readdir(baseDir, { withFileTypes: true }))
        .filter(
          (entry) =>
            (entry.isFile() &&
              MISSING_APP_STATE_EVIDENCE_PREFIXES.some((prefix) =>
                entry.name.startsWith(prefix),
              )) ||
            (entry.isDirectory() &&
              (entry.name.startsWith("attachments-delete-") ||
                entry.name.startsWith("attachments-backup-"))),
        )
        .map((entry) => entry.name);
      for (const name of [...RESETTABLE_PATHS, ...resetTransactionPaths]) {
        const path = join(baseDir, name);
        if (!(await pathExists(path))) continue;
        await rename(path, join(resetStagingPath, name));
        movedNames.push(name);
      }
    } catch (error) {
      try {
        await rollbackReset(movedNames, false);
      } catch (rollbackError) {
        return requireAppStateRecovery(
          diagnostic("reset-stage", `Reset staging and rollback failed: ${String(rollbackError)}`),
        );
      }
      return requireAppStateRecovery(
        diagnostic("reset-stage", `Reset staging failed: ${String(error)}`),
      );
    }

    try {
      await atomicWrite(initializedMarkerPath, `${APP_STATE_SNAPSHOT_VERSION}\n`);
      await atomicWrite(appStatePath, JSON.stringify(snapshot, null, 2));
    } catch (error) {
      try {
        await rollbackReset(movedNames, true);
      } catch (rollbackError) {
        return requireAppStateRecovery(
          diagnostic("reset-write", `Reset write and rollback failed: ${String(rollbackError)}`),
        );
      }
      return requireAppStateRecovery(
        diagnostic("reset-write", `Reset snapshot write failed: ${String(error)}`),
      );
    }

    try {
      await remove(resetStagingPath, { recursive: true, force: true });
    } catch (error) {
      return requireAppStateRecovery(
        diagnostic("reset-cleanup", `Reset cleanup failed: ${String(error)}`),
      );
    }
    return markAppStateReady(snapshot, notice);
  }

  async function initializeAppState(): Promise<AppStateLoadResult> {
    if (await pathExists(resetStagingPath)) {
      return requireAppStateRecovery(
        diagnostic("reset-cleanup", "An earlier App State reset did not finish cleanup."),
      );
    }

    let raw: string | null = null;
    try {
      raw = await readFile(appStatePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        return requireAppStateRecovery(
          diagnostic("read", `App State could not be read: ${String(error)}`),
        );
      }
    }

    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return requireAppStateRecovery(diagnostic("parse", "App State JSON is malformed."));
      }
      const version =
        typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>).version
          : undefined;
      if (version !== APP_STATE_SNAPSHOT_VERSION) {
        return requireAppStateRecovery(
          diagnostic("schema-version", `Unsupported App State schema version: ${String(version)}`),
        );
      }
      const snapshot = normalizePersistedAppStateSnapshot(parsed);
      if (!snapshot) {
        return requireAppStateRecovery(
          diagnostic("validate", "App State records or references are invalid."),
        );
      }
      try {
        if (!(await pathExists(initializedMarkerPath))) {
          await atomicWrite(initializedMarkerPath, `${APP_STATE_SNAPSHOT_VERSION}\n`);
        }
      } catch (error) {
        return requireAppStateRecovery(
          diagnostic("reset-write", `App State initialization marker failed: ${String(error)}`),
        );
      }
      return markAppStateReady(snapshot);
    }

    if (await pathExists(initializedMarkerPath)) {
      return requireAppStateRecovery(
        diagnostic("read", "The established App State snapshot is missing."),
      );
    }

    if (await pathExists(workspacePath)) {
      try {
        const legacy = normalizeWorkspaceSnapshot(
          JSON.parse(await readFile(workspacePath, "utf-8")),
        );
        if (!legacy) {
          return requireAppStateRecovery(
            diagnostic("legacy-detection", "Existing data is not a recognized legacy schema."),
          );
        }
      } catch (error) {
        return requireAppStateRecovery(
          diagnostic("legacy-detection", `Legacy data could not be identified: ${String(error)}`),
        );
      }
      return resetOwnedData("legacy-reset");
    }

    if (await hasMissingAppStateEvidence()) {
      return requireAppStateRecovery(
        diagnostic("read", "Carrent-owned data remains while the App State snapshot is missing."),
      );
    }

    const snapshot = createEmptyAppStateSnapshot();
    try {
      await atomicWrite(initializedMarkerPath, `${APP_STATE_SNAPSHOT_VERSION}\n`);
      await atomicWrite(appStatePath, JSON.stringify(snapshot, null, 2));
      return markAppStateReady(snapshot);
    } catch (error) {
      return requireAppStateRecovery(
        diagnostic("reset-write", `Initial App State could not be created: ${String(error)}`),
      );
    }
  }

  return {
    waitForWrites: () => writeQueue,
    initializeAppState,
    fullResetAppState: () => resetOwnedData("full-reset"),

    async loadAppStateSnapshot(): Promise<AppStateSnapshot | null> {
      let raw: string;
      try {
        raw = await readFile(appStatePath, "utf-8");
      } catch {
        return null;
      }

      try {
        return normalizePersistedAppStateSnapshot(JSON.parse(raw));
      } catch {
        return null;
      }
    },

    async saveAppStateSnapshot(snapshot: AppStateSnapshot): Promise<void> {
      assertAppStateWritable();
      const normalized = normalizeAppStateSnapshotForWrite(snapshot);
      if (!normalized) {
        throw new Error("Invalid App State snapshot.");
      }
      const persisted = {
        ...normalized,
        threads: normalized.threads ?? [],
        threadDrafts: normalized.threadDrafts ?? [],
        threadMessages: normalized.threadMessages ?? [],
        threadRuns: normalized.threadRuns ?? [],
        threadPromotionIntents: normalized.threadPromotionIntents ?? [],
        lastThreadIdByWorkspace: normalized.lastThreadIdByWorkspace ?? {},
      };
      await enqueueWrite(async () => {
        await atomicWrite(appStatePath, JSON.stringify(persisted, null, 2));
        if (!(await pathExists(initializedMarkerPath))) {
          await atomicWrite(initializedMarkerPath, `${APP_STATE_SNAPSHOT_VERSION}\n`);
        }
      });
    },

    async loadWorkspaceSnapshot(): Promise<WorkspaceSnapshot | null> {
      let raw: string;
      try {
        raw = await readFile(workspacePath, "utf-8");
      } catch {
        return null;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        await rename(workspacePath, `${baseDir}/workspace.corrupt-${Date.now()}.json`);
        return null;
      }

      const snapshot = normalizeWorkspaceSnapshot(parsed);
      if (!snapshot) {
        await rename(workspacePath, `${baseDir}/workspace.corrupt-${Date.now()}.json`);
      }
      return snapshot;
    },

    async saveWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
      assertAppStateWritable();
      const normalized = normalizeWorkspaceSnapshot(snapshot);
      if (!normalized) {
        throw new Error("Invalid workspace snapshot.");
      }
      await enqueueWrite(() => atomicWrite(workspacePath, JSON.stringify(normalized, null, 2)));
    },

    async loadProviderSessions(): Promise<ProviderSessionSnapshot> {
      let raw: string;
      try {
        raw = await readFile(providerSessionsPath, "utf-8");
      } catch {
        return { version: 1, sessions: {} };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        await rename(
          providerSessionsPath,
          `${baseDir}/provider-sessions.corrupt-${Date.now()}.json`,
        );
        return { version: 1, sessions: {} };
      }

      const snapshot = normalizeProviderSessionSnapshot(parsed);
      if (!snapshot) {
        await rename(
          providerSessionsPath,
          `${baseDir}/provider-sessions.corrupt-${Date.now()}.json`,
        );
      }
      return snapshot ?? { version: 1, sessions: {} };
    },

    async saveProviderSessions(snapshot: ProviderSessionSnapshot): Promise<void> {
      assertAppStateWritable();
      await enqueueWrite(() =>
        atomicWrite(providerSessionsPath, JSON.stringify(snapshot, null, 2)),
      );
    },
  };
}
