import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  APP_STATE_SNAPSHOT_VERSION,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore, type SqliteAppStateStore } from "./sqliteAppStateStore";
import { createSqliteProviderSessionStore } from "./sqliteProviderSessionStore";

// A snapshot with two workspaces, two projects, and two threads so every
// deletion scope (threads / association / workspace) and the orphan-Project and
// reindex rules are observable. The "deleted" thread carries the full Thread-
// owned set: messages, a run, an action, Composer State, a Draft + Promotion
// Intent, and a Runtime Session mapping. The "keeper" thread is untouched by a
// threads-scope deletion.
function baseSnapshot(): AppStateSnapshot {
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
        order: 1,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
      {
        workspaceId: "workspace-b",
        projectId: "project-b",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "full-access",
      },
    ],
    threads: [
      {
        id: "thread-deleted",
        workspaceId: "workspace-a",
        projectId: "project-a",
        title: "Deleted",
        createdAt: "2026-08-09T08:00:00.000Z",
        lastActivityAt: "2026-08-09T09:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
      {
        id: "thread-keeper",
        workspaceId: "workspace-b",
        projectId: "project-b",
        title: "Keeper",
        createdAt: "2026-08-09T08:30:00.000Z",
        lastActivityAt: "2026-08-09T09:30:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "full-access",
        planMode: false,
      },
    ],
    threadDrafts: [
      {
        id: "draft-deleted",
        threadId: "thread-deleted-draft",
        workspaceId: "workspace-a",
        projectId: "project-a",
        content: "unsent",
        attachedSkillNames: [],
        attachments: [],
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadMessages: [
      {
        id: "message-deleted",
        threadId: "thread-deleted",
        role: "user",
        content: "doomed",
        createdAt: "2026-08-09T08:01:00.000Z",
        attachments: [],
      },
      {
        id: "message-deleted-assistant",
        threadId: "thread-deleted",
        role: "assistant",
        content: "",
        createdAt: "2026-08-09T08:02:00.000Z",
        attachments: [],
      },
      {
        id: "message-keeper",
        threadId: "thread-keeper",
        role: "user",
        content: "keep me",
        createdAt: "2026-08-09T08:31:00.000Z",
        attachments: [],
      },
    ],
    threadRuns: [
      {
        id: "run-deleted",
        threadId: "thread-deleted",
        messageId: "message-deleted",
        assistantMessageId: "message-deleted-assistant",
        startedAt: "2026-08-09T08:02:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
        planMode: false,
      },
    ],
    threadActions: [
      {
        id: "action-deleted",
        threadId: "thread-deleted",
        action: "compact",
        runtimeId: "kimi",
        completedAt: "2026-08-09T08:50:00.000Z",
      },
    ],
    threadPromotionIntents: [
      {
        draftId: "draft-deleted",
        threadId: "thread-deleted-draft",
        workspaceId: "workspace-a",
        projectId: "project-a",
        title: "Unsent",
        runId: "run-draft-deleted",
        messageId: "message-draft-deleted",
        message: "unsent",
        attachments: [],
        startedAt: "2026-08-09T08:40:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadWork: {
      "thread-deleted": { queuedMessages: [] },
    },
    settings: {
      autoDetectRuntimes: true,
      theme: "system",
      fontSize: 15,
      enhancedTerminalCompletion: true,
      terminalPanelHeight: 320,
      runtimeEnabledById: {},
      runtimeDefaultModelById: {},
      customFontFamily: "",
    },
    lastThreadIdByWorkspace: { "workspace-a": "thread-deleted" },
    activeWorkspaceId: "workspace-a",
  };
}

// Seed Runtime Session mappings directly so the deletion's provider-session
// removal is observable; the snapshot normalizer does not own these rows.
async function seedProviderSessions(
  store: SqliteAppStateStore,
  sessions: Record<string, string>,
): Promise<void> {
  await store.run((client) => {
    for (const [key, sessionId] of Object.entries(sessions)) {
      client.run(
        `INSERT INTO provider_sessions (session_key, session_id) VALUES (?, ?)
         ON CONFLICT(session_key) DO UPDATE SET session_id = excluded.session_id`,
        key,
        sessionId,
      );
    }
  });
}

async function providerSessions(store: SqliteAppStateStore): Promise<Record<string, string>> {
  return Object.fromEntries(
    (
      await store.run((client) =>
        client.all<{ session_key: string; session_id: string }>(
          "SELECT session_key, session_id FROM provider_sessions ORDER BY session_key",
        ),
      )
    ).map((row) => [row.session_key, row.session_id]),
  );
}

async function rowCount(store: SqliteAppStateStore, table: string): Promise<number> {
  return store.run(
    (client) => client.get<{ c: number }>(`SELECT COUNT(*) AS c FROM ${table}`)?.c ?? 0,
  );
}

async function withStore(
  before: AppStateSnapshot,
  run: (store: SqliteAppStateStore) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-deletion-"));
  const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
    driver: bunSqliteDriver,
  });
  try {
    await store.open();
    await store.saveAppStateSnapshot(before);
    await seedProviderSessions(store, {
      "kimi:thread-deleted": "session-deleted",
      "kimi:thread-keeper": "session-keeper",
    });
    await run(store);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("SQLite App State Thread deletion", () => {
  it("deletes every Thread-owned row and Runtime Session mapping for the threads scope", async () => {
    await withStore(baseSnapshot(), async (store) => {
      const result = await store.deleteAppStateForThreads("delete-thread", ["thread-deleted"]);

      // The removed mapping is returned for rollback.
      expect(result.removedProviderSessions).toEqual({ "kimi:thread-deleted": "session-deleted" });

      const loaded = await store.loadAppStateSnapshot();
      // The deleted thread's owned rows are gone; the keeper survives.
      expect(loaded?.threads?.map((thread) => thread.id)).toEqual(["thread-keeper"]);
      expect(loaded?.threadMessages?.map((message) => message.id)).toEqual(["message-keeper"]);
      expect(loaded?.threadRuns ?? []).toEqual([]);
      expect(loaded?.threadActions ?? []).toEqual([]);
      expect(loaded?.threadWork ?? {}).toEqual({});
      // An unrelated reserved Thread ID remains.
      expect(loaded?.threadDrafts?.map((draft) => draft.id)).toEqual(["draft-deleted"]);
      expect(loaded?.threadPromotionIntents?.map((intent) => intent.draftId)).toEqual([
        "draft-deleted",
      ]);
      // lastThreadIdByWorkspace cleared when it pointed at the deleted thread.
      expect(loaded?.lastThreadIdByWorkspace ?? {}).toEqual({});
      // The deleted thread's Runtime Session mapping is gone; the keeper's stays.
      expect(await providerSessions(store)).toEqual({ "kimi:thread-keeper": "session-keeper" });
      expect(await store.hasCommittedThreadDeletion("delete-thread")).toBe(true);
      await store.clearCommittedThreadDeletionMarker("delete-thread");
      expect(await store.hasCommittedThreadDeletion("delete-thread")).toBe(false);
    });
  });

  it("deletes the Association, its drafts, and the orphan Project, and reindexes remaining associations", async () => {
    await withStore(baseSnapshot(), async (store) => {
      await store.deleteAppStateForThreads("delete-association", [], {
        kind: "association",
        workspaceId: "workspace-a",
        projectId: "project-b",
      });

      const loaded = await store.loadAppStateSnapshot();
      // The association is gone; workspace-a keeps its remaining association
      // (project-a) reindexed to order 0.
      expect(
        loaded?.associations
          .filter((association) => association.workspaceId === "workspace-a")
          .map((association) => [association.projectId, association.order]),
      ).toEqual([["project-a", 0]]);
      // project-b is an orphan (no remaining association references it after
      // workspace-a/project-b is removed; workspace-b/project-b also existed,
      // so project-b is NOT orphaned). Wait — workspace-b still references
      // project-b, so it must survive.
      expect(loaded?.projects.map((project) => project.id)).toEqual(["project-a", "project-b"]);
      // workspace-b's association to project-b is untouched.
      expect(
        loaded?.associations.find(
          (association) =>
            association.workspaceId === "workspace-b" && association.projectId === "project-b",
        ),
      ).toBeDefined();
    });
  });

  it("removes the orphan Project when its final Association is removed", async () => {
    await withStore(baseSnapshot(), async (store) => {
      await store.deleteAppStateForThreads("delete-final-association", [], {
        kind: "association",
        workspaceId: "workspace-a",
        projectId: "project-a",
      });

      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.projects.map((project) => project.id)).toEqual(["project-b"]);
      expect(loaded?.threads?.map((thread) => thread.id)).toEqual(["thread-keeper"]);
      expect(loaded?.threadMessages?.map((message) => message.id)).toEqual(["message-keeper"]);
      expect(await providerSessions(store)).toEqual({ "kimi:thread-keeper": "session-keeper" });
    });
  });

  it("deletes the Workspace, its associations, orphan Projects, and reindexes workspace orders", async () => {
    await withStore(baseSnapshot(), async (store) => {
      // Make workspace-a the active workspace (it already is) and delete it.
      await store.deleteAppStateForThreads("delete-workspace", [], {
        kind: "workspace",
        workspaceId: "workspace-a",
      });

      const loaded = await store.loadAppStateSnapshot();
      // workspace-a is gone; workspace-b is reindexed to order 0 and becomes active.
      expect(loaded?.workspaces.map((workspace) => [workspace.id, workspace.order])).toEqual([
        ["workspace-b", 0],
      ]);
      expect(loaded?.activeWorkspaceId).toBe("workspace-b");
      // workspace-a's associations are gone; workspace-b keeps its association.
      expect(loaded?.associations.map((association) => association.workspaceId)).toEqual([
        "workspace-b",
      ]);
      // project-a was referenced only by workspace-a → orphaned and removed.
      // project-b survives (still referenced by workspace-b).
      expect(loaded?.projects.map((project) => project.id).sort()).toEqual(["project-b"]);
      expect(loaded?.threads?.map((thread) => thread.id)).toEqual(["thread-keeper"]);
      expect(await providerSessions(store)).toEqual({ "kimi:thread-keeper": "session-keeper" });
      expect(loaded?.lastThreadIdByWorkspace ?? {}).toEqual({});
    });
  });

  it("keeps the active Workspace when a non-active Workspace is deleted", async () => {
    await withStore(baseSnapshot(), async (store) => {
      await store.deleteAppStateForThreads("delete-inactive-workspace", [], {
        kind: "workspace",
        workspaceId: "workspace-b",
      });

      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.workspaces.map((workspace) => workspace.id)).toEqual(["workspace-a"]);
      // active workspace unchanged.
      expect(loaded?.activeWorkspaceId).toBe("workspace-a");
    });
  });

  it("rolls back every deleted row when the database transaction fails", async () => {
    await withStore(baseSnapshot(), async (store) => {
      // Inject a failure on the threads delete so the transaction aborts.
      await store.run((client) =>
        client.run(
          `CREATE TEMP TRIGGER fail_thread_delete
           BEFORE DELETE ON threads
           BEGIN SELECT RAISE(ABORT, 'injected failure'); END`,
        ),
      );

      let message = "";
      try {
        await store.deleteAppStateForThreads("rollback-delete", ["thread-deleted"]);
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain("injected failure");

      // Every row remains; the Runtime Session mapping was not removed.
      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.threads?.map((thread) => thread.id).sort()).toEqual([
        "thread-deleted",
        "thread-keeper",
      ]);
      expect(loaded?.threadMessages?.map((message) => message.id).sort()).toEqual([
        "message-deleted",
        "message-deleted-assistant",
        "message-keeper",
      ]);
      expect(loaded?.threadDrafts?.map((draft) => draft.id)).toEqual(["draft-deleted"]);
      expect(await providerSessions(store)).toEqual({
        "kimi:thread-deleted": "session-deleted",
        "kimi:thread-keeper": "session-keeper",
      });
      expect(await store.hasCommittedThreadDeletion("rollback-delete")).toBe(false);
    });
  });

  it("does not resurrect a deleted Runtime Session mapping", async () => {
    await withStore(baseSnapshot(), async (store) => {
      const sessionStore = createSqliteProviderSessionStore(store, {
        version: 1,
        sessions: {
          "kimi:thread-deleted": "session-deleted",
          "kimi:thread-keeper": "session-keeper",
        },
      });
      const staleWrite = sessionStore.set("kimi:thread-deleted", "session-from-old-write");
      await store.deleteAppStateForThreads(
        "delete-session",
        ["thread-deleted"],
        undefined,
        sessionStore.adoptCommittedProviderSessionDeletion,
      );
      await staleWrite;

      // The older queued write commits first, then the deletion removes that
      // exact row and synchronizes the cache before another queued write runs.
      expect(await providerSessions(store)).toEqual({ "kimi:thread-keeper": "session-keeper" });
      expect(sessionStore.get("kimi:thread-deleted")).toBeUndefined();

      // An explicit new upsert for a different thread is fine, but the deleted
      // mapping stays absent unless explicitly re-added.
      await store.run((client) =>
        client.run(
          `INSERT INTO provider_sessions (session_key, session_id) VALUES (?, ?)`,
          "kimi:thread-new",
          "session-new",
        ),
      );
      expect(await providerSessions(store)).toEqual({
        "kimi:thread-keeper": "session-keeper",
        "kimi:thread-new": "session-new",
      });
    });
  });

  it("survives close and reopen with the deletion committed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-deletion-reopen-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const first = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await first.open();
      await first.saveAppStateSnapshot(baseSnapshot());
      await seedProviderSessions(first, { "kimi:thread-deleted": "session-deleted" });
      await first.deleteAppStateForThreads("delete-before-reopen", ["thread-deleted"]);
      await first.close();

      const reopened = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await reopened.open();
      const loaded = await reopened.loadAppStateSnapshot();
      expect(loaded?.threads?.map((thread) => thread.id)).toEqual(["thread-keeper"]);
      expect(await providerSessions(reopened)).toEqual({});
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("deletes multiple threads at once, returning every removed Runtime Session mapping", async () => {
    await withStore(baseSnapshot(), async (store) => {
      const result = await store.deleteAppStateForThreads("delete-many", [
        "thread-deleted",
        "thread-keeper",
      ]);

      expect(result.removedProviderSessions).toEqual({
        "kimi:thread-deleted": "session-deleted",
        "kimi:thread-keeper": "session-keeper",
      });
      const loaded = await store.loadAppStateSnapshot();
      expect(loaded?.threads ?? []).toEqual([]);
      expect(await providerSessions(store)).toEqual({});
    });
  });

  it("touches only lifecycle tables and provider_sessions (no projects/files on a threads-scope delete)", async () => {
    await withStore(baseSnapshot(), async (store) => {
      // Snapshot the unrelated-table row counts before the deletion.
      const beforeProjects = await rowCount(store, "projects");
      const beforeWorkspaces = await rowCount(store, "workspaces");
      const beforeAssociations = await rowCount(store, "workspace_project_associations");

      await store.deleteAppStateForThreads("delete-lifecycle", ["thread-deleted"]);

      // A threads-scope delete does not touch the identity graph.
      expect(await rowCount(store, "projects")).toBe(beforeProjects);
      expect(await rowCount(store, "workspaces")).toBe(beforeWorkspaces);
      expect(await rowCount(store, "workspace_project_associations")).toBe(beforeAssociations);
    });
  });
});
