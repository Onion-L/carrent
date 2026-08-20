import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyAppStateSnapshot } from "../../src/shared/workspacePersistence";
import { bunSqliteDriver } from "./bunSqliteDriver";
import { createSqliteAppStateStore } from "./sqliteAppStateStore";

describe("SQLite App State Thread deletion", () => {
  it("deletes Thread-owned rows and records the commit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "carrent-deletion-"));
    const store = createSqliteAppStateStore(join(dir, "carrent.sqlite"), {
      driver: bunSqliteDriver,
    });
    try {
      await store.open();
      await store.saveAppStateSnapshot({
        ...createEmptyAppStateSnapshot(),
        workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
        projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
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
        threadMessages: [
          {
            id: "message-1",
            threadId: "thread-1",
            role: "user",
            content: "Hello",
            createdAt: "2026-08-09T08:00:00.000Z",
            attachments: [],
          },
        ],
      });

      const result = await store.deleteAppStateForThreads("delete-1", ["thread-1"]);

      expect(result.appState.threads).toEqual([]);
      expect(result.appState.threadMessages).toEqual([]);
      expect(await store.hasCommittedThreadDeletion("delete-1")).toBe(true);
    } finally {
      await store.close();
      await rm(dir, { recursive: true, force: true });
    }
  });
});
