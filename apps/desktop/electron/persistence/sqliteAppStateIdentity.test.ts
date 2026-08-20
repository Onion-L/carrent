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
        defaultProviderProfileId: "default",
        defaultAgentMode: "auto-edit",
      },
      {
        workspaceId: "workspace-a",
        projectId: "project-b",
        alias: "Shared tools",
        order: 1,
        defaultProviderProfileId: "default",
        defaultAgentMode: "full-project",
      },
      {
        workspaceId: "workspace-b",
        projectId: "project-b",
        order: 0,
        defaultProviderProfileId: "default",
        defaultAgentMode: "ask",
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
        providerProfileId: "default",
        agentMode: "auto-edit",
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
        providerProfileId: "default",
        agentMode: "full-project",
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
        providerProfileId: "default",
        agentMode: "ask",
      },
    ],
    threadMessages: [],
    threadRuns: [],
    threadPromotionIntents: [],
    threadWork: {},
    settings: {
      theme: "system",
      codeHighlightTheme: "nord",
      typographyMode: "simple",
      fontFamilySans: "",
      fontFamilyComposer: "",
      fontFamilyCode: "",
      fontFamilyTerminal: "",
      fontSizeInterface: 16,
      fontSizePrompt: 14,
      fontSizeCode: 13,
      fontSizeTerminal: 12,
      fontSmoothing: true,
      terminalFontForce: false,
      defaultEditorId: "",
      enhancedTerminalCompletion: false,
      terminalPanelHeight: 420,
    } as NonNullable<AppStateSnapshot["settings"]>,
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
            fontSizeInterface: 18,
            unknown: "discarded",
          }),
        ),
      );

      expect((await store.loadAppStateSnapshot())?.settings).toEqual({
        theme: "dark",
        codeHighlightTheme: "classic",
        typographyMode: "simple",
        fontFamilySans: "",
        fontFamilyComposer: "",
        fontFamilyCode: "",
        fontFamilyTerminal: "",
        fontSizeInterface: 18,
        fontSizePrompt: 14,
        fontSizeCode: 14,
        fontSizeTerminal: 12,
        fontSmoothing: true,
        terminalFontForce: false,
        defaultEditorId: "",
        enhancedTerminalCompletion: true,
        terminalPanelHeight: 320,
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
        work: client.get<{ count: number }>("SELECT COUNT(*) AS count FROM thread_work")?.count,
      }));
      expect(counts).toEqual({ messages: 0, work: 0 });
      expect((await store.loadAppStateSnapshot())?.threads?.[0]?.title).toBe("Renamed identity");
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back real foreign-key, unique, required, and enum failures", async () => {
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
                   (workspace_id, project_id, "order", default_provider_profile_id, default_agent_mode)
                 VALUES (?, ?, ?, ?, ?)`,
                "missing-workspace",
                "missing-project",
                0,
                "default",
                "ask",
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
                   (workspace_id, project_id, "order", default_provider_profile_id, default_agent_mode)
                 VALUES (?, ?, ?, ?, ?)`,
                "workspace-1",
                "project-1",
                0,
                "default",
                "invalid-mode",
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
                   (workspace_id, project_id, "order", default_provider_profile_id, default_agent_mode)
                 VALUES (?, ?, ?, ?, ?)`,
                "workspace-1",
                "project-1",
                0,
                "default",
                "ask",
              );
              client.run(
                `INSERT INTO threads (
                   id, workspace_id, project_id, title, created_at, last_activity_at,
                   provider_profile_id, agent_mode
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                "thread-1",
                "workspace-1",
                "project-1",
                "Invalid boolean",
                "2026-08-09T08:00:00.000Z",
                "2026-08-09T08:00:00.000Z",
                "default",
                "invalid-mode",
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
        providerProfileId: "default",
        agentMode: "ask",
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
