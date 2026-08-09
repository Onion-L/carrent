import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AppStateSnapshot } from "../../src/shared/workspacePersistence";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { readProviderSessions, replaceProviderSessions } from "./providerSessionRepository";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";
import { createSqliteProviderSessionStore } from "./sqliteProviderSessionStore";

function snapshot(): AppStateSnapshot {
  return {
    version: 1,
    workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
    projects: [
      { id: "project-1", name: "Carrent", workingDirectory: "/old/carrent" },
      { id: "project-2", name: "Other", workingDirectory: "/code/other" },
    ],
    associations: [
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
      {
        workspaceId: "workspace-1",
        projectId: "project-2",
        order: 1,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
    ],
    threads: [
      {
        id: "thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        title: "One",
        createdAt: "2026-08-09T00:00:00.000Z",
        lastActivityAt: "2026-08-09T00:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
      {
        id: "thread-2",
        workspaceId: "workspace-1",
        projectId: "project-2",
        title: "Other",
        createdAt: "2026-08-09T00:00:00.000Z",
        lastActivityAt: "2026-08-09T00:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadDrafts: [
      {
        id: "draft-1",
        threadId: "reserved-thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        content: "keep me",
        attachedSkillNames: [],
        attachments: [],
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadMessages: [],
    threadRuns: [],
    threadActions: [],
    threadPromotionIntents: [],
    threadWork: {},
    lastThreadIdByWorkspace: {},
    activeWorkspaceId: "workspace-1",
  };
}

describe("SqliteAppStateStore.relocateProject", () => {
  it("commits the Project path and affected Runtime Session mappings together", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-relocation-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const store = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await store.open();
      await store.saveAppStateSnapshot(snapshot());
      const providerStore = createSqliteProviderSessionStore(store, {
        version: 1,
        sessions: {},
      });
      await providerStore.reinitialize({
        version: 1,
        sessions: {
          "kimi:thread-1": "session-1",
          "claude-code:thread-1": "session-2",
          "kimi:thread-2": "session-other",
        },
      });

      const detachedProviderSessions = providerStore.detachThreadsFromCache(["thread-1"]);
      const result = await store.relocateProject({
        projectId: "project-1",
        beforeWorkingDirectory: "/old/carrent",
        targetDirectory: "/new/carrent",
        threadIds: ["thread-1"],
        providerSessions: detachedProviderSessions,
      });
      expect(result.removedProviderSessions).toEqual({
        "kimi:thread-1": "session-1",
        "claude-code:thread-1": "session-2",
      });
      expect(providerStore.get("kimi:thread-1")).toBeUndefined();
      expect(providerStore.get("claude-code:thread-1")).toBeUndefined();
      expect(providerStore.get("kimi:thread-2")).toBe("session-other");
      await store.close();

      const reopened = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      await reopened.open();
      const loaded = await reopened.loadAppStateSnapshot();
      expect(loaded?.projects).toEqual([
        { id: "project-1", name: "Carrent", workingDirectory: "/new/carrent" },
        { id: "project-2", name: "Other", workingDirectory: "/code/other" },
      ]);
      expect(loaded?.associations).toEqual(snapshot().associations);
      expect(loaded?.threads).toEqual(snapshot().threads);
      expect(loaded?.threadDrafts).toEqual(snapshot().threadDrafts);
      expect(await reopened.run((client) => readProviderSessions(client))).toEqual({
        "kimi:thread-2": "session-other",
      });
      await reopened.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rolls back the Project path when a Runtime Session mapping delete fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-relocation-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      await store.saveAppStateSnapshot(snapshot());
      await store.run((client) => {
        replaceProviderSessions(client, { "kimi:thread-1": "session-1" });
        client.run(
          `CREATE TEMP TRIGGER fail_provider_session_delete
           BEFORE DELETE ON provider_sessions
           BEGIN SELECT RAISE(ABORT, 'injected relocation failure'); END`,
        );
      });

      let message = "";
      try {
        await store.relocateProject({
          projectId: "project-1",
          beforeWorkingDirectory: "/old/carrent",
          targetDirectory: "/new/carrent",
          threadIds: ["thread-1"],
          providerSessions: { "kimi:thread-1": "session-1" },
        });
      } catch (error) {
        message = String(error);
      }
      expect(message).toContain("injected relocation failure");
      expect(await store.loadAppStateSnapshot()).toEqual(snapshot());
      expect(await store.run((client) => readProviderSessions(client))).toEqual({
        "kimi:thread-1": "session-1",
      });
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects a stale validated before state without changing the path or mappings", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-relocation-"));
    try {
      const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      await store.open();
      await store.saveAppStateSnapshot(snapshot());
      await store.run((client) => {
        replaceProviderSessions(client, { "kimi:thread-1": "session-1" });
        client.run("UPDATE threads SET project_id = ? WHERE id = ?", "project-2", "thread-1");
      });

      let message = "";
      try {
        await store.relocateProject({
          projectId: "project-1",
          beforeWorkingDirectory: "/old/carrent",
          targetDirectory: "/new/carrent",
          threadIds: ["thread-1"],
          providerSessions: { "kimi:thread-1": "session-1" },
        });
      } catch (error) {
        message = String(error);
      }

      expect(message).toContain("App State changed during Project relocation");
      expect(
        (await store.loadAppStateSnapshot())?.projects.find((project) => project.id === "project-1")
          ?.workingDirectory,
      ).toBe("/old/carrent");
      expect(await store.run((client) => readProviderSessions(client))).toEqual({
        "kimi:thread-1": "session-1",
      });
      await store.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
