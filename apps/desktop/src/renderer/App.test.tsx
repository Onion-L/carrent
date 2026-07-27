import { afterEach, describe, expect, it } from "bun:test";

import "./test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigateFunction,
  type NavigationType,
} from "react-router-dom";

import type { AppStateSnapshot, WorkspaceSnapshot } from "../shared/workspacePersistence";
import type { ChatTurnRequest } from "../shared/chat";
import App from "./App";

const legacySnapshot: WorkspaceSnapshot = {
  version: 1,
  projects: [],
  chats: [],
  messages: [],
  activeThreadId: null,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let currentPathname = "";
let currentNavigationType: NavigationType | null = null;
let testNavigate: NavigateFunction | null = null;

function NavigationProbe() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  currentPathname = location.pathname;
  currentNavigationType = navigationType;
  testNavigate = navigate;
  return null;
}

function installBridge(
  appState: AppStateSnapshot | null,
  saved: AppStateSnapshot[],
  selectedDirectories: string[] = [],
  saveFails: boolean | number | number[] = false,
  chatRequests: ChatTurnRequest[] = [],
  chatSendFails = false,
  workspaceSnapshot: WorkspaceSnapshot = legacySnapshot,
  workspaceLoadFails: boolean | number = false,
) {
  let chatListener: ((event: import("../shared/chat").ChatRunEvent) => void) | null = null;
  let saveAttempt = 0;
  let workspaceLoadAttempt = 0;
  window.carrent = {
    appState: {
      load: async () => appState,
      save: async (snapshot: AppStateSnapshot) => {
        saveAttempt += 1;
        if (
          saveFails === true ||
          saveFails === saveAttempt ||
          (Array.isArray(saveFails) && saveFails.includes(saveAttempt))
        ) {
          throw new Error("disk full");
        }
        saved.push(structuredClone(snapshot));
      },
    },
    dialog: {
      openDirectory: async () => {
        const selected = selectedDirectories.shift();
        return selected
          ? { canceled: false, filePaths: [selected] }
          : { canceled: true, filePaths: [] };
      },
    },
    workspace: {
      load: async () => {
        workspaceLoadAttempt += 1;
        if (workspaceLoadFails === true || workspaceLoadFails === workspaceLoadAttempt) {
          throw new Error("content unavailable");
        }
        return workspaceSnapshot;
      },
      remember: () => {},
      save: async () => {},
    },
    runtimes: {
      list: async () => [
        {
          id: "kimi",
          name: "Kimi Code",
          command: "kimi",
          availability: "detected",
          enabled: true,
          status: "running",
          configuration: "configured",
          verification: "passed",
          supportsModelPing: true,
        },
      ],
      listModels: async () => ({ state: "listed", models: [] }),
    },
    mcpServer: {
      getStatus: async () => ({ enabled: false, running: false }),
      start: async () => ({ enabled: true, running: true }),
      stop: async () => ({ enabled: false, running: false }),
    },
    providerSessions: {
      load: async () => ({ version: 1, sessions: {} }),
      save: async () => {},
    },
    skills: { list: async () => [] },
    attachments: {
      store: async () => {
        throw new Error("not used");
      },
      read: async () => new Uint8Array(),
    },
    git: {
      branches: async () => ({ current: "main", branches: ["main"], branchWorktrees: [] }),
      checkout: async () => ({ current: "main", branches: ["main"], branchWorktrees: [] }),
      createBranch: async () => ({ current: "main", branches: ["main"], branchWorktrees: [] }),
      workspaceSnapshot: async () => ({ state: "unavailable", reason: "not-a-repository" }),
      workspaceDiff: async () => ({ state: "unavailable", reason: "not-a-repository" }),
    },
    chat: {
      send: async (request: ChatTurnRequest) => {
        if (chatSendFails) throw new Error("runtime unavailable");
        chatRequests.push(structuredClone(request));
        const runId = request.runId ?? "run-1";
        queueMicrotask(() => {
          chatListener?.({
            type: "started",
            runId,
            requestKey: request.requestKey,
            threadId: request.threadId,
          });
        });
        return { runId };
      },
      stop: async () => {},
      respondToPermission: async () => {},
      respondToQuestion: async () => {},
      getKimiStatus: async () => null,
      onEvent: (listener: (event: import("../shared/chat").ChatRunEvent) => void) => {
        chatListener = listener;
        return () => {
          if (chatListener === listener) chatListener = null;
        };
      },
      deleteThreadData: async () => {},
    },
  } as unknown as Window["carrent"];
}

async function renderApp(
  appState: AppStateSnapshot | null,
  initialEntry = "/",
  selectedDirectories: string[] = [],
  saveFails: boolean | number | number[] = false,
  chatRequests: ChatTurnRequest[] = [],
  chatSendFails = false,
  workspaceSnapshot: WorkspaceSnapshot = legacySnapshot,
  workspaceLoadFails: boolean | number = false,
) {
  const saved: AppStateSnapshot[] = [];
  localStorage.setItem(
    "carrent:settings",
    JSON.stringify({
      autoDetectRuntimes: true,
      theme: "dark",
      fontSize: 14,
      runtimeEnabledById: { kimi: true },
      runtimeDefaultModelById: {},
    }),
  );
  installBridge(
    appState,
    saved,
    selectedDirectories,
    saveFails,
    chatRequests,
    chatSendFails,
    workspaceSnapshot,
    workspaceLoadFails,
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    root!.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
        <NavigationProbe />
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  return saved;
}

function buttonNamed(name: string) {
  const button = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) =>
      candidate.textContent?.trim() === name || candidate.getAttribute("aria-label") === name,
  );
  if (!button) throw new Error(`Button not found: ${name}`);
  return button;
}

async function fillInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    input.dispatchEvent(new window.Event("change", { bubbles: true }));
    input.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "a" }));
  });
}

async function fillTextarea(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    textarea.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
    setter.call(textarea, value);
    textarea.dispatchEvent(new window.Event("input", { bubbles: true }));
    textarea.dispatchEvent(new window.Event("change", { bubbles: true }));
    textarea.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "a" }));
  });
}

async function click(button: HTMLButtonElement) {
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

function composerSendButton() {
  const icon = [...container!.querySelectorAll<SVGElement>(".lucide-arrow-up")].at(-1);
  const button = icon?.closest<HTMLButtonElement>("button");
  if (!button) throw new Error("Composer send button not found");
  return button;
}

afterEach(async () => {
  if (root) {
    await act(async () => root!.unmount());
  }
  container?.remove();
  localStorage.clear();
  root = null;
  container = null;
  currentPathname = "";
  currentNavigationType = null;
  testNavigate = null;
});

describe("Workspace App State foundation", () => {
  it("creates the first Workspace from the global first-use state", async () => {
    const saved = await renderApp(null);

    expect(container!.textContent).toContain("Create your first Workspace");
    expect(container!.textContent).not.toContain("Select a thread to start");

    const input = container!.querySelector<HTMLInputElement>('input[name="workspaceName"]')!;
    await fillInput(input, "  Personal  ");
    await click(buttonNamed("Create Workspace"));

    expect(saved).toHaveLength(1);
    expect(saved[0].workspaces).toEqual([
      { id: saved[0].workspaces[0].id, name: "Personal", order: 0 },
    ]);
    expect(saved[0].activeWorkspaceId).toBe(saved[0].workspaces[0].id);
    expect(container!.textContent).toContain("Personal");
    expect(container!.textContent).toContain("This Workspace has no Projects yet.");
  });

  it("creates, renames, and switches Workspaces without changing identity or order", async () => {
    const saved = await renderApp(
      {
        version: 1,
        workspaces: [
          { id: "workspace-1", name: "Personal", order: 0 },
          { id: "workspace-2", name: "Client", order: 1 },
        ],
        projects: [],
        associations: [],
        activeWorkspaceId: "workspace-1",
      },
      "/workspace/workspace-1",
    );

    await click(buttonNamed("Rename Workspace"));
    const renameInput = container!.querySelector<HTMLInputElement>('input[name="workspaceName"]')!;
    await fillInput(renameInput, " client ");
    await click(buttonNamed("Rename"));
    expect(container!.textContent).toContain("Workspace names must be unique.");
    expect(saved).toHaveLength(0);

    await fillInput(renameInput, "Home");
    await click(buttonNamed("Rename"));
    expect(saved.at(-1)?.workspaces).toEqual([
      { id: "workspace-1", name: "Home", order: 0 },
      { id: "workspace-2", name: "Client", order: 1 },
    ]);

    await click(buttonNamed("Client"));
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-2");
    expect(container!.querySelector("h1")?.textContent).toBe("Client");

    const saveCount = saved.length;
    await click(buttonNamed("Client"));
    expect(saved).toHaveLength(saveCount);

    await click(buttonNamed("Create Workspace"));
    const createInput = container!.querySelector<HTMLInputElement>('input[name="workspaceName"]')!;
    await fillInput(createInput, "Research");
    await click(buttonNamed("Create"));

    expect(saved.at(-1)?.workspaces.at(-1)).toEqual({
      id: saved.at(-1)!.activeWorkspaceId,
      name: "Research",
      order: 2,
    });
    expect(container!.querySelector("h1")?.textContent).toBe("Research");
  });

  it("restores the persisted active Workspace after restart", async () => {
    await renderApp({
      version: 1,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      projects: [],
      associations: [],
      activeWorkspaceId: "workspace-2",
    });

    expect(container!.querySelector("h1")?.textContent).toBe("Client");
    expect(buttonNamed("Personal").getAttribute("aria-current")).toBe(null);
    expect(buttonNamed("Client").getAttribute("aria-current")).toBe("page");
  });

  it("synchronizes the selected Workspace when navigation opens another valid overview", async () => {
    const saved = await renderApp(
      {
        version: 1,
        workspaces: [
          { id: "workspace-1", name: "Personal", order: 0 },
          { id: "workspace-2", name: "Client", order: 1 },
        ],
        projects: [],
        associations: [],
        activeWorkspaceId: "workspace-1",
      },
      "/workspace/workspace-2",
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-2");
    expect(container!.querySelector("h1")?.textContent).toBe("Client");
    expect(buttonNamed("Client").getAttribute("aria-current")).toBe("page");
  });
});

describe("three-level navigation", () => {
  function navigationState(): AppStateSnapshot {
    return {
      version: 1,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          alias: "Personal Carrent",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
        {
          workspaceId: "workspace-2",
          projectId: "project-1",
          alias: "Client Carrent",
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
          title: "Personal Thread",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
        {
          id: "thread-2",
          workspaceId: "workspace-2",
          projectId: "project-1",
          title: "Client Thread",
          createdAt: "2026-07-27T09:00:00.000Z",
          lastActivityAt: "2026-07-27T09:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      lastThreadIdByWorkspace: {
        "workspace-1": "thread-1",
        "workspace-2": "thread-2",
      },
      activeWorkspaceId: "workspace-1",
    };
  }

  const navigationWorkspaceSnapshot: WorkspaceSnapshot = {
    version: 1,
    projects: [
      {
        id: "project-1",
        name: "Carrent",
        path: "/code/carrent",
        threads: [
          { id: "thread-1", title: "Personal Thread", updatedAt: "now" },
          { id: "thread-2", title: "Client Thread", updatedAt: "now" },
        ],
      },
    ],
    chats: [],
    messages: [],
    activeThreadId: null,
  };

  it("restores the active Workspace's last valid Thread on startup", async () => {
    await renderApp(navigationState(), "/", [], false, [], false, navigationWorkspaceSnapshot);

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.textContent).toContain("Personal Thread");
  });

  it("restores each Workspace's last valid Thread and keeps repeated selection a no-op", async () => {
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      navigationWorkspaceSnapshot,
    );

    await click(buttonNamed("Client"));
    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1/thread/thread-2");
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-2");

    const saveCount = saved.length;
    await click(buttonNamed("Client"));
    expect(saved).toHaveLength(saveCount);
    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1/thread/thread-2");
  });

  it("groups the current Workspace's Threads, shows the full path, and preserves push history", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      navigationWorkspaceSnapshot,
    );

    const navigationPane = container!.querySelector("aside.border-r")!;
    expect(navigationPane.textContent).toContain("Personal Carrent");
    expect(navigationPane.textContent).toContain("Personal Thread");
    expect(navigationPane.textContent).not.toContain("Client Thread");
    expect(container!.textContent).toContain("Personal / Personal Carrent / Personal Thread");

    await click(buttonNamed("Personal Carrent"));
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
    expect(currentNavigationType).toBe("PUSH");

    await click(buttonNamed("Personal Thread"));
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(currentNavigationType).toBe("PUSH");

    await act(async () => {
      testNavigate!(-1);
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
  });

  it("falls back from a stale startup Thread to the active Workspace overview", async () => {
    const state = navigationState();
    state.lastThreadIdByWorkspace = { "workspace-1": "missing-thread" };

    await renderApp(state, "/", [], false, [], false, navigationWorkspaceSnapshot);

    expect(currentPathname).toBe("/workspace/workspace-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.querySelector("h1")?.textContent).toBe("Personal");
    expect(container!.textContent).toContain("The last Thread could not be restored.");
    buttonNamed("Dismiss toast");
  });

  it("replaces a missing Thread with its Project overview and one dismissible notice", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/missing-thread",
      [],
      false,
      [],
      false,
      navigationWorkspaceSnapshot,
    );

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.textContent).toContain("Thread could not be found.");
    buttonNamed("Dismiss toast");
  });

  it("replaces legacy routes without translating their identity", async () => {
    await renderApp(
      navigationState(),
      "/thread/project-1/thread-from-old-route",
      [],
      false,
      [],
      false,
      navigationWorkspaceSnapshot,
    );

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.textContent).toContain(
      "This link is incompatible with the current navigation model.",
    );
  });

  it("replaces a legacy route even when the app has no Workspaces", async () => {
    await renderApp(null, "/chat/legacy-thread");

    expect(currentPathname).toBe("/");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.textContent).toContain(
      "This link is incompatible with the current navigation model.",
    );
    expect(container!.textContent).toContain("Create your first Workspace");
  });

  it("replaces the current Thread route after a successful content retry", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      navigationWorkspaceSnapshot,
      1,
    );

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(container!.textContent).toContain("Thread content could not be loaded.");
    expect(container!.textContent).not.toContain("corrupt");
    await click(buttonNamed("Retry"));
    expect(container!.textContent).not.toContain("Thread content could not be loaded.");
    expect(container!.textContent).toContain("Personal Thread");
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(currentNavigationType).toBe("REPLACE");
  });

  it("pushes history when content-load recovery opens the parent overview", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      navigationWorkspaceSnapshot,
      true,
    );

    await click(buttonNamed("Open Project Overview"));
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
    expect(currentNavigationType).toBe("PUSH");
  });

  it("replaces a three-level route with extra path segments", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1/extra",
      [],
      false,
      [],
      false,
      navigationWorkspaceSnapshot,
    );

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.textContent).toContain("Thread could not be found.");
  });

  it("preserves the fixed rail and session-only middle pane controls", async () => {
    await renderApp(navigationState(), "/workspace/workspace-1");

    const navigationPane = container!.querySelector("aside.border-r")!;
    const middlePane = navigationPane.parentElement as HTMLDivElement;
    const workspaceRail = container!.querySelector<HTMLDivElement>('div[style*="width: 58px"]');
    expect(workspaceRail).not.toBe(null);
    expect(middlePane.style.width).toBe("280px");

    await click(buttonNamed("Collapse sidebar"));
    expect(middlePane.style.width).toBe("0px");
    await click(buttonNamed("Expand sidebar"));
    expect(middlePane.style.width).toBe("280px");

    const resizer = container!.querySelector<HTMLDivElement>(".cursor-col-resize")!;
    await act(async () => {
      resizer.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, clientX: 0 }));
      document.dispatchEvent(new window.MouseEvent("mousemove", { clientX: 1000 }));
      document.dispatchEvent(new window.MouseEvent("mouseup"));
    });
    expect(middlePane.style.width).toBe("480px");

    await act(async () => {
      resizer.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, clientX: 0 }));
      document.dispatchEvent(new window.MouseEvent("mousemove", { clientX: -1000 }));
      document.dispatchEvent(new window.MouseEvent("mouseup"));
    });
    expect(middlePane.style.width).toBe("200px");
  });

  it("replaces an invalid ownership chain with the nearest valid parent and a notice", async () => {
    await renderApp(
      {
        version: 1,
        workspaces: [
          { id: "workspace-1", name: "Personal", order: 0 },
          { id: "workspace-2", name: "Client", order: 1 },
        ],
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
            title: "Navigation",
            createdAt: "2026-07-27T08:00:00.000Z",
            lastActivityAt: "2026-07-27T08:00:00.000Z",
            runtimeId: "kimi",
            runtimeMode: "approval-required",
            planMode: false,
          },
        ],
        activeWorkspaceId: "workspace-1",
      },
      "/workspace/workspace-2/project/project-1/thread/thread-1",
    );

    expect(currentPathname).toBe("/workspace/workspace-2");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.textContent).toContain("Project is not available in this Workspace.");
    expect(container!.querySelector("h1")?.textContent).toBe("Client");
  });
});

describe("Workspace Projects and Associations", () => {
  const emptyWorkspaceState: AppStateSnapshot = {
    version: 1,
    workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
    projects: [],
    associations: [],
    activeWorkspaceId: "workspace-1",
  };

  it("adds a new Project and Association atomically, then opens its overview", async () => {
    const saved = await renderApp(emptyWorkspaceState, "/workspace/workspace-1", ["/code/carrent"]);

    expect(container!.textContent).toContain(
      "Carrent never moves or copies the selected directory.",
    );
    await click(buttonNamed("Add Project"));

    expect(saved).toHaveLength(1);
    expect(saved[0].projects).toEqual([
      {
        id: saved[0].projects[0].id,
        name: "carrent",
        workingDirectory: "/code/carrent",
      },
    ]);
    expect(saved[0].associations).toEqual([
      {
        workspaceId: "workspace-1",
        projectId: saved[0].projects[0].id,
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
    ]);
    expect(container!.querySelector("h1")?.textContent).toBe("carrent");
    expect(container!.textContent).toContain("/code/carrent");
  });

  it("reuses a known Project across Workspaces and ignores a duplicate Association", async () => {
    const state: AppStateSnapshot = {
      version: 1,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
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
      activeWorkspaceId: "workspace-2",
    };
    const saved = await renderApp(state, "/workspace/workspace-2", [
      "/code/carrent",
      "/code/carrent",
    ]);

    await click(buttonNamed("Add Project"));
    expect(saved).toHaveLength(1);
    expect(saved[0].projects).toEqual(state.projects);
    expect(saved[0].associations).toHaveLength(2);
    expect(saved[0].associations[1]).toMatchObject({
      workspaceId: "workspace-2",
      projectId: "project-1",
      order: 0,
    });

    await click(buttonNamed("Add Project"));
    expect(saved).toHaveLength(1);
  });

  function sharedProjectState(): AppStateSnapshot {
    return {
      version: 1,
      workspaces: [
        { id: "workspace-1", name: "Personal", order: 0 },
        { id: "workspace-2", name: "Client", order: 1 },
      ],
      projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
      associations: [
        {
          workspaceId: "workspace-1",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
        {
          workspaceId: "workspace-2",
          projectId: "project-1",
          order: 0,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
      activeWorkspaceId: "workspace-1",
    };
  }

  it("sets and clears a Workspace-local Project alias", async () => {
    const state = sharedProjectState();
    const saved = await renderApp(state, "/workspace/workspace-1/project/project-1");

    const aliasInput = container!.querySelector<HTMLInputElement>('input[name="projectAlias"]')!;
    await fillInput(aliasInput, "Personal Carrent");
    await click(buttonNamed("Save Alias"));

    expect(saved.at(-1)?.associations[0].alias).toBe("Personal Carrent");
    expect(saved.at(-1)?.associations[1]).toEqual(state.associations[1]);
    expect(container!.querySelector("h1")?.textContent).toBe("Personal Carrent");

    const savedAliasInput = container!.querySelector<HTMLInputElement>(
      'input[name="projectAlias"]',
    )!;
    await fillInput(savedAliasInput, "");
    await click(buttonNamed("Save Alias"));
    expect(saved.at(-1)?.associations[0].alias).toBeUndefined();
    expect(container!.querySelector("h1")?.textContent).toBe("Carrent");
  });

  it("updates Thread defaults for only the current Association", async () => {
    const state = sharedProjectState();
    const saved = await renderApp(state, "/workspace/workspace-1/project/project-1");

    const runtimeSelect = container!.querySelector<HTMLSelectElement>(
      'select[name="defaultRuntimeId"]',
    )!;
    await act(async () => {
      runtimeSelect.value = "codex";
      runtimeSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    const modelInput = container!.querySelector<HTMLInputElement>(
      'input[name="defaultRuntimeModelId"]',
    )!;
    await fillInput(modelInput, "gpt-5");
    const modeSelect = container!.querySelector<HTMLSelectElement>(
      'select[name="defaultRuntimeMode"]',
    )!;
    await act(async () => {
      modeSelect.value = "full-access";
      modeSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
    });
    await click(buttonNamed("Save Thread Defaults"));

    expect(saved.at(-1)?.associations[0]).toMatchObject({
      defaultRuntimeId: "codex",
      defaultRuntimeModelId: "gpt-5",
      defaultRuntimeMode: "full-access",
    });
    expect(saved.at(-1)?.associations[1]).toEqual(state.associations[1]);
  });

  it("warns and renames the shared Project across Associations", async () => {
    const saved = await renderApp(sharedProjectState(), "/workspace/workspace-1/project/project-1");

    const sharedNameInput = container!.querySelector<HTMLInputElement>(
      'input[name="sharedProjectName"]',
    )!;
    await fillInput(sharedNameInput, "Carrent Desktop");
    expect(container!.textContent).toContain("affects every associated Workspace");
    await click(buttonNamed("Save Shared Name"));

    expect(saved.at(-1)?.projects[0].name).toBe("Carrent Desktop");
    expect(container!.querySelector("h1")?.textContent).toBe("Carrent Desktop");
  });

  it("reorders Projects inside one Workspace without affecting another Association", async () => {
    const state = sharedProjectState();
    state.projects.push({
      id: "project-2",
      name: "Website",
      workingDirectory: "/code/website",
    });
    state.associations.push({
      workspaceId: "workspace-1",
      projectId: "project-2",
      order: 1,
      defaultRuntimeId: "kimi",
      defaultRuntimeMode: "approval-required",
    });
    const saved = await renderApp(state, "/workspace/workspace-1");

    await click(buttonNamed("Move Website up"));

    expect(saved.at(-1)?.associations).toEqual([
      { ...state.associations[0], order: 1 },
      state.associations[1],
      { ...state.associations[2], order: 0 },
    ]);
  });

  it("shows a Project settings save failure without changing displayed state", async () => {
    const saved = await renderApp(
      sharedProjectState(),
      "/workspace/workspace-1/project/project-1",
      [],
      true,
    );
    const sharedNameInput = container!.querySelector<HTMLInputElement>(
      'input[name="sharedProjectName"]',
    )!;
    await fillInput(sharedNameInput, "Carrent Desktop");
    await click(buttonNamed("Save Shared Name"));

    expect(saved).toHaveLength(0);
    expect(container!.textContent).toContain("Project settings could not be saved.");
    expect(container!.querySelector("h1")?.textContent).toBe("Carrent");
  });
});

describe("Association Thread Drafts", () => {
  const state: AppStateSnapshot = {
    version: 1,
    workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
    projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/code/carrent" }],
    associations: [
      {
        workspaceId: "workspace-1",
        projectId: "project-1",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeModelId: "kimi-k2.5",
        defaultRuntimeMode: "approval-required",
      },
    ],
    threads: [],
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    activeWorkspaceId: "workspace-1",
  };

  it("persists one recoverable Draft without creating a Thread", async () => {
    const saved = await renderApp(state, "/workspace/workspace-1/project/project-1");

    await click(buttonNamed("New Thread"));

    expect(saved.at(-1)?.threads).toEqual([]);
    expect(saved.at(-1)?.threadDrafts).toHaveLength(1);
    expect(saved.at(-1)?.threadDrafts?.[0]).toMatchObject({
      workspaceId: "workspace-1",
      projectId: "project-1",
      content: "",
      runtimeId: "kimi",
      runtimeModelId: "kimi-k2.5",
      runtimeMode: "approval-required",
    });

    await fillTextarea(container!.querySelector("textarea")!, "Keep this across navigation");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(saved.at(-1)?.threadDrafts?.[0].content).toBe("Keep this across navigation");
    expect(saved.at(-1)?.threads).toEqual([]);
  });

  it("restores an Association Draft from the persisted App State", async () => {
    const restoredState: AppStateSnapshot = {
      ...state,
      threadDrafts: [
        {
          id: "draft-1",
          threadId: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          content: "Recovered request",
          attachedSkillNames: [],
          attachments: [],
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
    };
    const saved = await renderApp(restoredState, "/workspace/workspace-1/project/project-1");

    await click(buttonNamed("Resume Draft"));

    expect(container!.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Recovered request",
    );
    expect(saved).toHaveLength(0);
  });

  it("promotes the Draft on first send and dispatches the fixed three-level identity", async () => {
    const requests: ChatTurnRequest[] = [];
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1",
      [],
      false,
      requests,
    );

    await click(buttonNamed("New Thread"));
    await fillTextarea(container!.querySelector("textarea")!, "Implement association drafts");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const sendButton = composerSendButton();
    expect(sendButton.disabled).toBe(false);
    await click(sendButton);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      workspace: {
        kind: "project",
        workspaceId: "workspace-1",
        projectId: "project-1",
        projectPath: "/code/carrent",
      },
      draftRef: {
        projectId: "project-1",
        workspaceId: "workspace-1",
      },
      runtimeId: "kimi",
      runtimeModelId: "kimi-k2.5",
      runtimeMode: "approval-required",
      message: "Implement association drafts",
    });
    expect(saved.at(-1)?.threadDrafts).toEqual([]);
    expect(saved.at(-1)?.threads).toHaveLength(1);
    expect(saved.at(-1)?.threads?.[0]).toMatchObject({
      id: requests[0].threadId,
      workspaceId: "workspace-1",
      projectId: "project-1",
      runtimeId: "kimi",
      runtimeModelId: "kimi-k2.5",
      runtimeMode: "approval-required",
    });
    expect(saved.at(-1)?.threadMessages?.[0]).toMatchObject({
      threadId: requests[0].threadId,
      role: "user",
      content: "Implement association drafts",
    });
    expect(saved.at(-1)?.threadRuns?.[0]).toMatchObject({
      id: requests[0].runId,
      threadId: requests[0].threadId,
      runtimeId: "kimi",
      runtimeModelId: "kimi-k2.5",
      runtimeMode: "approval-required",
    });
  });

  it("keeps the Draft retryable when the first dispatch is rejected", async () => {
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1",
      [],
      false,
      [],
      true,
    );

    await click(buttonNamed("New Thread"));
    await fillTextarea(container!.querySelector("textarea")!, "Retry this request");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await click(composerSendButton());

    expect(saved.at(-1)?.threads).toEqual([]);
    expect(saved.at(-1)?.threadDrafts?.[0]).toMatchObject({
      workspaceId: "workspace-1",
      projectId: "project-1",
      content: "Retry this request",
    });
  });

  it("keeps the Draft persisted when dispatch rejection cleanup cannot be saved", async () => {
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1",
      [],
      [3],
      [],
      true,
    );

    await click(buttonNamed("New Thread"));
    await fillTextarea(container!.querySelector("textarea")!, "Retry after cleanup failure");
    await click(composerSendButton());

    expect(saved.at(-1)?.threads).toEqual([]);
    expect(saved.at(-1)?.threadDrafts?.[0]).toMatchObject({
      workspaceId: "workspace-1",
      projectId: "project-1",
      content: "Retry after cleanup failure",
    });
    expect(container!.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Retry after cleanup failure",
    );
  });

  it("keeps the Draft retryable when promotion persistence fails", async () => {
    const requests: ChatTurnRequest[] = [];
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1",
      [],
      3,
      requests,
    );

    await click(buttonNamed("New Thread"));
    await fillTextarea(container!.querySelector("textarea")!, "Persist this before promotion");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await click(composerSendButton());

    expect(requests).toHaveLength(0);
    expect(saved.at(-1)?.threads).toEqual([]);
    expect(saved.at(-1)?.threadDrafts?.[0]).toMatchObject({
      content: "Persist this before promotion",
      workspaceId: "workspace-1",
      projectId: "project-1",
    });
  });

  it("keeps the Draft persisted when final promotion commit fails", async () => {
    const requests: ChatTurnRequest[] = [];
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1",
      [],
      4,
      requests,
    );

    await click(buttonNamed("New Thread"));
    await fillTextarea(container!.querySelector("textarea")!, "Keep the finalization retryable");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await click(composerSendButton());

    expect(requests).toHaveLength(1);
    expect(saved.at(-1)?.threads).toEqual([]);
    expect(saved.at(-1)?.threadDrafts?.[0]).toMatchObject({
      content: "Keep the finalization retryable",
      workspaceId: "workspace-1",
      projectId: "project-1",
    });
  });

  it("recovers an App State Thread into the three-level route", async () => {
    const threadState: AppStateSnapshot = {
      ...state,
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Recovered Thread",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Recovered message",
          createdAt: "2026-07-27T08:00:00.000Z",
          attachments: [],
        },
      ],
    };

    await renderApp(threadState, "/workspace/workspace-1/project/project-1/thread/thread-1");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container!.textContent).toContain("Recovered Thread");
    expect(container!.textContent).toContain("Recovered message");
    expect(container!.querySelector("textarea") !== null).toBe(true);
  });

  it("does not dispatch an existing Thread Run when App State persistence fails", async () => {
    const requests: ChatTurnRequest[] = [];
    const threadState: AppStateSnapshot = {
      ...state,
      threads: [
        {
          id: "thread-1",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Existing Thread",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T08:00:00.000Z",
          runtimeId: "kimi",
          runtimeModelId: "kimi-k2.5",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
    };
    const workspaceSnapshot: WorkspaceSnapshot = {
      version: 1,
      projects: [
        {
          id: "project-1",
          name: "Carrent",
          path: "/code/carrent",
          threads: [
            {
              id: "thread-1",
              title: "Existing Thread",
              updatedAt: "2026-07-27T08:00:00.000Z",
              runtimeId: "kimi",
              runtimeModelId: "kimi-k2.5",
              runtimeMode: "approval-required",
              planMode: false,
            },
          ],
        },
      ],
      chats: [],
      messages: [],
      activeThreadId: "thread-1",
    };

    const saved = await renderApp(
      threadState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      true,
      requests,
      false,
      workspaceSnapshot,
    );
    await fillTextarea(container!.querySelector("textarea")!, "Do not dispatch this");
    await click(composerSendButton());

    expect(requests).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });
});
