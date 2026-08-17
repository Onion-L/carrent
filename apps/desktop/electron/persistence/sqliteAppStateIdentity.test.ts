import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_STATE_SNAPSHOT_VERSION,
  createEmptyAppStateSnapshot,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";

function completeIdentitySnapshot(): AppStateSnapshot {
  return {
    version: APP_STATE_SNAPSHOT_VERSION,
    workspaces: [
      { id: "workspace-a", name: "Work", order: 0 },
      { id: "workspace-b", name: "Personal", order: 1 },
    ],
    projects: [
      { id: "project-a", name: "Carrent", workingDirectory: "/work/carrent" },
      { id: "project-b", name: "Shared", workingDirectory: "/work/shared" },
    ],
    associations: [
      {
        workspaceId: "workspace-a",
        projectId: "project-a",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "auto-accept-edits",
      },
      {
        workspaceId: "workspace-a",
        projectId: "project-b",
        alias: "Shared tools",
        order: 1,
        defaultRuntimeId: "kimi",
        defaultRuntimeModelId: "kimi-k2.5",
        defaultRuntimeMode: "full-access",
      },
      {
        workspaceId: "workspace-b",
        projectId: "project-b",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
    ],
    threads: [
      {
        id: "thread-current",
        workspaceId: "workspace-a",
        projectId: "project-a",
        title: "SQLite identity graph",
        createdAt: "2026-08-09T08:00:00.000Z",
        lastActivityAt: "2026-08-09T09:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
      {
        id: "thread-archived",
        workspaceId: "workspace-a",
        projectId: "project-b",
        title: "Archived work",
        customTitle: true,
        createdAt: "2026-08-08T08:00:00.000Z",
        lastActivityAt: "2026-08-08T09:00:00.000Z",
        archived: true,
        pinned: true,
        runtimeId: "kimi",
        runtimeModelId: "kimi-k2.5",
        runtimeMode: "full-access",
        planMode: true,
      },
    ],
    threadDrafts: [
      {
        id: "draft-personal",
        threadId: "reserved-personal-thread",
        workspaceId: "workspace-b",
        projectId: "project-b",
        content: "Continue later",
        composerState: '{"root":{"children":[]}}',
        attachedSkillNames: ["tdd"],
        attachments: [
          {
            id: "attachment-1",
            kind: "file",
            name: "notes.txt",
            mimeType: "text/plain",
            size: 12,
            storageKey: "attachments/notes.txt",
          },
        ],
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: true,
      },
    ],
    threadMessages: [],
    threadRuns: [],
    threadActions: [],
    threadPromotionIntents: [],
    threadWork: {},
    settings: {
      autoDetectRuntimes: false,
      theme: "system",
      fontSize: 16,
      defaultEditorId: "",
      enhancedTerminalCompletion: false,
      terminalPanelHeight: 420,
      runtimeEnabledById: { kimi: false },
      runtimeDefaultModelById: { kimi: "kimi-k2.5" },
      customFontFamily: "",
    },
    lastThreadIdByWorkspace: {
      "workspace-a": "thread-current",
    },
    activeWorkspaceId: "workspace-a",
  };
}

describe("SQLite App State identity graph", () => {
  it("round-trips an empty App State Snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const empty = createEmptyAppStateSnapshot();
      await store.saveAppStateSnapshot(empty);

      expect(await store.loadAppStateSnapshot()).toEqual(empty);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("round-trips the complete identity graph after closing and reopening", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const first = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await first.open();
      await first.saveAppStateSnapshot(completeIdentitySnapshot());
      await first.close();

      const second = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await second.open();
      const firstRead = await second.loadAppStateSnapshot();
      const secondRead = await second.loadAppStateSnapshot();

      expect(firstRead).toEqual(completeIdentitySnapshot());
      expect(secondRead).toEqual(firstRead);
      await second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a draft reserved Thread ID that belongs to an existing Thread", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      await store.saveAppStateSnapshot(completeIdentitySnapshot());

      let rejected = false;
      try {
        await store.run((client) =>
          client.run(
            "UPDATE thread_drafts SET reserved_thread_id = ? WHERE id = ?",
            "thread-current",
            "draft-personal",
          ),
        );
      } catch {
        rejected = true;
      }

      expect(rejected).toBe(true);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("drops recent Thread mappings that target another Workspace or an archive", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      await store.saveAppStateSnapshot(completeIdentitySnapshot());
      await store.run((client) => {
        client.run(
          "UPDATE workspace_last_threads SET thread_id = ? WHERE workspace_id = ?",
          "thread-archived",
          "workspace-a",
        );
        client.run(
          "INSERT INTO workspace_last_threads (workspace_id, thread_id) VALUES (?, ?)",
          "workspace-b",
          "thread-current",
        );
      });

      expect((await store.loadAppStateSnapshot())?.lastThreadIdByWorkspace).toEqual({});
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("normalizes unknown and invalid Settings JSON fields on load", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      await store.saveAppStateSnapshot(completeIdentitySnapshot());
      await store.run((client) =>
        client.run(
          "UPDATE settings SET value = ? WHERE id = 1",
          JSON.stringify({
            theme: "neon",
            fontSize: 18,
            runtimeEnabledById: { kimi: "yes" },
            unknown: "discarded",
          }),
        ),
      );

      expect((await store.loadAppStateSnapshot())?.settings).toEqual({
        autoDetectRuntimes: true,
        theme: "dark",
        fontSize: 18,
        defaultEditorId: "",
        enhancedTerminalCompletion: true,
        terminalPanelHeight: 320,
        runtimeEnabledById: {},
        runtimeDefaultModelById: {},
        customFontFamily: "",
      });
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps the previous Snapshot when a constraint fails midway through replacement", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const empty = createEmptyAppStateSnapshot();
      await store.saveAppStateSnapshot(empty);
      await store.run((client) =>
        client.exec(`
          CREATE TRIGGER reject_project_b
          BEFORE INSERT ON projects
          WHEN NEW.id = 'project-b'
          BEGIN
            SELECT RAISE(ABORT, 'injected project constraint');
          END;
        `),
      );

      let rejected = false;
      try {
        await store.saveAppStateSnapshot(completeIdentitySnapshot());
      } catch {
        rejected = true;
      }

      expect(rejected).toBe(true);
      expect(await store.loadAppStateSnapshot()).toEqual(empty);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not return a partial Snapshot when stored Draft JSON is invalid", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      await store.saveAppStateSnapshot(completeIdentitySnapshot());
      await store.run((client) =>
        client.run(
          "UPDATE thread_drafts SET attachments = ? WHERE id = ?",
          "{malformed",
          "draft-personal",
        ),
      );

      expect(await store.loadAppStateSnapshot()).toBe(null);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("replaces conversation rows from the snapshot when rewriting Thread identity metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const snapshot = completeIdentitySnapshot();
      await store.saveAppStateSnapshot(snapshot);
      await store.run((client) => {
        client.run(
          `INSERT INTO thread_messages (id, thread_id, role, message, created_at, payload)
           VALUES (?, ?, ?, ?, ?, ?)`,
          "message-1",
          "thread-current",
          "user",
          "keep me",
          "2026-08-09T08:30:00.000Z",
          '{"attachments":[]}',
        );
        client.run(
          `INSERT INTO thread_actions (id, thread_id, action, runtime_id, completed_at)
           VALUES (?, ?, ?, ?, ?)`,
          "action-1",
          "thread-current",
          "compact",
          "kimi",
          "2026-08-09T08:40:00.000Z",
        );
        client.run(
          "INSERT INTO thread_work (thread_id, queued_messages) VALUES (?, ?)",
          "thread-current",
          "[]",
        );
      });

      // The snapshot claims this Thread has no history, so a full replacement
      // removes the rows that are not part of it.
      const renamed: AppStateSnapshot = {
        ...snapshot,
        threads: snapshot.threads?.map((thread) =>
          thread.id === "thread-current" ? { ...thread, title: "Renamed identity" } : thread,
        ),
      };
      await store.saveAppStateSnapshot(renamed);

      const counts = await store.run((client) => ({
        messages: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM thread_messages")
          ?.count,
        actions: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM thread_actions")
          ?.count,
        work: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM thread_work")?.count,
      }));
      expect(counts).toEqual({ messages: 0, actions: 0, work: 0 });
      expect((await store.loadAppStateSnapshot())?.threads?.[0]?.title).toBe("Renamed identity");
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back real foreign-key, unique, required, enum, and boolean failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();

      const attempts = [
        () =>
          store.run((client) =>
            client.transaction(() =>
              client.run(
                `INSERT INTO workspace_project_associations
                   (workspace_id, project_id, "order", default_runtime_id, default_runtime_mode)
                 VALUES (?, ?, ?, ?, ?)`,
                "missing-workspace",
                "missing-project",
                0,
                "kimi",
                "approval-required",
              ),
            ),
          ),
        () =>
          store.run((client) =>
            client.transaction(() => {
              client.run(
                'INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)',
                "workspace-1",
                "One",
                0,
              );
              client.run(
                'INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)',
                "workspace-2",
                "Two",
                0,
              );
            }),
          ),
        () =>
          store.run((client) =>
            client.transaction(() =>
              client.run(
                'INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)',
                null,
                "Missing ID",
                0,
              ),
            ),
          ),
        () =>
          store.run((client) =>
            client.transaction(() => {
              client.run(
                'INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)',
                "workspace-1",
                "One",
                0,
              );
              client.run(
                `INSERT INTO projects (id, name, working_directory, working_directory_identity)
                 VALUES (?, ?, ?, ?)`,
                "project-1",
                "One",
                "/work/one",
                "/work/one",
              );
              client.run(
                `INSERT INTO workspace_project_associations
                   (workspace_id, project_id, "order", default_runtime_id, default_runtime_mode)
                 VALUES (?, ?, ?, ?, ?)`,
                "workspace-1",
                "project-1",
                0,
                "invalid-runtime",
                "approval-required",
              );
            }),
          ),
        () =>
          store.run((client) =>
            client.transaction(() => {
              client.run(
                'INSERT INTO workspaces (id, name, "order") VALUES (?, ?, ?)',
                "workspace-1",
                "One",
                0,
              );
              client.run(
                `INSERT INTO projects (id, name, working_directory, working_directory_identity)
                 VALUES (?, ?, ?, ?)`,
                "project-1",
                "One",
                "/work/one",
                "/work/one",
              );
              client.run(
                `INSERT INTO workspace_project_associations
                   (workspace_id, project_id, "order", default_runtime_id, default_runtime_mode)
                 VALUES (?, ?, ?, ?, ?)`,
                "workspace-1",
                "project-1",
                0,
                "kimi",
                "approval-required",
              );
              client.run(
                `INSERT INTO threads (
                   id, workspace_id, project_id, title, created_at, last_activity_at,
                   runtime_id, runtime_mode, plan_mode
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                "thread-1",
                "workspace-1",
                "project-1",
                "Invalid boolean",
                "2026-08-09T08:00:00.000Z",
                "2026-08-09T08:00:00.000Z",
                "kimi",
                "approval-required",
                2,
              );
            }),
          ),
      ];

      for (const attempt of attempts) {
        let rejected = false;
        try {
          await attempt();
        } catch {
          rejected = true;
        }
        expect(rejected).toBe(true);
      }
      expect(
        await store.run(
          (client) =>
            client.get<{ count: number }>("SELECT COUNT(*) AS count FROM workspaces")?.count,
        ),
      ).toBe(0);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("avoids collisions between temporary Draft reservations and valid Thread IDs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-identity-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      const snapshot = completeIdentitySnapshot();
      snapshot.threadDrafts![0]!.id = "x";
      snapshot.threads?.push({
        id: "\u0000carrent-rewrite:78",
        workspaceId: "workspace-a",
        projectId: "project-a",
        title: "Valid unusual identity",
        createdAt: "2026-08-09T09:30:00.000Z",
        lastActivityAt: "2026-08-09T09:30:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      });
      await store.saveAppStateSnapshot(snapshot);

      await store.saveAppStateSnapshot(snapshot);

      expect(await store.loadAppStateSnapshot()).not.toBe(null);
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
