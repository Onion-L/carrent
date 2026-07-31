import { afterEach, describe, expect, it } from "bun:test";

import "../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { AppStateSnapshot } from "../../shared/workspacePersistence";
import { createFakeAppStateAuthority } from "../test/fakeAppStateAuthority";
import { AppStateProvider, useAppState } from "./AppStateContext";

const baseSnapshot: AppStateSnapshot = {
  version: 1,
  workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
  projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
  associations: [
    {
      workspaceId: "workspace-1",
      projectId: "project-1",
      order: 0,
      defaultRuntimeId: "kimi",
      defaultRuntimeMode: "approval-required",
    },
  ],
  threads: [
    {
      id: "thread-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      title: "First",
      createdAt: "2026-07-29T12:00:00.000Z",
      lastActivityAt: "2026-07-29T12:00:00.000Z",
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    },
  ],
  threadDrafts: [],
  threadMessages: [],
  threadRuns: [],
  threadPromotionIntents: [],
  threadWork: {},
  lastThreadIdByWorkspace: { "workspace-1": "thread-1" },
  activeWorkspaceId: "workspace-1",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let contextValue: ReturnType<typeof useAppState> | null = null;
let savedSnapshot: AppStateSnapshot | null = null;

function Probe() {
  contextValue = useAppState();
  return null;
}

async function renderProvider(snapshot: AppStateSnapshot) {
  savedSnapshot = null;
  contextValue = null;
  const authority = createFakeAppStateAuthority(snapshot, {
    onPersist: (next) => {
      savedSnapshot = next;
    },
  });
  window.carrent = {
    appState: {
      load: async () => ({ status: "ready", snapshot }),
      reread: async () => ({ status: "ready", snapshot }),
      stage: () => {},
      save: async (next: AppStateSnapshot) => {
        authority.adoptExternalSnapshot(next);
      },
      fullReset: async () => ({ status: "ready", snapshot }),
      subscribe: authority.subscribe,
      unsubscribe: authority.unsubscribe,
      command: authority.command,
      onChanged: authority.onChanged,
    },
    projectDirectories: { check: async () => ({ available: true }) },
    terminal: { closeProject: async () => {} },
  } as unknown as Window["carrent"];

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <AppStateProvider>
        <Probe />
      </AppStateProvider>,
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  root = null;
  container = null;
  contextValue = null;
  savedSnapshot = null;
  localStorage.clear();
});

describe("recordThreadRun", () => {
  it("persists the original user message createdAt so it cannot sort after the assistant placeholder", async () => {
    await renderProvider(baseSnapshot);

    let recorded = false;
    await act(async () => {
      recorded = await contextValue!.recordThreadRun({
        threadId: "thread-1",
        runId: "run-1",
        messageId: "message-1",
        message: "hi",
        attachments: [],
        startedAt: "2026-07-29T12:31:39.718Z",
        messageCreatedAt: "2026-07-29T12:31:39.700Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      });
    });

    expect(recorded).toBe(true);
    expect(savedSnapshot?.threadMessages).toHaveLength(1);
    expect(savedSnapshot?.threadMessages?.[0]?.createdAt).toBe("2026-07-29T12:31:39.700Z");
    expect(savedSnapshot?.threadRuns?.[0]?.startedAt).toBe("2026-07-29T12:31:39.718Z");
  });

  it("falls back to startedAt when the optimistic message has no original createdAt", async () => {
    await renderProvider(baseSnapshot);

    let recorded = false;
    await act(async () => {
      recorded = await contextValue!.recordThreadRun({
        threadId: "thread-1",
        runId: "run-1",
        messageId: "message-1",
        message: "hi",
        attachments: [],
        startedAt: "2026-07-29T12:31:39.718Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      });
    });

    expect(recorded).toBe(true);
    expect(savedSnapshot?.threadMessages?.[0]?.createdAt).toBe("2026-07-29T12:31:39.718Z");
  });
});

describe("prepareThreadDraftPromotion", () => {
  it("persists the optimistic user message createdAt during promotion", async () => {
    await renderProvider({
      ...baseSnapshot,
      threads: [],
      threadDrafts: [
        {
          id: "draft-1",
          threadId: "thread-promoted",
          workspaceId: "workspace-1",
          projectId: "project-1",
          content: "first turn",
          attachedSkillNames: [],
          attachments: [],
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
    });

    await act(async () => {
      await contextValue!.prepareThreadDraftPromotion({
        draftId: "draft-1",
        runId: "run-1",
        messageId: "message-1",
        message: "first turn",
        attachments: [],
        startedAt: "2026-07-29T12:31:39.718Z",
        messageCreatedAt: "2026-07-29T12:31:39.700Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
        title: "First turn",
        draft: { content: "first turn", attachedSkillNames: [], attachments: [] },
      });
    });

    expect(savedSnapshot?.threadMessages?.[0]?.createdAt).toBe("2026-07-29T12:31:39.700Z");
    expect(savedSnapshot?.threadRuns?.[0]?.startedAt).toBe("2026-07-29T12:31:39.718Z");
  });
});

/* Two independent renderer clients (two mounted providers) sharing one fake
 * authority, mirroring two windows subscribed to the Main-process authority. */
describe("multi-window synchronization", () => {
  const multiSnapshot: AppStateSnapshot = {
    version: 1,
    workspaces: [
      { id: "workspace-1", name: "Personal", order: 0 },
      { id: "workspace-2", name: "Client", order: 1 },
    ],
    projects: [
      { id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" },
      { id: "project-2", name: "Shared", workingDirectory: "/code/shared" },
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
      {
        workspaceId: "workspace-2",
        projectId: "project-2",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
    ],
    threads: [
      {
        id: "sync-thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        title: "First",
        createdAt: "2026-07-29T12:00:00.000Z",
        lastActivityAt: "2026-07-29T12:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
      {
        id: "sync-thread-2",
        workspaceId: "workspace-1",
        projectId: "project-2",
        title: "Second",
        createdAt: "2026-07-29T12:00:00.000Z",
        lastActivityAt: "2026-07-29T12:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    threadPromotionIntents: [],
    threadWork: {},
    lastThreadIdByWorkspace: { "workspace-1": "sync-thread-1" },
    activeWorkspaceId: "workspace-1",
  };

  let containerB: HTMLDivElement | null = null;
  let rootB: Root | null = null;
  let contextB: ReturnType<typeof useAppState> | null = null;

  function ProbeB() {
    contextB = useAppState();
    return null;
  }

  async function renderClients() {
    await renderProvider(multiSnapshot);
    containerB = document.createElement("div");
    document.body.appendChild(containerB);
    rootB = createRoot(containerB);
    await act(async () => {
      rootB!.render(
        <AppStateProvider>
          <ProbeB />
        </AppStateProvider>,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  afterEach(async () => {
    if (rootB) {
      await act(async () => rootB!.unmount());
    }
    containerB?.remove();
    rootB = null;
    containerB = null;
    contextB = null;
  });

  const noopCleanup = async () => {};

  it("propagates workspace create, rename, and delete to the other client", async () => {
    await renderClients();

    let createdOk = false;
    await act(async () => {
      createdOk = (await contextValue!.createWorkspace("Research")).ok;
    });
    expect(createdOk).toBe(true);
    expect(contextB!.workspaces.map((workspace) => workspace.name)).toEqual([
      "Personal",
      "Client",
      "Research",
    ]);
    const createdId = contextB!.workspaces.at(-1)!.id;
    expect(contextB!.activeWorkspaceId).toBe(createdId);
    expect(contextValue!.activeWorkspaceId).toBe(createdId);

    await act(async () => {
      expect(await contextB!.renameWorkspace("workspace-1", "Home")).toMatchObject({ ok: true });
    });
    expect(contextValue!.workspaces.find((workspace) => workspace.id === "workspace-1")?.name).toBe(
      "Home",
    );

    await act(async () => {
      expect(await contextValue!.deleteWorkspace("workspace-2", noopCleanup)).toBe(true);
    });
    expect(contextB!.workspaces.map((workspace) => workspace.name)).toEqual(["Home", "Research"]);
    // project-2 survives: workspace-1 still references it.
    expect(contextB!.projects.map((project) => project.id)).toEqual(["project-1", "project-2"]);
    expect(contextB!.threads?.map((thread) => thread.id)).toEqual([
      "sync-thread-1",
      "sync-thread-2",
    ]);
  });

  it("propagates project add, rename, and alias to the other client", async () => {
    await renderClients();

    await act(async () => {
      const added = await contextValue!.addProject("workspace-1", "/code/new-lib");
      expect(added.ok).toBe(true);
    });
    const newProject = contextB!.projects.find((project) => project.name === "new-lib");
    expect(newProject).toBeDefined();
    expect(
      contextB!.associations.find(
        (item) => item.workspaceId === "workspace-1" && item.projectId === newProject!.id,
      ),
    ).toMatchObject({ workspaceId: "workspace-1", order: 2 });

    await act(async () => {
      expect(await contextB!.renameSharedProject("project-2", "Shared Renamed")).toBe(true);
    });
    expect(contextValue!.projects.find((project) => project.id === "project-2")?.name).toBe(
      "Shared Renamed",
    );

    await act(async () => {
      expect(await contextValue!.setProjectAlias("workspace-1", "project-2", "alias-x")).toBe(true);
    });
    expect(
      contextB!.associations.find(
        (item) => item.workspaceId === "workspace-1" && item.projectId === "project-2",
      )?.alias,
    ).toBe("alias-x");
  });

  it("propagates association removal with its cascade to the other client", async () => {
    await renderClients();

    await act(async () => {
      expect(await contextValue!.removeAssociation("workspace-1", "project-2", noopCleanup)).toBe(
        true,
      );
    });

    expect(contextB!.associations.map((item) => `${item.workspaceId}:${item.projectId}`)).toEqual([
      "workspace-1:project-1",
      "workspace-2:project-2",
    ]);
    // thread-2 belonged to the removed association; project-2 survives via workspace-2.
    expect(contextB!.threads.map((thread) => thread.id)).toEqual(["sync-thread-1"]);
    expect(contextB!.projects.map((project) => project.id)).toEqual(["project-1", "project-2"]);
    expect(contextValue!.threads.map((thread) => thread.id)).toEqual(["sync-thread-1"]);
    expect(contextB!.lastThreadIdByWorkspace).toEqual({ "workspace-1": "sync-thread-1" });
  });

  it("propagates thread archive, restore, and config updates to the other client", async () => {
    await renderClients();

    await act(async () => {
      expect(await contextValue!.archiveThread("sync-thread-1")).toBe(true);
    });
    expect(contextB!.threads.find((thread) => thread.id === "sync-thread-1")?.archived).toBe(true);
    expect(contextB!.lastThreadIdByWorkspace).toEqual({});

    await act(async () => {
      expect(await contextB!.restoreThread("sync-thread-1")).toBe(true);
    });
    expect(
      contextValue!.threads.find((thread) => thread.id === "sync-thread-1")?.archived,
    ).toBeUndefined();

    await act(async () => {
      expect(
        await contextValue!.updateThreadConfig("sync-thread-1", {
          runtimeId: "codex",
          planMode: true,
        }),
      ).toBe(true);
    });
    expect(contextB!.threads.find((thread) => thread.id === "sync-thread-1")).toMatchObject({
      runtimeId: "codex",
      planMode: true,
    });
  });

  it("converges selection state across clients", async () => {
    await renderClients();

    await act(async () => {
      expect(await contextValue!.selectWorkspace("workspace-2")).toBe(true);
    });
    expect(contextB!.activeWorkspaceId).toBe("workspace-2");
    expect(contextValue!.activeWorkspaceId).toBe("workspace-2");

    await act(async () => {
      expect(await contextB!.rememberThreadLocation("workspace-1", "sync-thread-1")).toBe(true);
    });
    expect(contextValue!.activeWorkspaceId).toBe("workspace-1");
    expect(contextB!.lastThreadIdByWorkspace).toEqual({ "workspace-1": "sync-thread-1" });
  });

  it("propagates settings updates to the other client", async () => {
    await renderClients();

    expect(contextValue!.hasPersistedSettings).toBe(false);
    expect(contextB!.settings.theme).toBe("dark");

    await act(async () => {
      expect(
        await contextValue!.updateSettings({
          ...contextValue!.settings,
          theme: "light",
          fontSize: 18,
        }),
      ).toBe(true);
    });

    expect(contextB!.hasPersistedSettings).toBe(true);
    expect(contextB!.settings).toMatchObject({ theme: "light", fontSize: 18 });
    expect(contextValue!.settings.theme).toBe("light");
  });
});
