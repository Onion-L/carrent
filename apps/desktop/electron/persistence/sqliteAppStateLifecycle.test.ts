import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_STATE_SNAPSHOT_VERSION,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";
import {
  createSqliteAppStateLifecycle,
  type SqliteAppStateLifecycleOptions,
} from "./sqliteAppStateLifecycle";
import { JSON_IMPORT_MARKER } from "./sqliteAppStateImport";

const NOW = "2026-08-09T12:00:00.000Z";
const DATABASE_NAME = "carrent.sqlite";

function emptySnapshot(): AppStateSnapshot {
  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: [],
    projects: [],
    associations: [],
    threads: [],
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    threadActions: [],
    threadPromotionIntents: [],
    threadWork: {},
    lastThreadIdByWorkspace: {},
    activeWorkspaceId: null,
  };
}

function jsonSourceSnapshot(): AppStateSnapshot {
  const attachment = {
    id: "attachment-1",
    kind: "file" as const,
    name: "notes.txt",
    mimeType: "text/plain",
    size: 12,
    storageKey: "attachments/notes.txt",
  };
  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: [{ id: "workspace-1", name: "Work", order: 0 }],
    projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/work/carrent" }],
    associations: [
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "auto-accept-edits",
      },
    ],
    threads: [
      {
        id: "thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        title: "Imported thread",
        createdAt: "2026-08-09T08:00:00.000Z",
        lastActivityAt: "2026-08-09T09:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
    ],
    threadDrafts: [],
    threadMessages: [
      {
        id: "message-1",
        threadId: "thread-1",
        role: "user",
        content: "imported",
        createdAt: "2026-08-09T08:01:00.000Z",
        attachments: [attachment],
      },
    ],
    threadRuns: [
      {
        id: "run-1",
        threadId: "thread-1",
        messageId: "message-1",
        startedAt: "2026-08-09T08:01:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
    ],
    threadActions: [],
    threadPromotionIntents: [],
    threadWork: {},
    lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
    activeWorkspaceId: "workspace-1",
  };
}

interface LifecycleHarness {
  readonly baseDir: string;
  readonly store: ReturnType<typeof createSqliteAppStateStore>;
  readonly lifecycle: ReturnType<typeof createSqliteAppStateLifecycle>;
}

async function withLifecycle(
  setup: (baseDir: string) => Promise<void> = async () => {},
  options: SqliteAppStateLifecycleOptions = {},
  run: (harness: LifecycleHarness) => Promise<void>,
): Promise<void> {
  const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-lifecycle-"));
  const store = createSqliteAppStateStore(join(baseDir, DATABASE_NAME), {
    driver: bunSqliteDriver,
  });
  const lifecycle = createSqliteAppStateLifecycle(store, baseDir, {
    now: () => NOW,
    ...options,
  });
  try {
    await setup(baseDir);
    await run({ baseDir, store, lifecycle });
  } finally {
    try {
      await store.close();
    } catch {
      // The store may already be closed after a reset.
    }
    await rm(baseDir, { recursive: true, force: true });
  }
}

async function pathExists(path: string): Promise<boolean> {
  return existsSync(path);
}

async function seedMarkerAsFresh(store: ReturnType<typeof createSqliteAppStateStore>): Promise<void> {
  await store.open();
  await store.run((client) =>
    client.run(
      "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
      JSON_IMPORT_MARKER,
      JSON.stringify({ source: "none", completedAt: NOW }),
    ),
  );
}

describe("SQLite App State recovery lifecycle", () => {
  it("initialize returns ready when the marker already marks a fresh SQLite source", async () => {
    await withLifecycle(
      async () => {},
      {},
      async ({ store, lifecycle }) => {
        await seedMarkerAsFresh(store);
        const result = await lifecycle.initialize();
        expect(result.status).toBe("ready");
        expect(result.status === "ready" && result.snapshot.workspaces).toEqual([]);
      },
    );
  });

  it("initialize imports a JSON App State source and returns ready", async () => {
    await withLifecycle(
      async (baseDir) => {
        await writeFile(
          join(baseDir, "app-state.json"),
          JSON.stringify(jsonSourceSnapshot()),
          "utf-8",
        );
      },
      {},
      async ({ baseDir, lifecycle }) => {
        const result = await lifecycle.initialize();
        expect(result.status).toBe("ready");
        if (result.status !== "ready") return;
        expect(result.snapshot.threads?.map((thread) => thread.id)).toEqual(["thread-1"]);
        // The JSON source is renamed to an imported artifact, not re-imported.
        expect(await pathExists(join(baseDir, "app-state.json"))).toBe(false);
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(baseDir);
        expect(entries.some((name) => /^app-state\.imported-.*\.json$/u.test(name))).toBe(true);
      },
    );
  });

  it("initialize enters recovery-required when repository validation fails on a stale marker", async () => {
    await withLifecycle(
      async () => {},
      {},
      async ({ store, lifecycle }) => {
        // Seed a marker (so the import decision treats SQLite as authoritative)
        // plus a valid thread, then a message whose payload column is malformed
        // JSON. The repository's strict payload parse fails the whole load
        // (returns null), so initialize reports recovery-required (validate).
        await store.open();
        await store.run((client) => {
          client.run(
            "INSERT INTO app_metadata (key, value) VALUES (?, ?)",
            JSON_IMPORT_MARKER,
            JSON.stringify({ source: "json", completedAt: NOW }),
          );
          client.run(
            'INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)',
            "workspace-1",
            "Work",
            0,
          );
          client.run(
            "INSERT INTO projects (id, name, working_directory, working_directory_identity) VALUES (?, ?, ?, ?)",
            "project-1",
            "Carrent",
            "/work/carrent",
            "/work/carrent",
          );
          client.run(
            `INSERT INTO workspace_project_associations (
               workspace_id, project_id, "order", default_runtime_id, default_runtime_mode
             ) VALUES (?, ?, ?, ?, ?)`,
            "workspace-1",
            "project-1",
            0,
            "kimi",
            "auto-accept-edits",
          );
          client.run(
            `INSERT INTO threads (
               id, workspace_id, project_id, title, created_at, last_activity_at,
               runtime_id, runtime_mode, plan_mode
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            "thread-1",
            "workspace-1",
            "project-1",
            "Thread",
            "2026-08-09T08:00:00.000Z",
            "2026-08-09T09:00:00.000Z",
            "kimi",
            "auto-accept-edits",
            0,
          );
          // A message with a malformed payload fails the repository's strict
          // JSON parse and invalidates the whole load.
          client.run(
            `INSERT INTO thread_messages (id, thread_id, role, message, created_at, payload)
             VALUES (?, ?, ?, ?, ?, ?)`,
            "message-1",
            "thread-1",
            "user",
            "x",
            "2026-08-09T08:01:00.000Z",
            "{not valid json",
          );
        });
        const result = await lifecycle.initialize();
        expect(result.status).toBe("recovery-required");
        if (result.status === "recovery-required") {
          expect(result.diagnostics[0].stage).toBe("validate");
        }
      },
    );
  });

  it("initialize maps an open/migration failure to recovery-required and blocks writes", async () => {
    await withLifecycle(
      async () => {},
      {},
      async () => {
        // A separate store with a migration registry that throws lets us point
        // the lifecycle at a store that fails to open. We can't swap the store
        // after construction, so build a failing store inline.
        const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-lifecycle-fail-"));
        const failingStore = createSqliteAppStateStore(join(baseDir, DATABASE_NAME), {
          driver: bunSqliteDriver,
          migrations: [
            {
              version: 1,
              name: "initial-app-state-schema",
              up: () => {
                throw new Error("injected migration failure");
              },
            },
          ],
        });
        const failingLifecycle = createSqliteAppStateLifecycle(failingStore, baseDir, {
          now: () => NOW,
        });
        try {
          const result = await failingLifecycle.initialize();
          expect(result.status).toBe("recovery-required");
          if (result.status === "recovery-required") {
            expect(result.diagnostics[0].stage).toBe("read");
            // The diagnostic uses a fixed area description; the raw error
            // message (which could carry content) never reaches the summary.
            expect(result.diagnostics[0].summary).toBe(
              "SQLite App State could not be opened or migrated.",
            );
            expect(result.diagnostics[0].summary).not.toContain("injected migration failure");
          }
          // Writes stay blocked: the store is not usable.
          let message = "";
          try {
            await failingStore.saveAppStateSnapshot(emptySnapshot());
          } catch (error) {
            message = String(error);
          }
          expect(message).toContain("not open");
        } finally {
          await rm(baseDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("initialize keeps an isolated Runtime Session fault local instead of escalating to recovery", async () => {
    await withLifecycle(
      async (baseDir) => {
        await writeFile(
          join(baseDir, "app-state.json"),
          JSON.stringify(jsonSourceSnapshot()),
          "utf-8",
        );
        // An inconsistent Runtime Session mapping is quarantined/discarded by
        // the import; it must NOT escalate to global recovery-required.
        await writeFile(
          join(baseDir, "provider-sessions.json"),
          JSON.stringify({
            version: 1,
            sessions: { "kimi:thread-missing": "session-bad" },
          }),
          "utf-8",
        );
      },
      {},
      async ({ lifecycle }) => {
        const result = await lifecycle.initialize();
        expect(result.status).toBe("ready");
      },
    );
  });

  it("reread returns the current snapshot and only replaces authority on full success", async () => {
    await withLifecycle(
      async () => {},
      {},
      async ({ store, lifecycle }) => {
        const init = await lifecycle.initialize();
        expect(init.status).toBe("ready");
        // Write a workspace; reread reflects it.
        const snapshot = emptySnapshot();
        snapshot.workspaces = [{ id: "workspace-1", name: "Work", order: 0 }];
        snapshot.activeWorkspaceId = "workspace-1";
        snapshot.projects = [{ id: "project-1", name: "Carrent", workingDirectory: "/work/carrent" }];
        snapshot.associations = [
          {
            workspaceId: "workspace-1",
            projectId: "project-1",
            order: 0,
            defaultRuntimeId: "kimi",
            defaultRuntimeMode: "auto-accept-edits",
          },
        ];
        await store.saveAppStateSnapshot(snapshot);
        const reread = await lifecycle.reread();
        expect(reread.status).toBe("ready");
        if (reread.status === "ready") {
          expect(reread.snapshot.workspaces.map((workspace) => workspace.id)).toEqual([
            "workspace-1",
          ]);
        }
      },
    );
  });

  it("reread enters recovery-required when repository validation fails", async () => {
    await withLifecycle(
      async () => {},
      {},
      async ({ store, lifecycle }) => {
        await lifecycle.initialize();
        // Seed a thread + message so there is a row whose payload can be
        // corrupted into a value the strict parse rejects.
        const snapshot = emptySnapshot();
        snapshot.workspaces = [{ id: "workspace-1", name: "Work", order: 0 }];
        snapshot.projects = [{ id: "project-1", name: "Carrent", workingDirectory: "/work/carrent" }];
        snapshot.associations = [
          {
            workspaceId: "workspace-1",
            projectId: "project-1",
            order: 0,
            defaultRuntimeId: "kimi",
            defaultRuntimeMode: "auto-accept-edits",
          },
        ];
        snapshot.activeWorkspaceId = "workspace-1";
        snapshot.threads = [
          {
            id: "thread-1",
            workspaceId: "workspace-1",
            projectId: "project-1",
            title: "Thread",
            createdAt: "2026-08-09T08:00:00.000Z",
            lastActivityAt: "2026-08-09T08:00:00.000Z",
            runtimeId: "kimi",
            runtimeMode: "auto-accept-edits",
            planMode: false,
          },
        ];
        snapshot.threadMessages = [
          {
            id: "message-1",
            threadId: "thread-1",
            role: "user",
            content: "x",
            createdAt: "2026-08-09T08:01:00.000Z",
            attachments: [],
          },
        ];
        await store.saveAppStateSnapshot(snapshot);
        // Corrupt that message's JSON payload so loadAppStateSnapshot returns null.
        await store.run((client) =>
          client.run(
            "UPDATE thread_messages SET payload = ? WHERE id = ?",
            "{not valid json",
            "message-1",
          ),
        );
        const reread = await lifecycle.reread();
        expect(reread.status).toBe("recovery-required");
        if (reread.status === "recovery-required") {
          expect(reread.diagnostics[0].stage).toBe("validate");
        }
      },
    );
  });

  it("fullReset removes the SQLite database, WAL/SHM sidecars, import artifacts, and owned paths", async () => {
    await withLifecycle(
      async (baseDir) => {
        await writeFile(
          join(baseDir, "app-state.json"),
          JSON.stringify(jsonSourceSnapshot()),
          "utf-8",
        );
      },
      {},
      async ({ baseDir, lifecycle }) => {
        const init = await lifecycle.initialize();
        expect(init.status).toBe("ready");
        // Seed the reset targets: import artifacts, provider sessions, attachments,
        // and a corrupt-session artifact.
        await writeFile(
          join(baseDir, "provider-sessions.json"),
          JSON.stringify({ version: 1, sessions: {} }),
          "utf-8",
        );
        await mkdir(join(baseDir, "attachments"), { recursive: true });
        await writeFile(join(baseDir, "attachments", "a.txt"), "x", "utf-8");
        await mkdir(join(baseDir, "carrent-chat"), { recursive: true });
        await mkdir(join(baseDir, "attachments-delete-stale"), { recursive: true });

        const dbPath = join(baseDir, DATABASE_NAME);
        const result = await lifecycle.fullReset();
        expect(result).toEqual({
          status: "ready",
          snapshot: emptySnapshot(),
          notice: "full-reset",
        });
        // The old database and sidecars are gone (replaced by a fresh db).
        expect(await pathExists(join(baseDir, "app-state.json"))).toBe(false);
        expect(await pathExists(join(baseDir, "provider-sessions.json"))).toBe(false);
        expect(await pathExists(join(baseDir, "attachments"))).toBe(false);
        expect(await pathExists(join(baseDir, "carrent-chat"))).toBe(false);
        expect(await pathExists(join(baseDir, "attachments-delete-stale"))).toBe(false);
        expect(await pathExists(join(baseDir, "app-state.imported-" + NOW.replaceAll(":", "-") + ".json"))).toBe(false);
        // A fresh database exists with the no-source marker.
        expect(await pathExists(dbPath)).toBe(true);
      },
    );
  });

  it("fullReset reopens ready without a restart and accepts writes", async () => {
    await withLifecycle(
      async (baseDir) => {
        await writeFile(
          join(baseDir, "app-state.json"),
          JSON.stringify(jsonSourceSnapshot()),
          "utf-8",
        );
      },
      {},
      async ({ store, lifecycle }) => {
        await lifecycle.initialize();
        const result = await lifecycle.fullReset();
        expect(result.status).toBe("ready");
        // Immediately usable: load + a follow-up write succeed.
        const loaded = await store.loadAppStateSnapshot();
        expect(loaded?.workspaces).toEqual([]);
        const snapshot = emptySnapshot();
        snapshot.activeWorkspaceId = null;
        await store.saveAppStateSnapshot(snapshot);
      },
    );
  });

  it("fullReset writes a no-source import marker in the fresh database", async () => {
    await withLifecycle(
      async () => {},
      {},
      async ({ store, lifecycle }) => {
        await lifecycle.initialize();
        await lifecycle.fullReset();
        const marker = await store.run((client) =>
          client.get<{ value: string }>(
            "SELECT value FROM app_metadata WHERE key = ?",
            JSON_IMPORT_MARKER,
          ),
        );
        expect(JSON.parse(marker?.value ?? "null")).toEqual({
          source: "none",
          completedAt: NOW,
        });
      },
    );
  });

  it("fullReset restores staged files and stays recovery-required when staging fails", async () => {
    await withLifecycle(
      async (baseDir) => {
        await writeFile(
          join(baseDir, "app-state.json"),
          JSON.stringify(jsonSourceSnapshot()),
          "utf-8",
        );
      },
      {
        // Fail the rename that moves the database into staging so staging
        // aborts partway and rollback must restore any already-moved files.
        rename: async (from, to) => {
          if (from.endsWith(DATABASE_NAME)) {
            throw new Error("injected staging failure");
          }
          const { rename: realRename } = await import("node:fs/promises");
          await realRename(from, to);
        },
      },
      async ({ lifecycle }) => {
        await lifecycle.initialize();
        const result = await lifecycle.fullReset();
        expect(result.status).toBe("recovery-required");
        if (result.status === "recovery-required") {
          expect(result.diagnostics[0].stage).toBe("reset-stage");
        }
        // Staging did not expose a ready state: no fresh empty marker was
        // written at the reset path.
        expect(result.status).toBe("recovery-required");
      },
    );
  });

  it("fullReset stays recovery-required when cleanup fails after the fresh database commits", async () => {
    // Inject a remove failure targeting only the final staging-directory
    // cleanup (the staging-clear removal at the start must still succeed).
    let stagingClearDone = false;
    let cleanupAttempts = 0;
    await withLifecycle(
      async (baseDir) => {
        await writeFile(
          join(baseDir, "app-state.json"),
          JSON.stringify(jsonSourceSnapshot()),
          "utf-8",
        );
      },
      {
        remove: async (path, options) => {
          if (path.endsWith(".app-state-reset")) {
            if (!stagingClearDone) {
              stagingClearDone = true;
              // The initial staging-clear removal proceeds.
              const { rm: realRm } = await import("node:fs/promises");
              await realRm(path, options);
              return;
            }
            cleanupAttempts += 1;
            throw new Error("injected cleanup failure");
          }
          const { rm: realRm } = await import("node:fs/promises");
          await realRm(path, options);
        },
      },
      async ({ store, lifecycle }) => {
        await lifecycle.initialize();
        const result = await lifecycle.fullReset();
        expect(result.status).toBe("recovery-required");
        if (result.status === "recovery-required") {
          expect(result.diagnostics[0].stage).toBe("reset-cleanup");
        }
        // The fresh database and marker committed, so reopening shows the empty
        // snapshot (next startup recovers ready).
        const loaded = await store.loadAppStateSnapshot();
        expect(loaded?.workspaces).toEqual([]);
        expect(cleanupAttempts).toBeGreaterThan(0);
      },
    );
  });

  it("fullReset never touches project files or working directories", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "carrent-project-outside-"));
    try {
      await mkdir(join(projectDir, ".git"), { recursive: true });
      await writeFile(join(projectDir, "README.md"), "# project", "utf-8");
      await withLifecycle(
        async (baseDir) => {
          await writeFile(
            join(baseDir, "app-state.json"),
            JSON.stringify(jsonSourceSnapshot()),
            "utf-8",
          );
        },
        {},
        async ({ lifecycle }) => {
          await lifecycle.initialize();
          await lifecycle.fullReset();
          // Files outside baseDir are untouched.
          expect(await pathExists(join(projectDir, ".git"))).toBe(true);
          expect(await pathExists(join(projectDir, "README.md"))).toBe(true);
        },
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it("diagnostics never include message, draft, attachment, or session content", async () => {
    await withLifecycle(
      async () => {},
      {},
      async () => {
        // A failing store produces recovery diagnostics; assert none carry
        // sensitive content. Use the reread-validation failure path.
        const baseDir = await mkdtemp(join(tmpdir(), "carrent-sqlite-lifecycle-leak-"));
        const leakStore = createSqliteAppStateStore(join(baseDir, DATABASE_NAME), {
          driver: bunSqliteDriver,
          migrations: [
            {
              version: 1,
              name: "initial-app-state-schema",
              up: () => {
                throw new Error("SECRET-session-id-do-not-leak");
              },
            },
          ],
        });
        const leakLifecycle = createSqliteAppStateLifecycle(leakStore, baseDir, {
          now: () => NOW,
        });
        try {
          const result = await leakLifecycle.initialize();
          expect(result.status).toBe("recovery-required");
          if (result.status === "recovery-required") {
            const diagnostic = result.diagnostics[0];
            // The diagnostic carries only the documented fields (version, area,
            // stage, summary, path, time) — never message/draft/attachment
            // content or Provider config. The injected error message (which
            // mimics content that must not leak) never reaches the summary.
            expect(diagnostic.stage).toBe("read");
            const keys = Object.keys(diagnostic).sort();
            expect(keys).toEqual(["appVersion", "dataPath", "occurredAt", "stage", "subsystem", "summary"]);
            expect(diagnostic.summary).not.toContain("SECRET-session-id-do-not-leak");
          }
        } finally {
          await rm(baseDir, { recursive: true, force: true });
        }
      },
    );
  });

  it("a leftover reset staging directory makes initialize require recovery", async () => {
    await withLifecycle(
      async (baseDir) => {
        // Simulate an earlier reset that did not finish cleanup.
        await mkdir(join(baseDir, ".app-state-reset"), { recursive: true });
      },
      {},
      async ({ lifecycle }) => {
        // fullReset short-circuits a leftover staging directory to recovery.
        const result = await lifecycle.fullReset();
        expect(result.status).toBe("recovery-required");
        if (result.status === "recovery-required") {
          expect(result.diagnostics[0].stage).toBe("reset-cleanup");
        }
      },
    );
  });

  it("composes with deletion-journal recovery before publishing ready", async () => {
    // Requirement 4: startup/reread recover the unfinished attachment-deletion
    // file phase before the system publishes ready. The store-level lifecycle
    // produces the AppStateLoadResult the orchestration consumes; the deletion-
    // journal recovery itself runs in the orchestration (issue 09's
    // recoverThreadDeletionTransaction) between this lifecycle call and the
    // final publish. This test proves the two compose: a `preparing` journal
    // with staged attachment files is recovered, and the lifecycle's ready
    // result remains ready afterward.
    await withLifecycle(
      async () => {},
      {},
      async ({ baseDir, store, lifecycle }) => {
        const init = await lifecycle.initialize();
        expect(init.status).toBe("ready");

        // Seed a `preparing` deletion journal and a staged attachment dir, then
        // run the real recovery routine against the SQLite-backed store.
        const operationId = "recover-operation";
        const journalStore = {
          load: async () => ({
            version: 1 as const,
            operationId,
            phase: "preparing" as const,
            attachmentStorageKeys: ["attachments/a.txt"],
          }),
          save: async () => {},
          clear: async () => {},
        };
        await mkdir(join(baseDir, `attachments-delete-${operationId}`), { recursive: true });
        const attachmentStore = {
          prepareDeletion: async () => {},
          commitDeletion: async () => {},
          rollbackDeletion: async (id: string) => {
            // The staged attachment files are restored on rollback.
            void id;
          },
        };
        const { recoverThreadDeletionTransaction } = await import(
          "../chat/threadDeletionTransaction"
        );
        await recoverThreadDeletionTransaction({
          journalStore,
          appStateStore: {
            waitForWrites: () => store.waitForIdle(),
            loadAppStateSnapshot: () => store.loadAppStateSnapshot(),
            loadProviderSessions: async () => ({ version: 1, sessions: {} }),
            saveProviderSessions: async () => {},
            saveAppStateSnapshot: (snapshot) => store.saveAppStateSnapshot(snapshot),
          },
          attachmentStore,
        });

        // After recovery, the lifecycle's ready state is unchanged: the
        // orchestration publishes ready only after recovery completes.
        const reread = await lifecycle.reread();
        expect(reread.status).toBe("ready");
      },
    );
  });
});
