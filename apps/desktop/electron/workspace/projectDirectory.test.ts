import { describe, expect, it } from "bun:test";

import {
  createEmptyAppStateSnapshot,
  type AppStateSnapshot,
} from "../../src/shared/workspacePersistence";
import { createProjectRelocationManager } from "./projectDirectory";

describe("createProjectRelocationManager", () => {
  it("blocks the Threads while persisting the new Project path", async () => {
    const before = {
      ...createEmptyAppStateSnapshot(),
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/old" }],
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Thread",
          createdAt: "2026-08-20T08:00:00.000Z",
          lastActivityAt: "2026-08-20T08:00:00.000Z",
          providerProfileId: "default",
          agentMode: "ask" as const,
        },
      ],
    };
    const relocating: boolean[] = [];
    let saved: AppStateSnapshot = before;
    const manager = createProjectRelocationManager({
      appStateStore: {
        loadAppStateSnapshot: async () => saved,
        saveAppStateSnapshot: async (snapshot) => {
          saved = snapshot;
        },
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        setThreadsRelocating: (_threadIds, active) => relocating.push(active),
      },
      checkDirectory: async () => true,
    });

    const result = await manager.relocate({ projectId: "project-1", targetDirectory: "/new" });

    expect(result.appState.projects[0].workingDirectory).toBe("/new");
    expect(relocating).toEqual([true, false]);
  });
});
