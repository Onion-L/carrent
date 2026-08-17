import { afterEach, describe, expect, it } from "bun:test";

import "../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import type { AppStateCommand } from "../../shared/appStateAuthority";
import type { ThreadDeletionAppStateSnapshots } from "../../shared/chat";
import type {
  AppStateSnapshot,
  AssociationThreadDraftRecord,
} from "../../shared/workspacePersistence";
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
let testAuthority: ReturnType<typeof createFakeAppStateAuthority> | null = null;

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
  testAuthority = authority;
  window.carrent = {
    appState: {
      load: async () => ({ status: "ready", snapshot }),
      reread: async () => ({ status: "ready", snapshot }),
      fullReset: async () => ({ status: "ready", snapshot }),
      subscribe: authority.subscribe,
      unsubscribe: authority.unsubscribe,
      command: authority.command,
      onChanged: authority.onChanged,
      onFlushRequest: () => () => {},
      flushDone: async () => {},
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
        assistantMessageId: "assistant-1",
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
    expect(savedSnapshot?.threadMessages).toHaveLength(2);
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
        assistantMessageId: "assistant-1",
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

describe("thread content flush concurrency", () => {
  it("submits thread-content:update with the current authority baseRevision", async () => {
    const commands: AppStateCommand[] = [];
    savedSnapshot = null;
    contextValue = null;
    const authority = createFakeAppStateAuthority(baseSnapshot, {
      onPersist: (next) => {
        savedSnapshot = next;
      },
      commandHook: async (command) => {
        commands.push(command);
        return null;
      },
    });
    testAuthority = authority;
    window.carrent = {
      appState: {
        load: async () => ({ status: "ready", snapshot: baseSnapshot }),
        reread: async () => ({ status: "ready", snapshot: baseSnapshot }),
        fullReset: async () => ({ status: "ready", snapshot: baseSnapshot }),
        subscribe: authority.subscribe,
        unsubscribe: authority.unsubscribe,
        command: authority.command,
        onChanged: authority.onChanged,
        onFlushRequest: () => () => {},
        flushDone: async () => {},
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

    // Advance authority revision so the flush is not at 0.
    await act(async () => {
      expect(await contextValue!.renameWorkspace("workspace-1", "Renamed")).toMatchObject({
        ok: true,
      });
    });
    const revisionBeforeFlush = testAuthority!.getState().revision;
    expect(revisionBeforeFlush).toBeGreaterThan(0);

    await act(async () => {
      contextValue!.updateThreadContent((content) => ({
        ...content,
        threadMessages: [
          ...content.threadMessages,
          {
            id: "message-flush-1",
            threadId: "thread-1",
            role: "user",
            content: "flush me",
            createdAt: "2026-07-29T13:00:00.000Z",
            attachments: [],
          },
        ],
      }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    const contentUpdate = commands.find((command) => command.type === "thread-content:update");
    expect(contentUpdate).toBeDefined();
    expect(contentUpdate?.baseRevision).toBe(revisionBeforeFlush);
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
        assistantMessageId: "assistant-1",
        message: "first turn",
        attachments: [],
        startedAt: "2026-07-29T12:31:39.718Z",
        messageCreatedAt: "2026-07-29T12:31:39.700Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
        titleSource: "first turn",
        draft: { content: "first turn", attachedSkillNames: [], attachments: [] },
      });
    });

    expect(savedSnapshot?.threadMessages?.[0]?.createdAt).toBe("2026-07-29T12:31:39.700Z");
    expect(savedSnapshot?.threadRuns?.[0]?.startedAt).toBe("2026-07-29T12:31:39.718Z");
  });

  it("persists Local Path Context on the promoted user message", async () => {
    const localPathContexts = [
      { path: "/tmp/notes.md", basename: "notes.md", kind: "file" as const },
      { path: "/tmp/reference", basename: "reference", kind: "directory" as const },
    ];
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
          localPathContexts,
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
        assistantMessageId: "assistant-1",
        message: "first turn",
        attachments: [],
        localPathContexts,
        startedAt: "2026-07-29T12:31:39.718Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
        titleSource: "first turn",
        draft: {
          content: "first turn",
          attachedSkillNames: [],
          attachments: [],
          localPathContexts,
        },
      });
    });

    expect(savedSnapshot?.threadMessages?.[0]?.localPathContexts).toEqual(localPathContexts);
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

  // Mirrors the real cleanup: the Main-process deletion transaction commits
  // and the authority adopts the committed snapshot.
  const transactionCleanup = async (
    threadIds: string[],
    snapshots: ThreadDeletionAppStateSnapshots,
  ) => {
    testAuthority?.commitThreadDeletion({
      ...snapshots,
      threadData: { threadIds, attachmentStorageKeys: [] },
    });
  };

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
      expect(await contextValue!.deleteWorkspace("workspace-2", transactionCleanup)).toBe(true);
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
      expect(
        await contextValue!.removeAssociation("workspace-1", "project-2", transactionCleanup),
      ).toBe(true);
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
          runtimeId: "kimi",
          planMode: true,
        }),
      ).toBe(true);
    });
    expect(contextB!.threads.find((thread) => thread.id === "sync-thread-1")).toMatchObject({
      runtimeId: "kimi",
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
          fontSizeInterface: 18,
        }),
      ).toBe(true);
    });

    expect(contextB!.hasPersistedSettings).toBe(true);
    expect(contextB!.settings).toMatchObject({ theme: "light", fontSizeInterface: 18 });
    expect(contextValue!.settings.theme).toBe("light");
  });

  it("converges association draft edits, attachments, Local Path Context, and config across clients", async () => {
    await renderClients();

    let draft: AssociationThreadDraftRecord | null = null;
    await act(async () => {
      draft = await contextValue!.openThreadDraft("workspace-1", "project-1");
    });
    expect(draft).not.toBe(null);
    expect(contextB!.threadDrafts.map((item) => item.id)).toEqual([draft!.id]);

    // Get-or-create from the other client returns the same draft.
    let reopened: AssociationThreadDraftRecord | null = null;
    await act(async () => {
      reopened = await contextB!.openThreadDraft("workspace-1", "project-1");
    });
    expect(reopened!.id).toBe(draft!.id);
    expect(contextValue!.threadDrafts).toHaveLength(1);

    const attachment = {
      id: "att-1",
      kind: "file" as const,
      name: "notes.txt",
      mimeType: "text/plain",
      size: 5,
      storageKey: "notes.txt",
    };
    const localPathContexts = [
      { path: "/tmp/reference", basename: "reference", kind: "directory" as const },
    ];
    await act(async () => {
      expect(
        await contextValue!.updateThreadDraft(draft!.id, {
          content: "from A",
          attachedSkillNames: [],
          attachments: [],
        }),
      ).toBe(true);
    });
    expect(contextB!.threadDrafts[0]?.content).toBe("from A");

    await act(async () => {
      expect(
        await contextB!.updateThreadDraft(draft!.id, {
          content: "from B",
          attachedSkillNames: [],
          attachments: [attachment],
          localPathContexts,
        }),
      ).toBe(true);
    });
    // Last writer wins; both clients converge on it, attachments and contexts included.
    expect(contextValue!.threadDrafts[0]?.content).toBe("from B");
    expect(contextValue!.threadDrafts[0]?.attachments).toHaveLength(1);
    expect(contextB!.threadDrafts[0]?.attachments).toHaveLength(1);
    expect(contextValue!.threadDrafts[0]?.localPathContexts).toEqual(localPathContexts);
    expect(contextB!.threadDrafts[0]?.localPathContexts).toEqual(localPathContexts);

    await act(async () => {
      expect(
        await contextB!.updateThreadDraftConfig(draft!.id, {
          runtimeId: "kimi",
          runtimeMode: "full-access",
          planMode: true,
        }),
      ).toBe(true);
    });
    expect(contextValue!.threadDrafts[0]).toMatchObject({
      runtimeId: "kimi",
      runtimeMode: "full-access",
      planMode: true,
    });
  });

  it("discards a draft in every client", async () => {
    await renderClients();

    let draft: AssociationThreadDraftRecord | null = null;
    await act(async () => {
      draft = await contextValue!.openThreadDraft("workspace-1", "project-1");
    });

    await act(async () => {
      expect(await contextB!.discardThreadDraft(draft!.id)).toBe(true);
    });

    expect(contextValue!.threadDrafts).toEqual([]);
    expect(contextB!.threadDrafts).toEqual([]);
    // A stale client cannot recreate or update the discarded draft.
    await act(async () => {
      expect(await contextValue!.updateThreadDraft(draft!.id, null)).toBe(false);
    });
    expect(contextB!.threadDrafts).toEqual([]);
  });

  it("resolves a promotion race to exactly one thread and one initial message", async () => {
    await renderClients();

    let draft: AssociationThreadDraftRecord | null = null;
    await act(async () => {
      draft = await contextValue!.openThreadDraft("workspace-1", "project-1");
    });

    const input = (messageId: string, runId: string) => ({
      draftId: draft!.id,
      titleSource: "Race",
      runId,
      messageId,
      assistantMessageId: `assistant-${runId}`,
      message: "race message",
      attachments: [],
      startedAt: "2026-07-30T08:00:00.000Z",
      runtimeId: "kimi" as const,
      runtimeMode: "approval-required" as const,
      planMode: false,
      draft: { content: "race message", attachedSkillNames: [], attachments: [] },
    });

    let resultA: unknown;
    let resultB: unknown;
    await act(async () => {
      [resultA, resultB] = await Promise.all([
        contextValue!.prepareThreadDraftPromotion(input("m-a", "run-a")),
        contextB!.prepareThreadDraftPromotion(input("m-b", "run-b")),
      ]);
    });

    // Exactly one client promoted; the other observed the race and backed off.
    expect([resultA, resultB].filter(Boolean)).toHaveLength(1);
    for (const context of [contextValue!, contextB!]) {
      expect(context.threads.filter((thread) => thread.id === draft!.threadId)).toHaveLength(1);
      expect(
        context.threadMessages.filter((message) => message.threadId === draft!.threadId),
      ).toHaveLength(2);
      expect(context.threadRuns.filter((run) => run.threadId === draft!.threadId)).toHaveLength(1);
      expect(context.threadDrafts).toEqual([]);
    }
  });

  it("broadcasts a permanent thread deletion to every client", async () => {
    await renderClients();

    await act(async () => {
      expect(await contextValue!.archiveThread("sync-thread-1")).toBe(true);
    });
    expect(contextB!.threads.find((thread) => thread.id === "sync-thread-1")?.archived).toBe(true);

    const cleanup = async (snapshots: ThreadDeletionAppStateSnapshots) => {
      testAuthority?.commitThreadDeletion({
        ...snapshots,
        threadData: { threadIds: ["sync-thread-1"], attachmentStorageKeys: [] },
      });
    };
    await act(async () => {
      expect(await contextValue!.permanentlyDeleteThread("sync-thread-1", cleanup)).toBe(true);
    });

    expect(contextValue!.threads.map((thread) => thread.id)).toEqual(["sync-thread-2"]);
    expect(contextB!.threads.map((thread) => thread.id)).toEqual(["sync-thread-2"]);
  });

  it("publishes a history thread deletion through the external transaction", async () => {
    await renderClients();
    const cleanup = async (snapshots: ThreadDeletionAppStateSnapshots) => {
      testAuthority?.commitThreadDeletion({
        ...snapshots,
        threadData: { threadIds: ["sync-thread-1"], attachmentStorageKeys: [] },
      });
    };

    await act(async () => {
      expect(await contextValue!.removeThreadSnapshot("sync-thread-1", cleanup)).toBe(true);
    });

    expect(contextValue!.threads.map((thread) => thread.id)).toEqual(["sync-thread-2"]);
    expect(contextB!.threads.map((thread) => thread.id)).toEqual(["sync-thread-2"]);
  });

  it("rejects a command with a stale base revision without touching either client", async () => {
    await renderClients();

    await act(async () => {
      expect(await contextValue!.renameWorkspace("workspace-1", "Home")).toMatchObject({
        ok: true,
      });
    });

    const stale = await testAuthority!.command({
      commandId: "stale-1",
      type: "workspace:rename",
      payload: { workspaceId: "workspace-1", name: "Stale" },
      baseRevision: 0,
    });

    expect(stale).toMatchObject({ status: "rejected", reason: "stale" });
    expect(contextValue!.workspaces.find((workspace) => workspace.id === "workspace-1")?.name).toBe(
      "Home",
    );
    expect(contextB!.workspaces.find((workspace) => workspace.id === "workspace-1")?.name).toBe(
      "Home",
    );
  });

  it("converges thread composer work across clients through debounced commands", async () => {
    await renderClients();

    await act(async () => {
      contextValue!.updateThreadContent((content) => ({
        ...content,
        threadWork: {
          "sync-thread-1": {
            draft: { content: "composer draft", attachedSkillNames: [], attachments: [] },
            queuedMessages: [],
          },
        },
      }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(contextB!.threadWork["sync-thread-1"]?.draft?.content).toBe("composer draft");
    expect(contextValue!.threadWork["sync-thread-1"]?.draft?.content).toBe("composer draft");
  });

  it("persists draft state across a simulated restart", async () => {
    await renderClients();
    const localPathContexts = [
      { path: "/tmp/restart.md", basename: "restart.md", kind: "file" as const },
    ];

    let draft: AssociationThreadDraftRecord | null = null;
    await act(async () => {
      draft = await contextValue!.openThreadDraft("workspace-1", "project-1");
    });
    await act(async () => {
      expect(
        await contextValue!.updateThreadDraft(draft!.id, {
          content: "restart me",
          attachedSkillNames: ["tdd"],
          attachments: [],
          localPathContexts,
        }),
      ).toBe(true);
    });
    await act(async () => {
      expect(
        await contextValue!.updateThreadDraftConfig(draft!.id, {
          runtimeId: "kimi",
          runtimeMode: "full-access",
          planMode: true,
        }),
      ).toBe(true);
    });

    const persisted = savedSnapshot!;
    expect(persisted.threadDrafts).toHaveLength(1);

    // Simulated restart: tear down both clients and boot a fresh provider
    // over the persisted snapshot.
    await act(async () => rootB!.unmount());
    containerB?.remove();
    rootB = null;
    containerB = null;
    contextB = null;
    await act(async () => root!.unmount());
    container?.remove();
    root = null;
    container = null;

    await renderProvider(persisted);

    expect(contextValue!.threadDrafts).toHaveLength(1);
    expect(contextValue!.threadDrafts[0]).toMatchObject({
      content: "restart me",
      attachedSkillNames: ["tdd"],
      localPathContexts,
      runtimeId: "kimi",
      runtimeMode: "full-access",
      planMode: true,
    });
  });
});
