import { describe, expect, it } from "bun:test";

import { registerProjectDirectoryIpc } from "./projectDirectory";
import { createProjectRelocationManager } from "./projectDirectory";
import type { AppStateSnapshot, WorkspaceSnapshot } from "../../src/shared/workspacePersistence";

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
  const workspace: WorkspaceSnapshot = {
    version: 1,
    projects: [
      { id: "project-1", name: "Carrent", path: "/old/carrent", threads: [] },
      { id: "project-2", name: "Other", path: "/code/other", threads: [] },
    ],
    chats: [],
    messages: [],
    activeThreadId: null,
  };
  return { appState, workspace };
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
    let workspace = structuredClone(before.workspace);
    const detached: string[][] = [];
    const manager = createProjectRelocationManager({
      workspaceStore: {
        waitForWrites: async () => {},
        loadAppStateSnapshot: async () => appState,
        saveAppStateSnapshot: async (next) => {
          appState = structuredClone(next);
        },
        loadWorkspaceSnapshot: async () => workspace,
        saveWorkspaceSnapshot: async (next) => {
          workspace = structuredClone(next);
        },
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        detachRuntimeSessions: async (threadIds) => {
          detached.push(threadIds);
          return { threadIds, providerSessions: {}, runtimeSessions: {} };
        },
        restoreRuntimeSessions: async () => {},
        completeRuntimeSessionDetachment: () => {},
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
    expect(result.workspace.projects.find((project) => project.id === "project-1")?.path).toBe(
      "/new/carrent",
    );
    expect(detached).toEqual([["thread-1", "thread-2"]]);
    expect(appState.projects.find((project) => project.id === "project-2")?.workingDirectory).toBe(
      "/code/other",
    );
  });

  it("rejects relocation while the Project has a live Run", async () => {
    const before = relocationSnapshots();
    let detached = false;
    const manager = createProjectRelocationManager({
      workspaceStore: {
        waitForWrites: async () => {},
        loadAppStateSnapshot: async () => before.appState,
        saveAppStateSnapshot: async () => {
          throw new Error("must not save");
        },
        loadWorkspaceSnapshot: async () => before.workspace,
        saveWorkspaceSnapshot: async () => {
          throw new Error("must not save");
        },
      },
      sessionManager: {
        hasLiveRunForThreads: () => true,
        detachRuntimeSessions: async () => {
          detached = true;
          return { threadIds: [], providerSessions: {}, runtimeSessions: {} };
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
      workspaceStore: {
        waitForWrites: async () => {},
        loadAppStateSnapshot: async () => before.appState,
        saveAppStateSnapshot: async () => {},
        loadWorkspaceSnapshot: async () => before.workspace,
        saveWorkspaceSnapshot: async () => {},
      },
      sessionManager: {
        hasLiveRunForThreads: () => false,
        detachRuntimeSessions: async () => {
          detached = true;
          return { threadIds: [], providerSessions: {}, runtimeSessions: {} };
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
      workspaceStore: {
        waitForWrites: async () => {},
        loadAppStateSnapshot: async () => before.appState,
        saveAppStateSnapshot: async (snapshot) => {
          savedAppStates.push(snapshot);
        },
        loadWorkspaceSnapshot: async () => before.workspace,
        saveWorkspaceSnapshot: async () => {},
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

  it("rolls back paths and Runtime Sessions when a path write fails", async () => {
    const before = relocationSnapshots();
    let appState = structuredClone(before.appState);
    let workspace = structuredClone(before.workspace);
    let restored = false;
    let completed = false;
    const receipt = {
      threadIds: ["thread-1", "thread-2"],
      providerSessions: { "kimi:thread-1": "session-1" },
      runtimeSessions: {},
    };
    const manager = createProjectRelocationManager({
      workspaceStore: {
        waitForWrites: async () => {},
        loadAppStateSnapshot: async () => appState,
        saveAppStateSnapshot: async (next) => {
          appState = structuredClone(next);
        },
        loadWorkspaceSnapshot: async () => workspace,
        saveWorkspaceSnapshot: async (next) => {
          if (next.projects[0]?.path === "/new/carrent") throw new Error("disk full");
          workspace = structuredClone(next);
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
    expect(workspace).toEqual(before.workspace);
    expect(restored).toBe(true);
    expect(completed).toBe(false);
  });
});
