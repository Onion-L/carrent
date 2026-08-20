import { describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppStateAuthority } from "../workspace/appStateAuthority";
import { appStateCommandReducers } from "../workspace/appStateCommands";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateLifecycle } from "./sqliteAppStateLifecycle";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";
import { createSqliteProductionAppStateStore } from "./sqliteProductionAppStateStore";

function createWorkspaceCommand(commandId: string, baseRevision?: number) {
  return {
    commandId,
    type: "workspace:create",
    ...(baseRevision === undefined ? {} : { baseRevision }),
    payload: {
      workspace: { id: "workspace-1", name: "Carrent", order: 0 },
      projects: [
        {
          id: "project-1",
          name: "Carrent",
          workingDirectory: "/work/carrent",
        },
      ],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultProviderProfileId: "default",
          defaultAgentMode: "ask",
        },
      ],
    },
  };
}

describe("SQLite production App State authority", () => {
  it("commits before publishing, converges windows, rejects stale commands, and recovers after restart", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-production-"));
    const path = join(dir, "carrent.sqlite");
    try {
      const sqlite = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      const lifecycle = createSqliteAppStateLifecycle(sqlite, dir);
      const store = createSqliteProductionAppStateStore(sqlite, lifecycle);
      const initialResult = await store.initializeAppState();
      expect(initialResult.status).toBe("ready");

      let committed = false;
      const published: Array<{ subscriberId: number; revision: number }> = [];
      const authority = createAppStateAuthority({
        store: {
          ...store,
          persistAppStateCommand: async (command, before, after) => {
            await store.persistAppStateCommand(command, before, after);
            committed = true;
          },
        },
        initialResult,
        reducers: appStateCommandReducers,
        publish: (subscriberId, state) => {
          expect(committed).toBe(true);
          published.push({ subscriberId, revision: state.revision });
        },
      });
      authority.subscribe(11);
      authority.subscribe(22);

      expect(await authority.submit(11, createWorkspaceCommand("command-1"))).toEqual({
        status: "accepted",
        revision: 1,
      });
      expect(published).toEqual([
        { subscriberId: 11, revision: 1 },
        { subscriberId: 22, revision: 1 },
      ]);
      const concurrent = await Promise.all([
        authority.submit(11, {
          commandId: "command-rename",
          type: "workspace:rename",
          payload: { workspaceId: "workspace-1", name: "Carrent Renamed" },
        }),
        authority.submit(22, {
          commandId: "command-settings",
          type: "settings:update",
          payload: { settings: { enhancedCompletion: false } },
        }),
      ]);
      expect(concurrent).toEqual([
        { status: "accepted", revision: 2 },
        { status: "accepted", revision: 3 },
      ]);
      expect(
        await authority.submit(22, {
          ...createWorkspaceCommand("command-stale", 2),
          payload: {
            ...createWorkspaceCommand("ignored").payload,
            workspace: { id: "workspace-2", name: "Stale", order: 1 },
          },
        }),
      ).toEqual({ status: "rejected", reason: "stale", revision: 3 });

      await store.close();
      const reopenedSqlite = createSqliteAppStateStore(path, { driver: bunSqliteDriver });
      const reopenedLifecycle = createSqliteAppStateLifecycle(reopenedSqlite, dir);
      const reopenedStore = createSqliteProductionAppStateStore(reopenedSqlite, reopenedLifecycle);
      const reopened = await reopenedStore.initializeAppState();
      expect(reopened.status).toBe("ready");
      if (reopened.status === "ready") {
        expect(reopened.snapshot.workspaces.map((workspace) => workspace.name)).toEqual([
          "Carrent Renamed",
        ]);
      }
      expect(await readdir(dir)).not.toContain("app-state.json");
      expect(await readdir(dir)).not.toContain("provider-sessions.json");
      await reopenedStore.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps revision, snapshot, and subscribers unchanged when SQLite persistence fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-sqlite-production-failure-"));
    try {
      const sqlite = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
        driver: bunSqliteDriver,
      });
      const lifecycle = createSqliteAppStateLifecycle(sqlite, dir);
      const store = createSqliteProductionAppStateStore(sqlite, lifecycle);
      const initialResult = await store.initializeAppState();
      const published: unknown[] = [];
      const authority = createAppStateAuthority({
        store,
        initialResult,
        reducers: appStateCommandReducers,
        publish: (_subscriberId, state) => published.push(state),
      });
      authority.subscribe(11);
      await store.close();

      expect(await authority.submit(11, createWorkspaceCommand("command-1"))).toMatchObject({
        status: "rejected",
        reason: "persistence-failed",
        revision: 0,
      });
      expect(authority.getState().revision).toBe(0);
      expect(authority.getState().snapshot.workspaces).toEqual([]);
      expect(published).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
