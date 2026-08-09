import { copyFile, readFile, readdir, rename } from "node:fs/promises";
import { join } from "node:path";
import {
  normalizePersistedAppStateSnapshot,
  normalizeProviderSessionSnapshot,
  createEmptyAppStateSnapshot,
  type AppStateDiagnostic,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { isInconsistentProviderSessionKey } from "../../src/shared/providerSessions";
import { runtimeIds, type RuntimeId } from "../../src/shared/runtimes";
import { readProviderSessions, replaceProviderSessions } from "./providerSessionRepository";
import { readAppStateSnapshot, replaceAppStateSnapshot } from "./sqliteAppStateRepository";
import type { SqliteClient } from "./sqliteClient";
import type { SqliteAppStateStore } from "./sqliteAppStateStore";

export const JSON_IMPORT_MARKER = "json-import-v1";

export type SqliteAppStateInitializationResult =
  | {
      status: "ready";
      source: "json" | "fresh" | "sqlite";
      snapshot: AppStateSnapshot;
      providerSessions: Record<string, string>;
      diagnostics: string[];
    }
  | { status: "recovery-required"; diagnostics: AppStateDiagnostic[] };

export type SqliteAppStateImportOptions = {
  appVersion?: string;
  now?: () => string;
  /** Test seam for simulating a process interruption before transaction commit. */
  beforeCommit?: () => void;
  /** Test seam for simulating a repository read-back mismatch. */
  beforeReadBack?: (client: SqliteClient) => void;
  /** Test seam for simulating Carrent-owned evidence inspection failures. */
  readDirectory?: (path: string) => Promise<readonly string[]>;
  /** Filesystem rename override used by failure-injection contract tests. */
  renameFile?: (from: string, to: string) => Promise<void>;
  /** Filesystem copy override used by recovery-copy failure tests. */
  copySource?: (from: string, to: string) => Promise<void>;
};

const FRESH_INSTALL_EVIDENCE_NAMES = new Set([
  "app-state.initialized",
  "provider-sessions.json",
  "attachments",
  "thread-deletion-journal.json",
  ".app-state-reset",
  "workspace.json",
  "carrent-chat",
]);

const FRESH_INSTALL_EVIDENCE_PREFIXES = [
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

function recoveryDiagnostic(
  appStatePath: string,
  appVersion: string,
  occurredAt: string,
  stage: AppStateDiagnostic["stage"],
  summary: string,
): SqliteAppStateInitializationResult {
  return {
    status: "recovery-required",
    diagnostics: [
      {
        appVersion,
        subsystem: "app-state",
        stage,
        summary,
        dataPath: appStatePath,
        occurredAt,
      },
    ],
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sortedBy<T>(items: readonly T[] | undefined, key: (item: T) => string): T[] {
  return [...(items ?? [])].sort((left, right) => key(left).localeCompare(key(right)));
}

function canonicalSnapshotJson(snapshot: AppStateSnapshot): string {
  return canonicalJson({
    ...snapshot,
    workspaces: sortedBy(
      snapshot.workspaces,
      (item) => `${String(item.order).padStart(12, "0")}:${item.id}`,
    ),
    projects: sortedBy(snapshot.projects, (item) => item.id),
    associations: sortedBy(
      snapshot.associations,
      (item) => `${item.workspaceId}:${String(item.order).padStart(12, "0")}:${item.projectId}`,
    ),
    threads: sortedBy(
      snapshot.threads,
      (item) => `${item.workspaceId}:${item.projectId}:${item.lastActivityAt}:${item.id}`,
    ),
    threadDrafts: sortedBy(
      snapshot.threadDrafts,
      (item) => `${item.workspaceId}:${item.projectId}:${item.id}`,
    ),
    threadMessages: sortedBy(
      snapshot.threadMessages,
      (item) => `${item.threadId}:${item.createdAt}:${item.id}`,
    ),
    threadRuns: sortedBy(
      snapshot.threadRuns,
      (item) => `${item.threadId}:${item.startedAt}:${item.id}`,
    ),
    threadActions: sortedBy(
      snapshot.threadActions,
      (item) => `${item.threadId}:${item.completedAt}:${item.id}`,
    ),
    threadPromotionIntents: sortedBy(snapshot.threadPromotionIntents, (item) => item.draftId),
  });
}

export async function initializeSqliteAppState(
  store: SqliteAppStateStore,
  baseDir: string,
  options: SqliteAppStateImportOptions = {},
): Promise<SqliteAppStateInitializationResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const appStatePath = join(baseDir, "app-state.json");
  const providerSessionsPath = join(baseDir, "provider-sessions.json");
  const completedAt = now();
  const appVersion = options.appVersion ?? "unknown";
  const renameFile = options.renameFile ?? rename;
  const copySource = options.copySource ?? copyFile;
  const existingMarker = await store.run((client) =>
    client.get<{ value: string }>(
      "SELECT value FROM app_metadata WHERE key = ?",
      JSON_IMPORT_MARKER,
    ),
  );
  if (existingMarker) {
    const snapshot = await store.loadAppStateSnapshot();
    if (!snapshot) {
      return recoveryDiagnostic(
        appStatePath,
        appVersion,
        completedAt,
        "validate",
        "SQLite App State is invalid after JSON import completed.",
      );
    }
    return {
      status: "ready",
      source: "sqlite",
      snapshot,
      providerSessions: await store.run((client) => readProviderSessions(client)),
      diagnostics: [],
    };
  }
  let rawAppState: string | null = null;
  try {
    rawAppState = await readFile(appStatePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      let entries: readonly string[];
      try {
        entries = options.readDirectory
          ? await options.readDirectory(baseDir)
          : await readdir(baseDir);
      } catch {
        return recoveryDiagnostic(
          appStatePath,
          appVersion,
          completedAt,
          "read",
          "Carrent-owned data evidence could not be inspected.",
        );
      }
      const evidence = entries.find(
        (entry) =>
          FRESH_INSTALL_EVIDENCE_NAMES.has(entry) ||
          FRESH_INSTALL_EVIDENCE_PREFIXES.some((prefix) => entry.startsWith(prefix)),
      );
      if (evidence) {
        return recoveryDiagnostic(
          appStatePath,
          appVersion,
          completedAt,
          "read",
          "Carrent-owned data remains while the App State source is missing.",
        );
      }

      const empty = createEmptyAppStateSnapshot();
      const existing = await store.run((client) => ({
        snapshot: readAppStateSnapshot(client),
        providerSessions: readProviderSessions(client),
        metadataCount:
          client.get<{ count: number }>("SELECT COUNT(*) AS count FROM app_metadata")?.count ?? 0,
      }));
      if (
        !existing.snapshot ||
        canonicalSnapshotJson(existing.snapshot) !== canonicalSnapshotJson(empty) ||
        Object.keys(existing.providerSessions).length > 0 ||
        existing.metadataCount > 0
      ) {
        return recoveryDiagnostic(
          appStatePath,
          appVersion,
          completedAt,
          "read",
          "SQLite contains App State without a completed JSON import marker.",
        );
      }

      await store.run((client) =>
        client.transaction(() => {
          replaceAppStateSnapshot(client, empty);
          replaceProviderSessions(client, {});
          client.run(
            "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
            JSON_IMPORT_MARKER,
            JSON.stringify({ source: "none", completedAt }),
          );
          options.beforeCommit?.();
        }),
      );
      return {
        status: "ready",
        source: "fresh",
        snapshot: empty,
        providerSessions: {},
        diagnostics: [],
      };
    }
    return recoveryDiagnostic(
      appStatePath,
      appVersion,
      completedAt,
      "read",
      "App State could not be read.",
    );
  }
  let parsedAppState: unknown;
  try {
    parsedAppState = JSON.parse(rawAppState);
  } catch {
    return recoveryDiagnostic(
      appStatePath,
      appVersion,
      completedAt,
      "parse",
      "App State JSON is malformed.",
    );
  }
  const snapshot = normalizePersistedAppStateSnapshot(parsedAppState);
  if (!snapshot) {
    return recoveryDiagnostic(
      appStatePath,
      appVersion,
      completedAt,
      "validate",
      "App State records or references are invalid.",
    );
  }

  const suffix = completedAt.replaceAll(":", "-");
  const diagnostics: string[] = [];
  const threadRuntimeIds = new Map(
    (snapshot.threads ?? []).map((thread) => [thread.id, thread.runtimeId]),
  );
  let providerSessions: Record<string, string> = {};
  try {
    const parsed = JSON.parse(await readFile(providerSessionsPath, "utf-8"));
    const normalized = normalizeProviderSessionSnapshot(parsed);
    if (!normalized) throw new Error("Invalid Runtime Session snapshot.");
    const rawSessions =
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as { sessions?: unknown }).sessions === "object" &&
      (parsed as { sessions?: unknown }).sessions !== null &&
      !Array.isArray((parsed as { sessions?: unknown }).sessions)
        ? ((parsed as { sessions: Record<string, unknown> }).sessions ?? {})
        : {};
    for (const key of Object.keys(rawSessions)) {
      if (!(key in normalized.sessions)) {
        diagnostics.push("An invalid Runtime Session mapping was discarded.");
      }
    }
    providerSessions = Object.fromEntries(
      Object.entries(normalized.sessions).filter(([key, sessionId]) => {
        const separator = key.indexOf(":");
        const runtimeId = key.slice(0, separator) as RuntimeId;
        const threadId = key.slice(separator + 1);
        const inconsistent = (snapshot.threads ?? []).some((thread) =>
          isInconsistentProviderSessionKey(key, thread.runtimeId, thread.id),
        );
        const valid =
          runtimeIds.includes(runtimeId) &&
          threadId.length > 0 &&
          threadRuntimeIds.get(threadId) === runtimeId &&
          sessionId.trim().length > 0 &&
          sessionId.trim() === sessionId &&
          !inconsistent;
        if (!valid) diagnostics.push("An invalid Runtime Session mapping was discarded.");
        return valid;
      }),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      diagnostics.push("Runtime Session data was malformed and was quarantined.");
      try {
        await renameFile(
          providerSessionsPath,
          join(baseDir, `provider-sessions.corrupt-${suffix}.json`),
        );
      } catch {
        diagnostics.push("Malformed Runtime Session data could not be quarantined.");
      }
    }
  }

  try {
    await copySource(appStatePath, join(baseDir, `app-state.recovery-${suffix}.json`));
  } catch {
    return recoveryDiagnostic(
      appStatePath,
      appVersion,
      completedAt,
      "read",
      "App State recovery copy could not be created.",
    );
  }

  await store.run((client) =>
    client.transaction(() => {
      replaceAppStateSnapshot(client, snapshot);
      replaceProviderSessions(client, providerSessions);
      options.beforeReadBack?.(client);
      const readBack = readAppStateSnapshot(client);
      if (!readBack || canonicalSnapshotJson(readBack) !== canonicalSnapshotJson(snapshot)) {
        throw new Error("Imported App State did not match repository read-back.");
      }
      client.run(
        "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
        JSON_IMPORT_MARKER,
        JSON.stringify({ source: "json", completedAt }),
      );
      options.beforeCommit?.();
    }),
  );

  try {
    await renameFile(appStatePath, join(baseDir, `app-state.imported-${suffix}.json`));
  } catch {
    diagnostics.push("Imported App State source could not be renamed.");
  }

  return {
    status: "ready",
    source: "json",
    snapshot,
    providerSessions: await store.run((client) => readProviderSessions(client)),
    diagnostics,
  };
}
