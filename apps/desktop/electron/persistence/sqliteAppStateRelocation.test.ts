import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyAppStateSnapshot } from "../../src/shared/workspacePersistence";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";

describe("SqliteAppStateStore.relocateProject", () => {
  it("updates the Project path atomically", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-relocation-"));
    const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await store.open();
      await store.saveAppStateSnapshot({
        ...createEmptyAppStateSnapshot(),
        workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
        projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/old/carrent" }],
        associations: [
          {
            workspaceId: "workspace-1",
            projectId: "project-1",
            order: 0,
            defaultProviderProfileId: "default",
            defaultAgentMode: "ask",
          },
        ],
        threads: [
          {
            id: "thread-1",
            workspaceId: "workspace-1",
            projectId: "project-1",
            title: "Thread",
            createdAt: "2026-08-09T08:00:00.000Z",
            lastActivityAt: "2026-08-09T08:00:00.000Z",
            providerProfileId: "default",
            agentMode: "ask",
          },
        ],
      });

      const result = await store.relocateProject({
        projectId: "project-1",
        beforeWorkingDirectory: "/old/carrent",
        targetDirectory: "/new/carrent",
        threadIds: ["thread-1"],
      });

      expect(result.appState.projects[0].workingDirectory).toBe("/new/carrent");
      expect((await store.loadAppStateSnapshot())?.projects[0].workingDirectory).toBe(
        "/new/carrent",
      );
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
