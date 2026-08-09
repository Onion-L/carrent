import { describe, expect, it } from "bun:test";

import { registerProjectDirectoryIpc } from "./projectDirectory";
import { createProjectRelocationManager } from "./projectDirectory";
import type { AppStateSnapshot } from "../../src/shared/workspacePersistence";

function relocationSnapshots() {
  const appState: AppStateSnapshot = {
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
        createdAt: "2026-07-27T00:00:00.000Z",
        lastActivityAt: "2026-07-27T00:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
      {
        id: "thread-2",
        workspaceId: "workspace-1",
        projectId: "project-1",
        title: "Two",
        createdAt: "2026-07-27T00:00:00.000Z",
        lastActivityAt: "2026-07-27T00:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
      {
        id: "thread-other",
        workspaceId: "workspace-1",
        projectId: "project-2",
        title: "Other",
        createdAt: "2026-07-27T00:00:00.000Z",
        lastActivityAt: "2026-07-27T00:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    activeWorkspaceId: "workspace-1",
  };
  return { appState };
}

describe("registerProjectDirectoryIpc", () => {
  it("reports only whether the recorded Project Working Directory is available", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const checked: string[] = [];
    registerProjectDirectoryIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        checkDirectory: async (workingDirectory) => {
          checked.push(workingDirectory);
          return workingDirectory === "/code/carrent";
        },
      },
    );

    expect(await handlers.get("project-directory:check")?.({}, "/code/carrent")).toEqual({
      available: true,
    });
    expect(await handlers.get("project-directory:check")?.({}, "/moved/carrent")).toEqual({
      available: false,
    });
    expect(checked).toEqual(["/code/carrent", "/moved/carrent"]);
  });

  it("validates and forwards an explicit Project relocation", async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const requests: unknown[] = [];
    registerProjectDirectoryIpc(
      { handle: (channel, listener) => handlers.set(channel, listener) },
      {
        relocationManager: {
          relocate: async (request) => {
            requests.push(request);
            return relocationSnapshots();
          },
        },
      },
    );

    await handlers.get("project-directory:relocate")?.(
      {},
      { projectId: "project-1", targetDirectory: "/new/carrent" },
    );

    expect(requests).toEqual([{ projectId: "project-1", targetDirectory: "/new/carrent" }]);
  });
});

describe("createProjectRelocationManager", () => {
  it("updates the shared Project path and detaches all of its Runtime Sessions", async () => {
    const before = relocationSnapshots();
    let appState = structuredClone(before.appState);
    const detached: string[][] = [];
    const completedReceipts: unknown[] = [];
    const manager = createProjectRelocationManager({
      appStateStore: {
        loadAppStateSnapshot: async () => appState,
        relocateProject: async (request) => {
          const next = structuredClone(appState);
          next.projects = next.projects.map((project) =>
            project.id === "project-1" ? { ...project, workingDirectory: "/new/carrent" } : project,
          );
          appState = structuredClone(next);
          const result = {
            appState: next,
            removedProviderSessions: request.providerSessions,
          };
          return result;
        },
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        detachRuntimeSessions: async (threadIds) => {
          detached.push(threadIds);
          return {
            threadIds,
            providerSessions: { "kimi:thread-1": "session-1" },
            providerSessionsDetachedFromCache: true,
            runtimeSessions: {},
          };
        },
        restoreRuntimeSessions: async () => {},
        completeRuntimeSessionDetachment: (receipt) => {
          completedReceipts.push(receipt);
        },
      },
      checkDirectory: async () => true,
    });

    const result = await manager.relocate({
      projectId: "project-1",
      targetDirectory: "/new/carrent",
    });

    expect(result.appState.projects.find((project) => project.id === "project-1")).toEqual({
      id: "project-1",
      name: "Carrent",
      workingDirectory: "/new/carrent",
    });
    expect(detached).toEqual([["thread-1", "thread-2"]]);
    expect(completedReceipts).toEqual([
      {
        threadIds: ["thread-1", "thread-2"],
        providerSessions: { "kimi:thread-1": "session-1" },
        providerSessionsDetachedFromCache: true,
        runtimeSessions: {},
      },
    ]);
    expect(appState.projects.find((project) => project.id === "project-2")?.workingDirectory).toBe(
      "/code/other",
    );
  });

  it("rejects relocation while the Project has a live Run", async () => {
    const before = relocationSnapshots();
    let detached = false;
    const manager = createProjectRelocationManager({
      appStateStore: {
        loadAppStateSnapshot: async () => before.appState,
        relocateProject: async () => {
          throw new Error("must not save");
        },
      },
      sessionManager: {
        hasLiveRunForThreads: () => true,
        detachRuntimeSessions: async () => {
          detached = true;
          return {
            threadIds: [],
            providerSessions: {},
            providerSessionsDetachedFromCache: false,
            runtimeSessions: {},
          };
        },
        restoreRuntimeSessions: async () => {},
        completeRuntimeSessionDetachment: () => {},
      },
      checkDirectory: async () => true,
    });

    let error: unknown;
    try {
      await manager.relocate({ projectId: "project-1", targetDirectory: "/new/carrent" });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof Error ? error.message : String(error)).toContain("live Run");
    expect(detached).toBe(false);
  });

  it("rejects a directory already bound to another Project", async () => {
    const before = relocationSnapshots();
    let detached = false;
    const manager = createProjectRelocationManager({
      appStateStore: {
        loadAppStateSnapshot: async () => before.appState,
        relocateProject: async () => ({
          appState: before.appState,
          removedProviderSessions: {},
        }),
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        detachRuntimeSessions: async () => {
          detached = true;
          return {
            threadIds: [],
            providerSessions: {},
            providerSessionsDetachedFromCache: false,
            runtimeSessions: {},
          };
        },
        restoreRuntimeSessions: async () => {},
        completeRuntimeSessionDetachment: () => {},
      },
      checkDirectory: async () => true,
    });

    let error: unknown;
    try {
      await manager.relocate({ projectId: "project-1", targetDirectory: "/code/other" });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof Error ? error.message : String(error)).toContain("another Project");
    expect(detached).toBe(false);
  });

  it("keeps the old path when Runtime Session cleanup fails", async () => {
    const before = relocationSnapshots();
    const savedAppStates: AppStateSnapshot[] = [];
    const manager = createProjectRelocationManager({
      appStateStore: {
        loadAppStateSnapshot: async () => before.appState,
        relocateProject: async () => {
          const snapshot = structuredClone(before.appState);
          savedAppStates.push(snapshot);
          return { appState: snapshot, removedProviderSessions: {} };
        },
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        detachRuntimeSessions: async () => {
          throw new Error("session cleanup failed");
        },
        restoreRuntimeSessions: async () => {},
        completeRuntimeSessionDetachment: () => {},
      },
      checkDirectory: async () => true,
    });

    await manager
      .relocate({ projectId: "project-1", targetDirectory: "/new/carrent" })
      .catch(() => {});

    expect(savedAppStates).toHaveLength(0);
    expect(before.appState.projects[0]?.workingDirectory).toBe("/old/carrent");
  });

  it("rolls back App State and Runtime Sessions when a path write fails", async () => {
    const before = relocationSnapshots();
    let appState = structuredClone(before.appState);
    let restored = false;
    let completed = false;
    const receipt = {
      threadIds: ["thread-1", "thread-2"],
      providerSessions: { "kimi:thread-1": "session-1" },
      providerSessionsDetachedFromCache: true,
      runtimeSessions: {},
    };
    const manager = createProjectRelocationManager({
      appStateStore: {
        loadAppStateSnapshot: async () => appState,
        relocateProject: async () => {
          throw new Error("disk full");
        },
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        detachRuntimeSessions: async () => receipt,
        restoreRuntimeSessions: async (restoredReceipt) => {
          expect(restoredReceipt).toEqual(receipt);
          restored = true;
        },
        completeRuntimeSessionDetachment: () => {
          completed = true;
        },
      },
      checkDirectory: async () => true,
    });

    await manager
      .relocate({ projectId: "project-1", targetDirectory: "/new/carrent" })
      .catch(() => {});

    expect(appState).toEqual(before.appState);
    expect(restored).toBe(true);
    expect(completed).toBe(false);
  });

  it("returns an explicit rollback failure and does not publish an uncommitted Snapshot", async () => {
    const before = relocationSnapshots();
    let restoreAttempts = 0;
    const published: AppStateSnapshot[] = [];
    const manager = createProjectRelocationManager({
      appStateStore: {
        loadAppStateSnapshot: async () => before.appState,
        relocateProject: async () => {
          throw new Error("database failed");
        },
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        detachRuntimeSessions: async (threadIds) => ({
          threadIds,
          providerSessions: {},
          providerSessionsDetachedFromCache: true,
          runtimeSessions: { "kimi:thread-1": "session-1" },
        }),
        restoreRuntimeSessions: async () => {
          restoreAttempts += 1;
          throw new Error("runtime restore failed");
        },
        completeRuntimeSessionDetachment: () => {},
      },
      checkDirectory: async () => true,
      onSnapshotCommitted: (snapshot) => published.push(snapshot),
    });

    let error: unknown;
    try {
      await manager.relocate({ projectId: "project-1", targetDirectory: "/new/carrent" });
    } catch (caught) {
      error = caught;
    }

    expect(error instanceof AggregateError).toBe(true);
    expect(error instanceof Error ? error.message : String(error)).toContain(
      "could not be fully rolled back",
    );
    expect(restoreAttempts).toBe(2);
    expect(published).toEqual([]);
  });

  it("does not restore detached Runtime Sessions after the database commit succeeds", async () => {
    const before = relocationSnapshots();
    const committed = structuredClone(before.appState);
    committed.projects = committed.projects.map((project) =>
      project.id === "project-1" ? { ...project, workingDirectory: "/new/carrent" } : project,
    );
    let restored = false;
    let completed = false;
    const manager = createProjectRelocationManager({
      appStateStore: {
        loadAppStateSnapshot: async () => before.appState,
        relocateProject: async () => ({
          appState: committed,
          removedProviderSessions: { "kimi:thread-1": "session-1" },
        }),
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        detachRuntimeSessions: async (threadIds) => ({
          threadIds,
          providerSessions: { "kimi:thread-1": "session-1" },
          providerSessionsDetachedFromCache: true,
          runtimeSessions: { "kimi:thread-1": "session-1" },
        }),
        restoreRuntimeSessions: async () => {
          restored = true;
        },
        completeRuntimeSessionDetachment: () => {
          completed = true;
        },
      },
      checkDirectory: async () => true,
      onSnapshotCommitted: () => {
        throw new Error("subscriber failed");
      },
    });

    const result = await manager.relocate({
      projectId: "project-1",
      targetDirectory: "/new/carrent",
    });

    expect(result.appState).toEqual(committed);
    expect(completed).toBe(true);
    expect(restored).toBe(false);
  });

  it("serializes concurrent relocations and validates each against the latest committed state", async () => {
    const before = relocationSnapshots();
    let appState = structuredClone(before.appState);
    const transactionTargets: string[] = [];
    const manager = createProjectRelocationManager({
      appStateStore: {
        loadAppStateSnapshot: async () => structuredClone(appState),
        relocateProject: async (request) => {
          transactionTargets.push(request.targetDirectory);
          await Promise.resolve();
          appState = {
            ...appState,
            projects: appState.projects.map((project) =>
              project.id === request.projectId
                ? { ...project, workingDirectory: request.targetDirectory }
                : project,
            ),
          };
          return { appState: structuredClone(appState), removedProviderSessions: {} };
        },
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        detachRuntimeSessions: async (threadIds) => ({
          threadIds,
          providerSessions: {},
          providerSessionsDetachedFromCache: true,
          runtimeSessions: {},
        }),
        restoreRuntimeSessions: async () => {},
        completeRuntimeSessionDetachment: () => {},
      },
      checkDirectory: async () => true,
    });

    const first = manager.relocate({
      projectId: "project-1",
      targetDirectory: "/new/first",
    });
    const second = manager.relocate({
      projectId: "project-1",
      targetDirectory: "/new/second",
    });
    await Promise.all([first, second]);

    expect(transactionTargets).toEqual(["/new/first", "/new/second"]);
    expect(appState.projects.find((project) => project.id === "project-1")?.workingDirectory).toBe(
      "/new/second",
    );
  });
});
