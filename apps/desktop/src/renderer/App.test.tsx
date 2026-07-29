import { afterEach, describe, expect, it, mock } from "bun:test";

import "./test/registerHappyDom";

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MemoryRouter,
  useLocation,
  useNavigate,
  useNavigationType,
  type NavigateFunction,
  type NavigationType,
} from "react-router-dom";

import type {
  AppStateLoadResult,
  AppStateSnapshot,
  ProjectRelocationRequest,
} from "../shared/workspacePersistence";
import type {
  ChatRunEvent,
  ChatTurnRequest,
  DeleteThreadDataRequest,
  ThreadDeletionTransactionRequest,
  KimiSessionStatus,
} from "../shared/chat";
import type { ThreadActionRequest, ThreadActionResult } from "../shared/threadActions";

mock.module("./assets/logo.png", () => ({ default: "logo.png" }));
const { default: App } = await import("./App");

const emptyAppState: AppStateSnapshot = {
  version: 1,
  workspaces: [],
  projects: [],
  associations: [],
  threads: [],
  threadDrafts: [],
  threadMessages: [],
  threadRuns: [],
  threadPromotionIntents: [],
  lastThreadIdByWorkspace: {},
  activeWorkspaceId: null,
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let currentPathname = "";
let currentNavigationType: NavigationType | null = null;
let testNavigate: NavigateFunction | null = null;
let emitChatEvent: ((event: ChatRunEvent) => void) | null = null;
let emitMainWindowNavigation: ((path: string) => void) | null = null;

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
  deleteThreadDataRequests: DeleteThreadDataRequest[] = [],
  deleteThreadDataFails = false,
  appStateSaveGate?: Promise<void>,
  deleteThreadTransactionGate?: Promise<void>,
  projectDirectoryAvailable: boolean | boolean[] | (() => boolean) = true,
  projectRelocationRequests: ProjectRelocationRequest[] = [],
  kimiStatus: KimiSessionStatus | null | (() => KimiSessionStatus | null) = null,
  executeThreadAction?: (request: ThreadActionRequest) => Promise<ThreadActionResult>,
  sessionStatus:
    | KimiSessionStatus
    | null
    | ((
        request: ChatTurnRequest,
      ) => KimiSessionStatus | null | Promise<KimiSessionStatus | null>) = null,
) {
  let chatListener: ((event: import("../shared/chat").ChatRunEvent) => void) | null = null;
  let saveAttempt = 0;
  const loadedAppState = appState ?? emptyAppState;
  const saveAppState = async (snapshot: AppStateSnapshot) => {
    saveAttempt += 1;
    if (
      saveFails === true ||
      saveFails === saveAttempt ||
      (Array.isArray(saveFails) && saveFails.includes(saveAttempt))
    ) {
      throw new Error("disk full");
    }
    await appStateSaveGate;
    saved.push(structuredClone(snapshot));
  };
  window.carrent = {
    appState: {
      load: async () => ({ status: "ready", snapshot: loadedAppState }),
      reread: async () => ({ status: "ready", snapshot: loadedAppState }),
      fullReset: async () => ({
        status: "ready",
        snapshot: emptyAppState,
        notice: "full-reset",
      }),
      stage: () => {},
      save: saveAppState,
    },
    dialog: {
      openDirectory: async () => {
        const selected = selectedDirectories.shift();
        return selected
          ? { canceled: false, filePaths: [selected] }
          : { canceled: true, filePaths: [] };
      },
    },
    shell: {
      openPath: async () => "",
    },
    clipboard: {
      writeText: async () => {},
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
    projectDirectories: {
      check: async () => ({
        available:
          typeof projectDirectoryAvailable === "function"
            ? projectDirectoryAvailable()
            : Array.isArray(projectDirectoryAvailable)
              ? (projectDirectoryAvailable.shift() ?? true)
              : projectDirectoryAvailable,
      }),
      relocate: async (request: ProjectRelocationRequest) => {
        projectRelocationRequests.push(structuredClone(request));
        if (!appState) throw new Error("App State is unavailable");
        const relocatedAppState: AppStateSnapshot = {
          ...appState,
          projects: appState.projects.map((project) =>
            project.id === request.projectId
              ? { ...project, workingDirectory: request.targetDirectory }
              : project,
          ),
        };
        return { appState: relocatedAppState };
      },
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
      executeThreadAction,
      respondToPermission: async () => {},
      respondToQuestion: async () => {},
      getKimiStatus: async () => (typeof kimiStatus === "function" ? kimiStatus() : kimiStatus),
      getSessionStatus: async (request: ChatTurnRequest) =>
        typeof sessionStatus === "function" ? sessionStatus(request) : sessionStatus,
      onEvent: (listener: (event: import("../shared/chat").ChatRunEvent) => void) => {
        chatListener = listener;
        emitChatEvent = (event) => chatListener?.(event);
        return () => {
          if (chatListener === listener) chatListener = null;
        };
      },
      deleteThreadData: async (request: DeleteThreadDataRequest) => {
        deleteThreadDataRequests.push(structuredClone(request));
        if (deleteThreadDataFails) throw new Error("cleanup failed");
      },
      deleteThreadTransaction: async (request: ThreadDeletionTransactionRequest) => {
        deleteThreadDataRequests.push(structuredClone(request.threadData));
        if (deleteThreadDataFails) throw new Error("cleanup failed");
        await deleteThreadTransactionGate;
        await saveAppState(request.afterAppState);
      },
    },
    mainWindow: {
      onNavigate: (listener: (path: string) => void) => {
        emitMainWindowNavigation = listener;
        return () => {
          if (emitMainWindowNavigation === listener) emitMainWindowNavigation = null;
        };
      },
    },
  } as unknown as Window["carrent"];
}

async function mountInstalledBridge(initialEntry = "/", strictMode = false) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  await act(async () => {
    const app = (
      <MemoryRouter initialEntries={[initialEntry]}>
        <App />
        <NavigationProbe />
      </MemoryRouter>
    );
    root!.render(strictMode ? <StrictMode>{app}</StrictMode> : app);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function renderRecoveryApp(
  loadResults: AppStateLoadResult[],
  resetResult: AppStateLoadResult,
  clipboardWrites: string[],
  initialEntry = "/",
) {
  const saved: AppStateSnapshot[] = [];
  installBridge(null, saved);
  let current = loadResults.shift()!;
  window.carrent.appState = {
    load: async () => current,
    reread: async () => {
      current = loadResults.shift() ?? current;
      return current;
    },
    fullReset: async () => resetResult,
    stage: () => {},
    save: async (snapshot) => {
      saved.push(structuredClone(snapshot));
    },
  };
  window.carrent.clipboard.writeText = async (text) => {
    clipboardWrites.push(text);
  };
  await mountInstalledBridge(initialEntry);
}

type RenderAppOptions = {
  deleteThreadDataRequests?: DeleteThreadDataRequest[];
  deleteThreadDataFails?: boolean;
  appStateSaveGate?: Promise<void>;
  deleteThreadTransactionGate?: Promise<void>;
  projectDirectoryAvailable?: boolean | boolean[] | (() => boolean);
  projectRelocationRequests?: ProjectRelocationRequest[];
  strictMode?: boolean;
  kimiStatus?: KimiSessionStatus | null | (() => KimiSessionStatus | null);
  executeThreadAction?: (request: ThreadActionRequest) => Promise<ThreadActionResult>;
  sessionStatus?:
    | KimiSessionStatus
    | null
    | ((request: ChatTurnRequest) => KimiSessionStatus | null | Promise<KimiSessionStatus | null>);
};

async function renderApp(
  appState: AppStateSnapshot | null,
  initialEntry = "/",
  selectedDirectories: string[] = [],
  saveFails: boolean | number | number[] = false,
  chatRequests: ChatTurnRequest[] = [],
  chatSendFails = false,
  options: RenderAppOptions = {},
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
    options.deleteThreadDataRequests,
    options.deleteThreadDataFails,
    options.appStateSaveGate,
    options.deleteThreadTransactionGate,
    options.projectDirectoryAvailable,
    options.projectRelocationRequests,
    options.kimiStatus,
    options.executeThreadAction,
    options.sessionStatus,
  );
  await mountInstalledBridge(initialEntry, options.strictMode);

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

async function waitForProjectDraft() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  const textarea = container!.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) throw new Error("Project Draft Composer not found");
  return textarea;
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
  emitChatEvent = null;
  emitMainWindowNavigation = null;
});

describe("Workspace App State foundation", () => {
  const recoveryResult: AppStateLoadResult = {
    status: "recovery-required",
    diagnostics: [
      {
        appVersion: "0.0.0",
        subsystem: "app-state",
        stage: "validate",
        summary: "App State records or references are invalid.",
        dataPath: "/tmp/carrent/app-state.json",
        occurredAt: "2026-07-27T08:00:00.000Z",
      },
    ],
  };

  it("blocks the normal app and copies sanitized diagnostics for corrupt App State", async () => {
    const clipboardWrites: string[] = [];
    await renderRecoveryApp([recoveryResult], recoveryResult, clipboardWrites);

    expect(container!.textContent).toContain("Carrent data could not be loaded");
    expect(container!.textContent).toContain("Re-read");
    expect(container!.textContent).toContain("Copy diagnostics");
    expect(container!.textContent).toContain("Full reset");
    expect(container!.textContent).not.toContain("Create your first Workspace");
    expect(container!.querySelector("nav")).toBe(null);

    await click(buttonNamed("Copy diagnostics"));
    expect(clipboardWrites).toHaveLength(1);
    expect(clipboardWrites[0]).toContain('"stage": "validate"');
    expect(clipboardWrites[0]).not.toContain("workspaces");
    expect(clipboardWrites[0]).not.toContain("messages");
  });

  it("re-reads App State and restores the saved route with replacement", async () => {
    const ready: AppStateLoadResult = {
      status: "ready",
      snapshot: {
        ...emptyAppState,
        workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
        activeWorkspaceId: "workspace-1",
      },
    };
    await renderRecoveryApp([recoveryResult, ready], recoveryResult, []);

    await click(buttonNamed("Re-read"));

    expect(container!.textContent).toContain("Personal");
    expect(currentPathname).toBe("/workspace/workspace-1");
    expect(currentNavigationType).toBe("REPLACE");
  });

  it("requires confirmation before a full reset and returns to first use", async () => {
    const resetResult: AppStateLoadResult = {
      status: "ready",
      snapshot: emptyAppState,
      notice: "full-reset",
    };
    await renderRecoveryApp([recoveryResult], resetResult, []);

    await click(buttonNamed("Full reset"));
    const dialog = container!.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Project Working Directories");
    expect(dialog.textContent).toContain("project files");
    expect(dialog.textContent).toContain("Git state");
    expect(dialog.textContent).toContain("legacy projectless chat data");
    expect(container!.textContent).not.toContain("Create your first Workspace");

    await click(buttonNamed("Permanently reset Carrent data"));
    expect(container!.textContent).toContain("Create your first Workspace");
    expect(container!.textContent).toContain("Carrent data was reset.");
  });

  it("stays blocked and shows the appended diagnostic when Full Reset fails", async () => {
    const resetFailure: AppStateLoadResult = {
      status: "recovery-required",
      diagnostics: [
        ...recoveryResult.diagnostics,
        {
          appVersion: "0.0.0",
          subsystem: "app-state",
          stage: "reset-write",
          summary: "Full Reset failed: disk full.",
          dataPath: "/tmp/carrent/app-state.json",
          occurredAt: "2026-07-27T08:01:00.000Z",
        },
      ],
    };
    await renderRecoveryApp([recoveryResult], resetFailure, []);

    await click(buttonNamed("Full reset"));
    await click(buttonNamed("Permanently reset Carrent data"));

    expect(container!.querySelector('[role="dialog"]')).toBe(null);
    expect(container!.textContent).toContain("Carrent data could not be loaded");
    expect(container!.textContent).toContain("Full Reset failed: disk full.");
    expect(container!.textContent).not.toContain("Create your first Workspace");
    expect(container!.querySelector("nav")).toBe(null);
  });

  it("creates the first Workspace from the global first-use state", async () => {
    const saved = await renderApp(null, "/", [], false, [], false, { strictMode: true });

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
    expect(currentPathname).toBe(`/workspace/${saved[0].workspaces[0].id}`);
    expect(container!.textContent).not.toContain("Workspace could not be found.");
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
      ["/tmp/research-project"],
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

    await click(buttonNamed("Select Workspace"));
    const workspaceMenu = container!.querySelector('[role="menu"][aria-label="Workspaces"]')!;
    expect(workspaceMenu.textContent).toContain("Home");
    expect(workspaceMenu.textContent).toContain("Client");
    expect(workspaceMenu.textContent).toContain("Add Workspace...");
    await click(workspaceMenu.querySelector<HTMLButtonElement>('button[aria-label="Client"]')!);
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-2");
    expect(container!.querySelector("h1")?.textContent).toBe("Client");

    const saveCount = saved.length;
    await click(buttonNamed("Client"));
    expect(saved).toHaveLength(saveCount);

    await click(buttonNamed("Select Workspace"));
    await click(buttonNamed("Add Workspace..."));
    const createWorkspaceDialog = container!.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Create Workspace"]',
    )!;
    await click(
      createWorkspaceDialog.querySelector<HTMLButtonElement>('button[aria-label="Add Project"]')!,
    );
    expect(createWorkspaceDialog.textContent).toContain("research-project");
    const createInput = container!.querySelector<HTMLInputElement>('input[name="workspaceName"]')!;
    await fillInput(createInput, "Research");
    await click(buttonNamed("Create"));

    expect(saved.at(-1)?.workspaces.at(-1)).toEqual({
      id: saved.at(-1)!.activeWorkspaceId,
      name: "Research",
      order: 2,
    });
    expect(saved.at(-1)?.projects).toEqual([
      {
        id: saved.at(-1)!.projects[0].id,
        name: "research-project",
        workingDirectory: "/tmp/research-project",
      },
    ]);
    expect(saved.at(-1)?.associations).toEqual([
      {
        workspaceId: saved.at(-1)!.activeWorkspaceId,
        projectId: saved.at(-1)!.projects[0].id,
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
    ]);
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

  it("restores the active Workspace's last valid Thread on startup", async () => {
    await renderApp(navigationState());

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.textContent).toContain("Personal Thread");
  });

  it("flushes pending Thread content before the Main Window closes", async () => {
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
    );

    await fillTextarea(container!.querySelector("textarea")!, "Save before closing");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
      window.dispatchEvent(new window.Event("beforeunload"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(saved.at(-1)?.threadWork?.["thread-1"]?.draft?.content).toBe("Save before closing");
  });

  it("preserves newer Thread content while a navigation save is pending", async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      { appStateSaveGate: saveGate },
    );

    await act(async () => {
      testNavigate!("/workspace/workspace-2/project/project-1/thread/thread-2");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await fillTextarea(container!.querySelector("textarea")!, "Keep the newer draft");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    releaseSave();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    expect(saved.at(-1)?.threadWork?.["thread-2"]?.draft?.content).toBe("Keep the newer draft");
  });

  it("restores each Workspace's last valid Thread and keeps repeated selection a no-op", async () => {
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    await click(buttonNamed("Client"));
    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1/thread/thread-2");
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-2");

    const saveCount = saved.length;
    await click(buttonNamed("Client"));
    expect(saved).toHaveLength(saveCount);
    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1/thread/thread-2");
  });

  it("groups Threads by Project and toggles the Project's Thread List", async () => {
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    const navigationPane = container!.querySelector("aside.border-r")!;
    expect(navigationPane.className).toContain("rounded-xl");
    expect(navigationPane.textContent).toContain("Personal Carrent");
    expect(navigationPane.textContent).toContain("Personal Thread");
    expect(navigationPane.textContent).not.toContain("Client Thread");
    expect(navigationPane.querySelector('[aria-label="New thread in Personal Carrent"]')).not.toBe(
      null,
    );
    expect(navigationPane.querySelector('[aria-label="Search Personal Carrent"]')).toBe(null);
    const projectActionLabels = [...navigationPane.querySelectorAll("button")].map((button) =>
      button.getAttribute("aria-label"),
    );
    expect(projectActionLabels.indexOf("More actions for Personal Carrent")).toBeLessThan(
      projectActionLabels.indexOf("New thread in Personal Carrent"),
    );
    expect(navigationPane.querySelector('[aria-label="Move Personal Carrent up"]')).toBe(null);
    expect(container!.textContent).toContain("Personal / Personal Carrent / Personal Thread");

    await click(buttonNamed("Collapse Personal Carrent"));
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(navigationPane.textContent).not.toContain("Personal Thread");
    expect(container!.textContent).not.toContain("Shared Project name");

    await click(buttonNamed("Expand Personal Carrent"));
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(navigationPane.textContent).toContain("Personal Thread");

    await click(buttonNamed("More actions for Personal Carrent"));
    const projectMenu = document.querySelector<HTMLElement>(
      '[role="menu"][aria-label="Actions for Personal Carrent"]',
    )!;
    expect(
      [...projectMenu.querySelectorAll('[role="menuitem"]')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["Open in Finder", "Rename project", "Copy path", "Delete"]);

    const openedPaths: string[] = [];
    window.carrent.shell.openPath = async (path) => {
      openedPaths.push(path);
      return "";
    };
    await click(buttonNamed("Open in Finder"));
    expect(openedPaths).toEqual(["/code/carrent"]);

    const copiedPaths: string[] = [];
    window.carrent.clipboard.writeText = async (path) => {
      copiedPaths.push(path);
    };
    await click(buttonNamed("More actions for Personal Carrent"));
    await click(buttonNamed("Copy path"));
    expect(copiedPaths).toEqual(["/code/carrent"]);

    await click(buttonNamed("More actions for Personal Carrent"));
    await click(buttonNamed("Rename project"));
    const renameProjectInput = container!.querySelector<HTMLInputElement>(
      'input[aria-label="Rename project Personal Carrent"]',
    )!;
    await fillInput(renameProjectInput, "Renamed Carrent");
    await act(async () => {
      renameProjectInput.blur();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(saved.at(-1)?.associations[0].alias).toBe("Renamed Carrent");
    expect(navigationPane.textContent).toContain("Renamed Carrent");
  });

  it("deletes a Project from its actions menu", async () => {
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
    );
    window.confirm = () => true;

    await click(buttonNamed("More actions for Personal Carrent"));
    await click(buttonNamed("Delete"));

    expect(
      saved.at(-1)?.associations.map(({ workspaceId, projectId }) => ({
        workspaceId,
        projectId,
      })),
    ).toEqual([{ workspaceId: "workspace-2", projectId: "project-1" }]);
    expect(saved.at(-1)?.threads?.some((thread) => thread.id === "thread-1")).toBe(false);
    expect(currentPathname).toBe("/workspace/workspace-1");
  });

  it("opens a Project Thread Draft from the restored middle pane action", async () => {
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
    );

    await click(buttonNamed("New thread in Personal Carrent"));

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
    expect(saved.at(-1)?.threadDrafts?.[0]).toMatchObject({
      workspaceId: "workspace-1",
      projectId: "project-1",
    });
    expect(container!.querySelector("h1")?.textContent).toBe("New thread");
    const prompt = container!.querySelector<HTMLElement>("[data-empty-thread-prompt]")!;
    expect(prompt.textContent).toBe("What should we build in Personal Carrent?");
    expect(prompt.querySelector(".text-muted")?.textContent).toBe("What should we build");
    expect(prompt.querySelector(".text-fg")?.textContent).toBe("Personal Carrent");
    expect(container!.textContent).not.toContain("Thread Draft");
  });

  it("keeps and renames Threads in persisted order", async () => {
    const state = navigationState();
    state.threads!.push({
      id: "thread-3",
      workspaceId: "workspace-1",
      projectId: "project-1",
      title: "Recent Thread",
      createdAt: "2026-07-27T10:00:00.000Z",
      lastActivityAt: "2026-07-27T10:00:00.000Z",
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    });
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );
    const navigationPane = container!.querySelector("aside.border-r")!;

    expect(navigationPane.textContent!.indexOf("Personal Thread")).toBeLessThan(
      navigationPane.textContent!.indexOf("Recent Thread"),
    );
    expect(buttonNamed("Archive Personal Thread")).not.toBe(null);

    await click(buttonNamed("Pin Personal Thread"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.pinned).toBe(true);

    await click(buttonNamed("Rename Personal Thread"));
    const renameInput = container!.querySelector<HTMLInputElement>(
      'input[aria-label="Rename Personal Thread"]',
    )!;
    await fillInput(renameInput, "Renamed Work");
    await act(async () => {
      renameInput.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")).toMatchObject({
      title: "Renamed Work",
    });
    expect(buttonNamed("Unpin Renamed Work")).not.toBe(null);
  });

  it("does not change Thread Activity Time for question requests", async () => {
    const requests: ChatTurnRequest[] = [];
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
      false,
    );

    await fillTextarea(container!.querySelector("textarea")!, "Track meaningful activity");
    await click(composerSendButton());
    const activityAfterSubmit = saved
      .at(-1)
      ?.threads?.find((thread) => thread.id === "thread-1")?.lastActivityAt;

    await act(async () => {
      emitChatEvent!({
        type: "question-requested",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
        question: {
          id: "question-activity",
          runId: requests[0].runId!,
          requestKey: requests[0].requestKey,
          threadId: "thread-1",
          provider: "kimi",
          source: "native-acp",
          questions: [
            {
              header: "Choice",
              question: "Continue?",
              options: [{ optionId: "yes", label: "Yes" }],
              multiSelect: false,
            },
          ],
          createdAt: "2099-01-01T00:00:00.000Z",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.lastActivityAt).toBe(
      activityAfterSubmit,
    );

    await act(async () => {
      emitChatEvent!({
        type: "permission-requested",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
        permission: {
          id: "permission-activity",
          runId: requests[0].runId!,
          requestKey: requests[0].requestKey,
          threadId: "thread-1",
          provider: "kimi",
          action: "edit",
          title: "Edit file",
          options: [],
          createdAt: "2099-01-02T00:00:00.000Z",
          expiresAt: "2099-01-02T00:01:00.000Z",
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.lastActivityAt).toBe(
      "2099-01-02T00:00:00.000Z",
    );

    await act(async () => {
      emitChatEvent!({
        type: "stopped",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("keeps Settings in the Main Window and returns to the entry location", async () => {
    const entryPath = "/workspace/workspace-1/project/project-1/thread/thread-1";
    await renderApp(navigationState(), entryPath, [], false, [], false);

    await click(buttonNamed("Settings"));
    expect(currentPathname).toBe("/settings");
    expect(container!.querySelector('nav[aria-label="Settings tabs"]')).not.toBe(null);
    expect(buttonNamed("Personal")).not.toBe(null);

    await click(buttonNamed("Settings"));
    expect(currentPathname).toBe(entryPath);
  });

  it("navigates the existing Main Window from deep links and falls back invalid ownership", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    await act(async () => {
      emitMainWindowNavigation?.("/workspace/workspace-2/project/project-1/thread/thread-2");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1/thread/thread-2");

    await act(async () => {
      emitMainWindowNavigation?.("/workspace/workspace-1/project/project-1/thread/thread-2");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
    expect(container!.textContent).toContain("Thread could not be found.");
  });

  it("opens global Thread search with Cmd/Ctrl+K and shows recent Threads across Workspaces", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, key: "k", metaKey: true }),
      );
    });

    const dialog = container!.ownerDocument.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Search Threads"]',
    );
    expect(dialog).not.toBe(null);
    expect(dialog!.textContent).toContain("Global");
    expect(dialog!.textContent).toContain("Personal / Personal Carrent / Personal Thread");
    expect(dialog!.textContent).toContain("Client / Client Carrent / Client Thread");
    expect(dialog!.textContent!.indexOf("Client Thread")).toBeLessThan(
      dialog!.textContent!.indexOf("Personal Thread"),
    );
  });

  it("opens Workspace search and keeps a selected Project scope in empty results", async () => {
    const state = navigationState();
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
    state.threads!.push({
      id: "thread-3",
      workspaceId: "workspace-1",
      projectId: "project-2",
      title: "Website Thread",
      createdAt: "2026-07-27T10:00:00.000Z",
      lastActivityAt: "2026-07-27T10:00:00.000Z",
      runtimeId: "kimi",
      runtimeMode: "approval-required",
      planMode: false,
    });

    await renderApp(
      state,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    await click(buttonNamed("Search Personal"));
    let dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Search Threads"]',
    )!;
    expect(dialog.textContent).toContain("Scope: Personal");
    expect(dialog.textContent).toContain("Personal / Personal Carrent / Personal Thread");
    expect(dialog.textContent).toContain("Personal / Website / Website Thread");
    expect(dialog.textContent).not.toContain("Client Thread");

    const projectScopeButton = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Project",
    )!;
    await click(projectScopeButton);
    dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Search Threads"]')!;
    expect(dialog.textContent).toContain("Scope: Personal / Personal Carrent");
    expect(dialog.textContent).not.toContain("Website Thread");

    await fillInput(
      dialog.querySelector<HTMLInputElement>('input[aria-label="Search Thread titles"]')!,
      "missing",
    );
    expect(dialog.textContent).toContain("No matching Threads");
    expect(dialog.textContent).toContain("Scope: Personal / Personal Carrent");
  });

  it("navigates to another search result but selecting the current Thread only closes search", async () => {
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, key: "k", ctrlKey: true }),
      );
    });
    let dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Search Threads"]',
    )!;
    const clientResult = [...dialog.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (button) => button.textContent?.includes("Client Thread"),
    )!;
    await click(clientResult);

    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1/thread/thread-2");
    expect(currentNavigationType).toBe("PUSH");
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-2");
    expect(document.querySelector('[role="dialog"][aria-label="Search Threads"]')).toBe(null);

    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, key: "k", metaKey: true }),
      );
    });
    dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Search Threads"]')!;
    const currentResult = [...dialog.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(
      (button) => button.textContent?.includes("Client Thread"),
    )!;
    const navigationTypeBeforeSelection = currentNavigationType;
    await click(currentResult);

    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1/thread/thread-2");
    expect(currentNavigationType).toBe(navigationTypeBeforeSelection);
    expect(document.querySelector('[role="dialog"][aria-label="Search Threads"]')).toBe(null);
  });

  it("switches from global search to an Association scope outside a Project route", async () => {
    await renderApp(navigationState(), "/settings", [], false, [], false);

    await act(async () => {
      window.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, key: "k", metaKey: true }),
      );
    });
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Search Threads"]',
    )!;
    const projectScopeButton = [...dialog.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === "Project",
    )!;

    expect(projectScopeButton.disabled).toBe(false);
    await click(projectScopeButton);
    expect(dialog.textContent).toContain("Scope: Personal / Personal Carrent");
  });

  it("falls back to the Workspace overview when the saved Thread reference is stale", async () => {
    const state = navigationState();
    state.lastThreadIdByWorkspace = { "workspace-1": "missing-thread" };

    await renderApp(state);

    expect(currentPathname).toBe("/workspace/workspace-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.querySelector("h1")?.textContent).toBe("Personal");
    expect(container!.textContent).not.toContain("Carrent data could not be loaded");
  });

  it("replaces a missing Thread with its Project overview and one dismissible notice", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/missing-thread",
      [],
      false,
      [],
      false,
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

  it("persists interrupted restart state without discarding produced history", async () => {
    const state = navigationState();
    state.threadMessages = [
      {
        id: "assistant-running",
        role: "assistant",
        threadId: "thread-1",
        createdAt: "2026-07-27T10:00:00.000Z",
        content: "Partial answer",
        attachments: [],
        runStatus: "running",
        parts: [
          { type: "text", content: "Partial answer" },
          {
            type: "reasoning",
            id: "reasoning-1",
            content: "Checking lifecycle",
            status: "running",
          },
          {
            type: "question",
            id: "question-part-1",
            questionId: "question-1",
            status: "pending",
            questions: [{ header: "Scope", question: "Continue?" }],
          },
          {
            type: "subagent_task",
            id: "task-1",
            runtimeId: "kimi",
            source: "agent",
            description: "Inspect lifecycle",
            background: false,
            status: "running",
            startedAt: 100,
          },
        ],
      },
    ];
    const saved = await renderApp(state, "/", [], false, [], false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 550));
    });

    expect(saved.at(-1)?.threadMessages?.[0]).toMatchObject({
      content: "Partial answer",
      runStatus: "cancelled",
      parts: [
        { type: "text", content: "Partial answer" },
        { type: "reasoning", status: "cancelled" },
        { type: "question", status: "interrupted" },
        { type: "subagent_task", status: "interrupted" },
      ],
    });
  });

  it("replaces a three-level route with extra path segments", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1/extra",
      [],
      false,
      [],
      false,
    );

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.textContent).toContain("Thread could not be found.");
  });

  it("preserves the fixed rail and session-only middle pane controls", async () => {
    await renderApp(navigationState(), "/workspace/workspace-1");

    const navigationPane = container!.querySelector("aside.border-r")!;
    const middlePane = navigationPane.parentElement as HTMLDivElement;
    const rightContent = middlePane.parentElement!.parentElement as HTMLDivElement;
    const desktopHeader = container!.querySelector("header")!;
    const workspaceRail = container!.querySelector<HTMLDivElement>('div[style*="width: 58px"]');
    expect(workspaceRail).not.toBe(null);
    expect(
      desktopHeader.classList.contains("h-[calc(env(titlebar-area-height,38px)+0.375rem)]"),
    ).toBe(true);
    expect(rightContent.classList.contains("p-1.5")).toBe(false);
    expect(middlePane.style.width).toBe("280px");
    const addProjectButton = buttonNamed("Add Project");
    const collapseSidebarButton = buttonNamed("Collapse sidebar");
    const searchWorkspaceButton = buttonNamed("Search Personal");
    const workspaceSelect = buttonNamed("Select Workspace");
    expect(addProjectButton.querySelector(".lucide-plus")).not.toBe(null);
    expect(navigationPane.contains(addProjectButton)).toBe(true);
    expect(navigationPane.contains(searchWorkspaceButton)).toBe(false);
    expect(
      collapseSidebarButton.compareDocumentPosition(searchWorkspaceButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      searchWorkspaceButton.compareDocumentPosition(workspaceSelect) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);

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

  it("adds a new Project and Association atomically, then opens New Thread", async () => {
    const saved = await renderApp(emptyWorkspaceState, "/workspace/workspace-1", ["/code/carrent"]);

    expect(container!.textContent).toContain(
      "Carrent never moves or copies the selected directory.",
    );
    await click(buttonNamed("Add Project"));
    await waitForProjectDraft();

    expect(saved.length).toBeGreaterThan(1);
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
    expect(container!.querySelector("h1")?.textContent).toBe("New thread");
    expect(container!.querySelector("[data-empty-thread-prompt]")?.textContent).toBe(
      "What should we build in carrent?",
    );
    expect(saved.at(-1)?.threadDrafts).toHaveLength(1);
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
    await waitForProjectDraft();
    expect(saved[0].projects).toEqual(state.projects);
    expect(saved[0].associations).toHaveLength(2);
    expect(saved[0].associations[1]).toMatchObject({
      workspaceId: "workspace-2",
      projectId: "project-1",
      order: 0,
    });
    const saveCount = saved.length;

    await click(buttonNamed("Add Project"));
    expect(saved).toHaveLength(saveCount);
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

  it("does not expose Project sorting controls", async () => {
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
    await renderApp(state, "/workspace/workspace-1");

    expect(container!.querySelector('[aria-label="Move Website up"]')).toBe(null);
    expect(container!.querySelector('[aria-label="Move Personal Carrent down"]')).toBe(null);
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

    await waitForProjectDraft();

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

    await waitForProjectDraft();

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

    await waitForProjectDraft();
    await fillTextarea(container!.querySelector("textarea")!, "Implement association drafts");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    const sendButton = composerSendButton();
    expect(sendButton.disabled).toBe(false);
    await click(sendButton);

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      context: {
        kind: "project",
        workspaceId: "workspace-1",
        projectId: "project-1",
        workingDirectory: "/code/carrent",
      },
      runtimeId: "kimi",
      runtimeModelId: "kimi-k2.5",
      runtimeMode: "approval-required",
      message: "Implement association drafts",
    });
    expect("draftRef" in requests[0]).toBe(false);
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
    expect(saved.at(-1)?.threadMessages?.[1]).toMatchObject({
      threadId: requests[0].threadId,
      role: "assistant",
      attachments: [],
    });
    expect(saved.at(-1)?.threadRuns?.[0]).toMatchObject({
      id: requests[0].runId,
      threadId: requests[0].threadId,
      runtimeId: "kimi",
      runtimeModelId: "kimi-k2.5",
      runtimeMode: "approval-required",
    });
  });

  it("atomically persists the promoted Thread before the first Runtime dispatch", async () => {
    const requests: ChatTurnRequest[] = [];
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1",
      [],
      false,
      requests,
    );
    let appStateAtDispatch: AppStateSnapshot | undefined;
    const send = window.carrent.chat.send;
    window.carrent.chat.send = async (request) => {
      appStateAtDispatch = structuredClone(saved.at(-1));
      return send(request);
    };

    await waitForProjectDraft();
    await fillTextarea(container!.querySelector("textarea")!, "Persist before dispatch");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });
    await click(composerSendButton());

    expect(requests).toHaveLength(1);
    expect(appStateAtDispatch?.threadDrafts).toEqual([]);
    expect(appStateAtDispatch?.threads?.[0]).toMatchObject({
      id: requests[0].threadId,
      workspaceId: "workspace-1",
      projectId: "project-1",
    });
    expect(appStateAtDispatch?.threadMessages?.[0]).toMatchObject({
      threadId: requests[0].threadId,
      role: "user",
      content: "Persist before dispatch",
    });
    expect(appStateAtDispatch?.threadRuns?.[0]).toMatchObject({
      id: requests[0].runId,
      threadId: requests[0].threadId,
      messageId: appStateAtDispatch?.threadMessages?.[0].id,
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

    await waitForProjectDraft();
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

  it("keeps the Draft retryable when dispatch rejection rollback initially fails", async () => {
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1",
      [],
      [3],
      [],
      true,
    );

    await waitForProjectDraft();
    await fillTextarea(container!.querySelector("textarea")!, "Retry after cleanup failure");
    await click(composerSendButton());
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
      4,
      requests,
    );

    await waitForProjectDraft();
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
    const saved = await renderApp(
      threadState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      true,
      requests,
      false,
    );
    await fillTextarea(container!.querySelector("textarea")!, "Do not dispatch this");
    await click(composerSendButton());

    expect(requests).toHaveLength(0);
    expect(saved).toHaveLength(0);
  });
});

describe("Compact Thread Action", () => {
  const compactAppState: AppStateSnapshot = {
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
        title: "Compact me",
        createdAt: "2026-07-27T08:00:00.000Z",
        lastActivityAt: "2026-07-27T08:01:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadMessages: [
      {
        id: "message-1",
        threadId: "thread-1",
        role: "user",
        content: "Finish the work",
        createdAt: "2026-07-27T08:00:00.000Z",
        attachments: [],
      },
      {
        id: "message-2",
        threadId: "thread-1",
        role: "assistant",
        content: "Done",
        createdAt: "2026-07-27T08:01:00.000Z",
        runStatus: "completed",
        attachments: [],
      },
    ],
    threadRuns: [
      {
        id: "run-1",
        threadId: "thread-1",
        messageId: "message-1",
        startedAt: "2026-07-27T08:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    activeWorkspaceId: "workspace-1",
  };

  it("runs from the slash menu without a Run and persists the owning Thread boundary", async () => {
    const requests: ChatTurnRequest[] = [];
    const actionRequests: ThreadActionRequest[] = [];
    let finishCompact!: () => void;
    const compactGate = new Promise<void>((resolve) => {
      finishCompact = resolve;
    });
    const saved = await renderApp(
      compactAppState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
      false,
      {
        kimiStatus: {
          sessionId: "session-compact",
          used: 34,
          total: 100,
          percentage: 34,
          threadActions: ["compact"],
          supportedCommands: ["compact"],
        },
        executeThreadAction: async (request) => {
          actionRequests.push(structuredClone(request));
          await compactGate;
          return { ...request, completedAt: "2026-07-27T08:02:00.000Z" };
        },
      },
    );
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    await fillTextarea(textarea, "/");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const menuButtons = [...container!.querySelectorAll<HTMLButtonElement>("button")].filter(
      (button) =>
        button.textContent?.includes("Enable plan mode") ||
        button.textContent?.includes("34% used"),
    );
    expect(menuButtons.map((button) => button.textContent?.trim())).toEqual([
      "Plan modeEnable plan mode",
      "CompactCompress this thread's context (34% used)",
    ]);
    expect(menuButtons.every((button) => button.querySelector("svg") === null)).toBe(true);

    await act(async () => {
      menuButtons[1]!.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(actionRequests).toEqual([
      {
        action: "compact",
        threadId: "thread-1",
        runtimeId: "kimi",
        workingDirectory: "/code/carrent",
      },
    ]);
    expect(requests).toEqual([]);
    expect(container!.textContent).toContain("Compacting");
    expect(composerSendButton().disabled).toBe(true);
    expect(textarea.value).toBe("");

    await fillTextarea(textarea, "/compact Keep this draft");
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(textarea.value).toBe("Keep this draft");
    expect(actionRequests).toHaveLength(1);
    expect(container!.textContent).toContain("already compacting");

    await fillTextarea(textarea, "Next request");

    await act(async () => {
      finishCompact();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container!.textContent).toContain("Context compacted");
    expect(textarea.value).toBe("Next request");
    expect(saved.at(-1)?.threadActions?.[0]).toMatchObject({
      threadId: "thread-1",
      action: "compact",
      runtimeId: "kimi",
      completedAt: "2026-07-27T08:02:00.000Z",
    });
    expect(saved.at(-1)?.threadActions?.[0]?.id.startsWith("thread-action-")).toBe(true);
    expect(saved.at(-1)?.threads?.[0]?.lastActivityAt).toBe("2026-07-27T08:02:00.000Z");

    await fillTextarea(textarea, "/compact Keep this draft");
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(textarea.value).toBe("Keep this draft");
    expect(actionRequests).toHaveLength(1);
    expect(requests).toEqual([]);
    expect(container!.textContent).toContain("requires a completed user and Agent exchange");

    await fillTextarea(textarea, "/");
    expect(
      [...container!.querySelectorAll<HTMLButtonElement>("button")].some((button) =>
        button.textContent?.includes("Compress this thread's context"),
      ),
    ).toBe(false);
  });

  it("clears Compact availability after the Runtime Session becomes invalid", async () => {
    const actionRequests: ThreadActionRequest[] = [];
    let sessionAvailable = true;
    await renderApp(
      compactAppState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      {
        kimiStatus: () =>
          sessionAvailable
            ? {
                sessionId: "session-compact",
                used: 34,
                total: 100,
                percentage: 34,
                threadActions: ["compact"],
                supportedCommands: ["compact"],
              }
            : null,
        executeThreadAction: async (request) => {
          actionRequests.push(structuredClone(request));
          sessionAvailable = false;
          throw new Error("Kimi Code could not resume the Runtime Session.");
        },
      },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    await fillTextarea(textarea, "/compact Keep this draft");
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(textarea.value).toBe("Keep this draft");
    expect(actionRequests).toHaveLength(1);

    await fillTextarea(textarea, "/compact Try again");
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(textarea.value).toBe("Try again");
    expect(actionRequests).toHaveLength(1);
    expect(container!.textContent).toContain("requires a resumable Runtime Session");
  });

  it("blocks repeated Compact after Runtime success when boundary persistence fails", async () => {
    const actionRequests: ThreadActionRequest[] = [];
    const saved = await renderApp(
      compactAppState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      true,
      [],
      false,
      {
        kimiStatus: {
          sessionId: "session-compact",
          used: 34,
          total: 100,
          percentage: 34,
          threadActions: ["compact"],
          supportedCommands: ["compact"],
        },
        executeThreadAction: async (request) => {
          actionRequests.push(structuredClone(request));
          return { ...request, completedAt: "2026-07-27T08:02:00.000Z" };
        },
      },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    await fillTextarea(textarea, "/compact Keep this draft");
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(textarea.value).toBe("Keep this draft");
    expect(actionRequests).toHaveLength(1);
    expect(saved).toHaveLength(0);
    expect(container!.textContent).toContain("history boundary could not be saved");

    await fillTextarea(textarea, "/compact Try again");
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(textarea.value).toBe("Try again");
    expect(actionRequests).toHaveLength(1);
    expect(container!.textContent).toContain("requires a completed user and Agent exchange");
  });
});

describe("Runtime Session Status", () => {
  const statusAppState: AppStateSnapshot = {
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
        title: "Inspect status",
        createdAt: "2026-07-27T08:00:00.000Z",
        lastActivityAt: "2026-07-27T08:01:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    threadMessages: [
      {
        id: "message-1",
        threadId: "thread-1",
        role: "user",
        content: "Finish the work",
        createdAt: "2026-07-27T08:00:00.000Z",
        attachments: [],
      },
      {
        id: "message-2",
        threadId: "thread-1",
        role: "assistant",
        content: "Done",
        createdAt: "2026-07-27T08:01:00.000Z",
        runStatus: "completed",
        attachments: [],
      },
    ],
    threadRuns: [
      {
        id: "run-1",
        threadId: "thread-1",
        messageId: "message-1",
        startedAt: "2026-07-27T08:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    activeWorkspaceId: "workspace-1",
  };
  const passiveStatus: KimiSessionStatus = {
    sessionId: "session-1234567890",
    used: 35193,
    total: 1048576,
    percentage: 3.4,
    threadActions: ["compact"],
    supportedCommands: ["compact", "status"],
  };

  async function submitTextarea(textarea: HTMLTextAreaElement) {
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }

  it("executes Status from the slash menu and renders normalized values without a Run", async () => {
    const chatRequests: ChatTurnRequest[] = [];
    const statusRequests: ChatTurnRequest[] = [];
    await renderApp(
      statusAppState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      chatRequests,
      false,
      {
        kimiStatus: passiveStatus,
        sessionStatus: async (request) => {
          statusRequests.push(structuredClone(request));
          return {
            ...passiveStatus,
            planUsage: {
              weekly: { usedPercentage: 24.5, reset: "in 3d 8h" },
              fiveHour: { reset: "at 14:30" },
            },
          };
        },
      },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const usageIndicator = container!.querySelector<HTMLElement>('[title="Kimi context usage"]')!;
    usageIndicator.click();
    expect(statusRequests).toHaveLength(0);

    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;
    await fillTextarea(textarea, "Keep this /st");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      [...container!.querySelectorAll<HTMLButtonElement>("button")].some((button) =>
        button.textContent?.startsWith("Status"),
      ),
    ).toBe(false);

    await fillTextarea(textarea, "/");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const commandLabels = [...container!.querySelectorAll<HTMLButtonElement>("button")]
      .map((button) => button.textContent?.trim() ?? "")
      .filter(
        (label) =>
          label.startsWith("Plan mode") ||
          label.startsWith("Compact") ||
          label.startsWith("Status"),
      );
    expect(commandLabels).toEqual([
      "Plan modeEnable plan mode",
      "CompactCompress this thread's context (3% used)",
      "StatusInspect this Runtime Session",
    ]);

    const statusButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.startsWith("Status"),
    )!;
    await act(async () => {
      statusButton.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(statusRequests).toHaveLength(1);
    expect(statusRequests[0]).toMatchObject({
      threadId: "thread-1",
      runtimeId: "kimi",
      message: "",
      transcript: [],
    });
    expect(chatRequests).toEqual([]);
    expect(textarea.value).toBe("");
    expect(container!.textContent).toContain("Status");
    expect(container!.textContent).toContain("Session");
    expect(container!.textContent).toContain("session-1234567890");
    expect(container!.textContent).toContain("Remaining 96.6% (35,193 used / 1M total)");
    expect(container!.textContent).toContain("Plan usage");
    expect(container!.textContent).toContain("Weekly");
    expect(container!.textContent).toContain("Used 24.5% · Remaining 75.5% · Resets in 3d 8h");
    expect(container!.textContent).toContain("5h");
    expect(container!.textContent).toContain("5hResets at 14:30");
    expect(container!.querySelector('[role="dialog"]')).toBe(null);
    expect(buttonNamed("Close")).toBeDefined();
    expect(
      [...container!.querySelectorAll<HTMLButtonElement>("button")].some((button) =>
        button.textContent?.includes("Copy"),
      ),
    ).toBe(false);
  });

  it("preserves an open snapshot and draft when an explicit refresh fails", async () => {
    let statusCall = 0;
    let rejectRefresh!: (error: Error) => void;
    const refreshGate = new Promise<KimiSessionStatus | null>((_resolve, reject) => {
      rejectRefresh = reject;
    });
    await renderApp(
      statusAppState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      {
        kimiStatus: passiveStatus,
        sessionStatus: async () => {
          statusCall += 1;
          if (statusCall === 1) return passiveStatus;
          if (statusCall === 2) return refreshGate;
          return { ...passiveStatus, used: 40000, percentage: 4 };
        },
      },
    );
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;

    await fillTextarea(textarea, "/status");
    await submitTextarea(textarea);
    expect(container!.textContent).toContain("35,193 used");

    await fillTextarea(textarea, "/status Keep this draft");
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(statusCall).toBe(2);
    expect(textarea.value).toBe("Keep this draft");
    expect(container!.textContent).toContain("35,193 used");
    expect(composerSendButton().disabled).toBe(true);
    expect(container!.querySelector('[aria-busy="true"]')).not.toBe(null);

    rejectRefresh(new Error("transport failed"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container!.textContent).toContain("35,193 used");
    expect(container!.textContent).toContain("Unable to load session status.");
    expect(textarea.value).toBe("Keep this draft");
    expect(composerSendButton().disabled).toBe(false);

    await fillTextarea(textarea, "/status");
    await submitTextarea(textarea);
    expect(statusCall).toBe(3);
    expect(container!.textContent).toContain("40,000 used");
    expect(container!.textContent).not.toContain("Unable to load session status.");
  });

  it("intercepts unavailable manual Status but preserves normal word-boundary sending", async () => {
    const chatRequests: ChatTurnRequest[] = [];
    let statusCalls = 0;
    await renderApp(
      statusAppState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      chatRequests,
      false,
      {
        kimiStatus: null,
        sessionStatus: async () => {
          statusCalls += 1;
          return null;
        },
      },
    );
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;

    await fillTextarea(textarea, "/status Keep this draft");
    await submitTextarea(textarea);
    expect(textarea.value).toBe("Keep this draft");
    expect(container!.textContent).toContain("Status is unavailable for this runtime.");
    expect(statusCalls).toBe(0);
    expect(chatRequests).toEqual([]);

    await fillTextarea(textarea, "/status-report");
    await submitTextarea(textarea);
    expect(chatRequests).toHaveLength(1);
    expect(chatRequests[0]?.message).toBe("/status-report");
    expect(statusCalls).toBe(0);
    await act(async () => {
      emitChatEvent?.({
        type: "completed",
        runId: chatRequests[0]!.runId!,
        requestKey: chatRequests[0]!.requestKey,
        text: "Done",
        finishedAt: "2026-07-27T08:02:00.000Z",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  });

  it("dismisses the panel with Close and Escape", async () => {
    await renderApp(
      statusAppState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      { kimiStatus: passiveStatus, sessionStatus: passiveStatus },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;

    await fillTextarea(textarea, "/status");
    await submitTextarea(textarea);
    expect(container!.textContent).toContain("session-1234567890");
    await click(buttonNamed("Close"));
    expect(container!.textContent).not.toContain("session-1234567890");

    await fillTextarea(textarea, "/status");
    await submitTextarea(textarea);
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(container!.textContent).not.toContain("session-1234567890");
  });

  it("keeps an in-flight result with its owning Thread across navigation", async () => {
    let resolveStatus!: (status: KimiSessionStatus) => void;
    const statusGate = new Promise<KimiSessionStatus>((resolve) => {
      resolveStatus = resolve;
    });
    const twoThreadState: AppStateSnapshot = {
      ...statusAppState,
      threads: [
        ...(statusAppState.threads ?? []),
        {
          id: "thread-2",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Other thread",
          createdAt: "2026-07-27T08:02:00.000Z",
          lastActivityAt: "2026-07-27T08:02:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
    };
    await renderApp(
      twoThreadState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      { kimiStatus: passiveStatus, sessionStatus: () => statusGate },
    );
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;

    await fillTextarea(textarea, "/status");
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      testNavigate?.("/workspace/workspace-1/project/project-1/thread/thread-2");
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container!.textContent).toContain("Other thread");
    expect(container!.textContent).not.toContain("session-1234567890");

    resolveStatus(passiveStatus);
    await act(async () => {
      await statusGate;
      testNavigate?.("/workspace/workspace-1/project/project-1/thread/thread-1");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container!.textContent).toContain("session-1234567890");
  });

  it("does not reopen a panel closed while refresh is loading", async () => {
    let statusCall = 0;
    let resolveRefresh!: (status: KimiSessionStatus) => void;
    const refreshGate = new Promise<KimiSessionStatus>((resolve) => {
      resolveRefresh = resolve;
    });
    await renderApp(
      statusAppState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      {
        kimiStatus: passiveStatus,
        sessionStatus: () => {
          statusCall += 1;
          return statusCall === 1 ? passiveStatus : refreshGate;
        },
      },
    );
    const textarea = container!.querySelector<HTMLTextAreaElement>("textarea")!;

    await fillTextarea(textarea, "/status");
    await submitTextarea(textarea);
    await fillTextarea(textarea, "/status");
    await act(async () => {
      textarea.dispatchEvent(
        new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    await click(buttonNamed("Close"));
    resolveRefresh({ ...passiveStatus, used: 40000, percentage: 4 });
    await act(async () => {
      await refreshGate;
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container!.textContent).not.toContain("session-1234567890");
    expect(container!.textContent).not.toContain("40,000 used");
  });
});

describe("Project Working Directory recovery", () => {
  const appState: AppStateSnapshot = {
    version: 1,
    workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
    projects: [{ id: "project-1", name: "Carrent", workingDirectory: "/missing/carrent" }],
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
        title: "Keep History",
        createdAt: "2026-07-27T08:00:00.000Z",
        lastActivityAt: "2026-07-27T08:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ],
    activeWorkspaceId: "workspace-1",
  };
  it("keeps hierarchy visible and blocks the Thread Composer when the directory is unavailable", async () => {
    await renderApp(
      appState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      { projectDirectoryAvailable: false },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container!.textContent).toContain("Personal / Carrent / Keep History");
    expect(container!.textContent).toContain("Project Working Directory is unavailable");
    expect(container!.textContent).toContain("/missing/carrent");
    expect(buttonNamed("Recheck")).toBeDefined();
    expect(buttonNamed("Relocate Directory")).toBeDefined();
    expect(buttonNamed("Carrent directory unavailable")).toBeDefined();
    expect(container!.querySelector("textarea")).toBe(null);
  });

  it("rechecks successfully and replaces the unavailable Thread location", async () => {
    let available = false;
    await renderApp(
      appState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      { projectDirectoryAvailable: () => available },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    available = true;
    await click(buttonNamed("Recheck"));

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.querySelector("textarea")).not.toBe(null);
  });

  it("relocates explicitly and replaces the unavailable Thread location", async () => {
    const relocations: ProjectRelocationRequest[] = [];
    const requests: ChatTurnRequest[] = [];
    let available = false;
    await renderApp(
      appState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      ["/new/carrent"],
      false,
      requests,
      false,
      {
        projectDirectoryAvailable: () => available,
        projectRelocationRequests: relocations,
      },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    available = true;
    await click(buttonNamed("Relocate Directory"));

    expect(relocations).toEqual([{ projectId: "project-1", targetDirectory: "/new/carrent" }]);
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.querySelector("textarea")).not.toBe(null);

    await fillTextarea(container!.querySelector("textarea")!, "Use the relocated directory");
    await click(composerSendButton());

    expect(requests[0]?.context).toEqual({
      kind: "project",
      workspaceId: "workspace-1",
      projectId: "project-1",
      workingDirectory: "/new/carrent",
    });
    await act(async () => {
      emitChatEvent?.({
        type: "stopped",
        runId: requests[0]!.runId!,
        requestKey: requests[0]!.requestKey,
      });
    });
  });

  it("keeps the unavailable state when directory relocation is canceled", async () => {
    const relocations: ProjectRelocationRequest[] = [];
    await renderApp(
      appState,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      { projectDirectoryAvailable: false, projectRelocationRequests: relocations },
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    await click(buttonNamed("Relocate Directory"));

    expect(relocations).toHaveLength(0);
    expect(container!.textContent).toContain("Project Working Directory is unavailable");
    expect(container!.querySelector("textarea")).toBe(null);
  });
});

describe("Archived Thread lifecycle", () => {
  function lifecycleState(archivedThreadIds: string[] = [], queued = false): AppStateSnapshot {
    return {
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
          title: "Primary Thread",
          createdAt: "2026-07-27T08:00:00.000Z",
          lastActivityAt: "2026-07-27T10:00:00.000Z",
          pinned: true,
          ...(archivedThreadIds.includes("thread-1") ? { archived: true } : {}),
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
          runChecklist: {
            runId: "run-1",
            runtimeId: "kimi",
            entries: [{ content: "Keep checklist", status: "pending" }],
            outcome: "completed",
            expanded: true,
          },
        },
        {
          id: "thread-2",
          workspaceId: "workspace-1",
          projectId: "project-1",
          title: "Secondary Thread",
          createdAt: "2026-07-27T07:00:00.000Z",
          lastActivityAt: "2026-07-27T09:00:00.000Z",
          ...(archivedThreadIds.includes("thread-2") ? { archived: true } : {}),
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadMessages: [
        {
          id: "message-1",
          threadId: "thread-1",
          role: "user",
          content: "Keep this history",
          createdAt: "2026-07-27T10:00:00.000Z",
          attachments: [
            {
              id: "attachment-1",
              kind: "file",
              name: "notes.txt",
              mimeType: "text/plain",
              size: 5,
              storageKey: "attachment-1.txt",
            },
          ],
        },
      ],
      threadRuns: [
        {
          id: "run-1",
          threadId: "thread-1",
          messageId: "message-1",
          startedAt: "2026-07-27T10:00:00.000Z",
          runtimeId: "kimi",
          runtimeMode: "approval-required",
          planMode: false,
        },
      ],
      threadWork: queued
        ? {
            "thread-1": {
              queuedMessages: [{ id: "queued-1", content: "Wait for the current Run" }],
            },
          }
        : {},
      lastThreadIdByWorkspace: archivedThreadIds.includes("thread-1")
        ? archivedThreadIds.includes("thread-2")
          ? {}
          : { "workspace-1": "thread-2" }
        : { "workspace-1": "thread-1" },
      activeWorkspaceId: "workspace-1",
    };
  }

  it("archives an idle Thread and opens the next active sibling", async () => {
    const saved = await renderApp(
      lifecycleState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    expect(container!.querySelector('header [aria-label^="Archive "]')).toBe(null);
    await click(buttonNamed("Archive Primary Thread"));

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-2");
    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.archived).toBe(true);
    expect(saved.at(-1)?.threadMessages).toEqual(lifecycleState().threadMessages);
    expect(saved.at(-1)?.threadRuns).toEqual(lifecycleState().threadRuns);
    expect(container!.textContent).not.toContain("Primary Thread");
  });

  it("blocks archive while a Thread has queued messages", async () => {
    await renderApp(
      lifecycleState([], true),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    expect(buttonNamed("Archive Primary Thread").disabled).toBe(true);
    expect(buttonNamed("Archive Primary Thread").title).toContain("queued messages");
  });

  it("blocks archive while the Thread has a live Run", async () => {
    const requests: ChatTurnRequest[] = [];
    await renderApp(
      lifecycleState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
      false,
    );

    await fillTextarea(container!.querySelector("textarea")!, "Keep this Run visible");
    await click(composerSendButton());

    expect(buttonNamed("Archive Primary Thread").disabled).toBe(true);
    expect(buttonNamed("Archive Primary Thread").title).toContain("live Run");

    await act(async () => {
      emitChatEvent?.({
        type: "completed",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
        text: "Done",
        finishedAt: "2026-07-27T10:01:00.000Z",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("does not start a Run while archiving the Thread", async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const requests: ChatTurnRequest[] = [];
    const saved = await renderApp(
      lifecycleState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
      false,
      { appStateSaveGate: saveGate },
    );

    await click(buttonNamed("Archive Primary Thread"));
    await fillTextarea(container!.querySelector("textarea")!, "Do not race this archive");
    await click(composerSendButton());

    releaseSave();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(requests).toHaveLength(0);
    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.archived).toBe(true);
  });

  it("opens the Project overview when archiving the last active Thread", async () => {
    await renderApp(
      lifecycleState(["thread-2"]),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    await click(buttonNamed("Archive Primary Thread"));

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
  });

  it("opens New Thread instead of an Archived Thread", async () => {
    await renderApp(
      lifecycleState(["thread-1"]),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1");
    await waitForProjectDraft();
    expect(container!.querySelector("h1")?.textContent).toBe("New thread");
    expect(container!.querySelector("textarea")).not.toBe(null);
  });

  it("restores an Archived Thread in Settings and opens it only on request", async () => {
    const saved = await renderApp(
      lifecycleState(["thread-1"]),
      "/settings?tab=archives",
      [],
      false,
      [],
      false,
    );

    expect(container!.textContent).toContain("Personal / Carrent / Primary Thread");
    await click(buttonNamed("Restore"));

    expect(currentPathname).toBe("/settings");
    expect(
      saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.archived,
    ).toBeUndefined();
    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.lastActivityAt).toBe(
      "2026-07-27T10:00:00.000Z",
    );
    expect(container!.textContent).toContain("Primary Thread was restored");

    await click(buttonNamed("Open Restored Thread"));
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
  });

  it("keeps restore and permanent deletion mutually exclusive", async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    await renderApp(lifecycleState(["thread-1"]), "/settings?tab=archives", [], false, [], false, {
      deleteThreadDataRequests: cleanupRequests,
      appStateSaveGate: saveGate,
    });

    await click(buttonNamed("Restore"));
    expect(buttonNamed("Permanently Delete").disabled).toBe(true);

    releaseSave();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(cleanupRequests).toHaveLength(0);
  });

  it("keeps an Archived Thread when permanent deletion confirmation is canceled", async () => {
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    let confirmation = "";
    window.confirm = (message) => {
      confirmation = String(message);
      return false;
    };
    await renderApp(lifecycleState(["thread-1"]), "/settings?tab=archives", [], false, [], false, {
      deleteThreadDataRequests: cleanupRequests,
    });

    await click(buttonNamed("Permanently Delete"));

    expect(confirmation).toContain('Permanently delete "Primary Thread"');
    expect(confirmation).toContain("Project files and Git state will not be changed");
    expect(cleanupRequests).toHaveLength(0);
    expect(container!.textContent).toContain("Primary Thread");
  });

  it("permanently deletes only from Archives and keeps the next item selected", async () => {
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    window.confirm = () => true;
    const saved = await renderApp(
      lifecycleState(["thread-1", "thread-2"]),
      "/settings?tab=archives",
      [],
      false,
      [],
      false,
      { deleteThreadDataRequests: cleanupRequests },
    );

    await click(buttonNamed("Permanently Delete"));

    expect(currentPathname).toBe("/settings");
    expect(cleanupRequests).toEqual([
      { threadIds: ["thread-1"], attachmentStorageKeys: ["attachment-1.txt"] },
    ]);
    expect(saved.at(-1)?.threads?.map((thread) => thread.id)).toEqual(["thread-2"]);
    expect(saved.at(-1)?.threadMessages).toEqual([]);
    expect(saved.at(-1)?.threadRuns).toEqual([]);
    expect(container!.textContent).toContain("Secondary Thread");
  });

  it("preserves another Thread's live updates while permanent deletion is pending", async () => {
    let releaseDeletion!: () => void;
    const deletionGate = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const requests: ChatTurnRequest[] = [];
    window.confirm = () => true;
    await renderApp(
      lifecycleState(["thread-1"]),
      "/workspace/workspace-1/project/project-1/thread/thread-2",
      [],
      false,
      requests,
      false,
      { deleteThreadTransactionGate: deletionGate },
    );

    await fillTextarea(container!.querySelector("textarea")!, "Keep this live update");
    await click(composerSendButton());
    await act(async () => {
      testNavigate!("/settings?tab=archives");
    });
    await click(buttonNamed("Permanently Delete"));

    await act(async () => {
      emitChatEvent?.({
        type: "checklist",
        runId: requests[0]!.runId!,
        threadId: "thread-2",
        runtimeId: "kimi",
        checklist: {
          entries: [{ content: "Arrived during deletion", status: "in_progress" }],
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    releaseDeletion();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      testNavigate!("/workspace/workspace-1/project/project-1/thread/thread-2");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(container!.textContent).toContain("Arrived during deletion");
  });

  it("selects the following Archived Thread after deleting a middle item", async () => {
    window.confirm = () => true;
    const appState = lifecycleState(["thread-1", "thread-2"]);
    appState.threads = [
      ...(appState.threads ?? []),
      {
        id: "thread-3",
        workspaceId: "workspace-1",
        projectId: "project-1",
        title: "Tertiary Thread",
        createdAt: "2026-07-27T06:00:00.000Z",
        lastActivityAt: "2026-07-27T08:00:00.000Z",
        archived: true,
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ];

    await renderApp(appState, "/settings?tab=archives", [], false, [], false);

    const secondaryButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Secondary Thread"),
    );
    if (!secondaryButton) throw new Error("Secondary Archived Thread was not found");
    await click(secondaryButton);
    await click(buttonNamed("Permanently Delete"));

    const tertiaryButton = [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("Tertiary Thread"),
    );
    expect(tertiaryButton?.getAttribute("aria-current")).toBe("true");
  });

  it("keeps an Archived Thread when permanent cleanup fails", async () => {
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    window.confirm = () => true;
    const saved = await renderApp(
      lifecycleState(["thread-1"]),
      "/settings?tab=archives",
      [],
      false,
      [],
      false,
      { deleteThreadDataRequests: cleanupRequests, deleteThreadDataFails: true },
    );

    await click(buttonNamed("Permanently Delete"));

    expect(cleanupRequests).toHaveLength(1);
    expect(saved).toHaveLength(0);
    expect(container!.textContent).toContain("Thread could not be permanently deleted");
    expect(container!.textContent).toContain("Primary Thread");
  });

  it("removes one Association and its Thread data while preserving a shared Project", async () => {
    const appState = lifecycleState();
    appState.workspaces.push({ id: "workspace-2", name: "Work", order: 1 });
    appState.associations.push({
      workspaceId: "workspace-2",
      projectId: "project-1",
      order: 0,
      defaultRuntimeId: "kimi",
      defaultRuntimeMode: "approval-required",
    });
    appState.threads = appState.threads?.map((thread) =>
      thread.id === "thread-2" ? { ...thread, workspaceId: "workspace-2" } : thread,
    );
    appState.threadDrafts = [
      {
        id: "draft-1",
        threadId: "draft-thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        content: "Discard this draft",
        attachedSkillNames: [],
        attachments: [
          {
            id: "draft-attachment-1",
            kind: "file",
            name: "draft.txt",
            mimeType: "text/plain",
            size: 5,
            storageKey: "draft-attachment-1.txt",
          },
        ],
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
      {
        id: "draft-2",
        threadId: "draft-thread-2",
        workspaceId: "workspace-2",
        projectId: "project-1",
        content: "Keep this draft",
        attachedSkillNames: [],
        attachments: [],
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ];
    appState.threadPromotionIntents = [
      {
        draftId: "draft-2",
        threadId: "draft-thread-2",
        workspaceId: "workspace-2",
        projectId: "project-1",
        title: "Keep this promotion",
        runId: "run-promotion-2",
        messageId: "message-promotion-2",
        message: "Keep this promotion",
        attachments: [
          {
            id: "promotion-attachment-shared",
            kind: "file",
            name: "shared.txt",
            mimeType: "text/plain",
            size: 5,
            storageKey: "attachment-1.txt",
          },
        ],
        startedAt: "2026-07-27T02:00:00.000Z",
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ];
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    let confirmation = "";
    window.confirm = (message) => {
      confirmation = String(message);
      return true;
    };
    const saved = await renderApp(
      appState,
      "/workspace/workspace-1/project/project-1",
      [],
      false,
      [],
      false,
      { deleteThreadDataRequests: cleanupRequests },
    );

    await click(buttonNamed("More actions for Carrent"));
    await click(buttonNamed("Delete"));

    expect(confirmation).toContain("1 Thread");
    expect(confirmation).toContain("Project Working Directory");
    expect(confirmation).toContain("project files and Git state");
    expect(confirmation).toContain("other Workspaces");
    expect(currentPathname).toBe("/workspace/workspace-1");
    expect(cleanupRequests).toEqual([
      {
        threadIds: ["thread-1", "draft-thread-1"],
        attachmentStorageKeys: ["draft-attachment-1.txt"],
      },
    ]);
    expect(saved.at(-1)?.associations).toEqual([appState.associations[1]]);
    expect(saved.at(-1)?.projects).toEqual(appState.projects);
    expect(saved.at(-1)?.threads).toEqual([
      appState.threads?.find((thread) => thread.id === "thread-2"),
    ]);
    expect(saved.at(-1)?.threadDrafts).toEqual([appState.threadDrafts[1]]);
    expect(saved.at(-1)?.threadPromotionIntents).toEqual(appState.threadPromotionIntents);
    expect(saved.at(-1)?.threadMessages).toEqual([]);
    expect(saved.at(-1)?.threadRuns).toEqual([]);
  });

  it("deletes a Workspace cascade and selects the next Workspace", async () => {
    const appState = lifecycleState();
    appState.workspaces = [
      { id: "workspace-1", name: "Personal", order: 0 },
      { id: "workspace-2", name: "Client", order: 1 },
      { id: "workspace-3", name: "Later", order: 2 },
    ];
    appState.associations = [
      appState.associations[0]!,
      {
        workspaceId: "workspace-2",
        projectId: "project-1",
        order: 0,
        defaultRuntimeId: "kimi",
        defaultRuntimeMode: "approval-required",
      },
    ];
    appState.threads = appState.threads?.map((thread) =>
      thread.id === "thread-1" ? { ...thread, workspaceId: "workspace-2" } : thread,
    );
    appState.threadDrafts = [
      {
        id: "draft-2",
        threadId: "draft-thread-2",
        workspaceId: "workspace-2",
        projectId: "project-1",
        content: "Discard with Workspace",
        attachedSkillNames: [],
        attachments: [],
        runtimeId: "kimi",
        runtimeMode: "approval-required",
        planMode: false,
      },
    ];
    appState.activeWorkspaceId = "workspace-2";
    appState.lastThreadIdByWorkspace = {
      "workspace-1": "thread-2",
      "workspace-2": "thread-1",
    };
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    let confirmation = "";
    window.confirm = (message) => {
      confirmation = String(message);
      return true;
    };
    const saved = await renderApp(appState, "/workspace/workspace-2", [], false, [], false, {
      deleteThreadDataRequests: cleanupRequests,
    });

    await click(buttonNamed("Delete Workspace"));

    expect(confirmation).toContain("1 Thread");
    expect(confirmation).toContain("Project Working Directories");
    expect(confirmation).toContain("other Workspaces");
    expect(currentPathname).toBe("/workspace/workspace-3");
    expect(cleanupRequests).toEqual([
      { threadIds: ["thread-1", "draft-thread-2"], attachmentStorageKeys: ["attachment-1.txt"] },
    ]);
    expect(saved.at(-1)?.workspaces.map((workspace) => workspace.id)).toEqual([
      "workspace-1",
      "workspace-3",
    ]);
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-3");
    expect(saved.at(-1)?.associations).toEqual([appState.associations[0]]);
    expect(saved.at(-1)?.projects).toEqual(appState.projects);
    expect(saved.at(-1)?.threads?.map((thread) => thread.id)).toEqual(["thread-2"]);
    expect(saved.at(-1)?.threadDrafts).toEqual([]);
    expect(saved.at(-1)?.lastThreadIdByWorkspace).toEqual({ "workspace-1": "thread-2" });
  });

  it("selects the previous Workspace when deleting the last ordered Workspace", async () => {
    window.confirm = () => true;
    const saved = await renderApp(
      {
        version: 1,
        workspaces: [
          { id: "workspace-1", name: "Personal", order: 0 },
          { id: "workspace-2", name: "Client", order: 1 },
        ],
        projects: [],
        associations: [],
        activeWorkspaceId: "workspace-2",
      },
      "/workspace/workspace-2",
      [],
      false,
      [],
      false,
    );

    await click(buttonNamed("Delete Workspace"));

    expect(currentPathname).toBe("/workspace/workspace-1");
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-1");
    expect(container!.querySelector("h1")?.textContent).toBe("Personal");
  });

  it("opens global first use after deleting the only Workspace", async () => {
    window.confirm = () => true;
    const saved = await renderApp(
      {
        version: 1,
        workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
        projects: [],
        associations: [],
        activeWorkspaceId: "workspace-1",
      },
      "/workspace/workspace-1",
      [],
      false,
      [],
      false,
    );

    await click(buttonNamed("Delete Workspace"));

    expect(currentPathname).toBe("/");
    expect(saved.at(-1)?.workspaces).toEqual([]);
    expect(saved.at(-1)?.activeWorkspaceId).toBe(null);
    expect(container!.textContent).toContain("Create your first Workspace");
  });

  it("blocks Association and Workspace removal before confirmation while an affected Run is live", async () => {
    const requests: ChatTurnRequest[] = [];
    let confirmationCount = 0;
    window.confirm = () => {
      confirmationCount += 1;
      return true;
    };
    await renderApp(
      lifecycleState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
      false,
    );

    await fillTextarea(container!.querySelector("textarea")!, "Keep this Run alive");
    await click(composerSendButton());

    await click(buttonNamed("More actions for Carrent"));
    expect(buttonNamed("Delete").disabled).toBe(true);
    expect(buttonNamed("Delete").title).toContain("live Run");
    await act(async () => {
      testNavigate!("/workspace/workspace-1");
    });
    expect(buttonNamed("Delete Workspace").disabled).toBe(true);
    expect(buttonNamed("Delete Workspace").title).toContain("live Run");
    expect(confirmationCount).toBe(0);

    await act(async () => {
      emitChatEvent?.({
        type: "completed",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
        text: "Done",
        finishedAt: "2026-07-27T10:01:00.000Z",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("removes the final Project record when an empty Association is removed", async () => {
    const appState = lifecycleState();
    appState.threads = [];
    appState.threadMessages = [];
    appState.threadRuns = [];
    appState.lastThreadIdByWorkspace = {};
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    window.confirm = () => true;
    const saved = await renderApp(appState, "/workspace/workspace-1", [], false, [], false, {
      deleteThreadDataRequests: cleanupRequests,
    });

    await click(buttonNamed("More actions for Carrent"));
    await click(buttonNamed("Delete"));

    expect(cleanupRequests).toEqual([{ threadIds: [], attachmentStorageKeys: [] }]);
    expect(saved.at(-1)?.projects).toEqual([]);
    expect(saved.at(-1)?.associations).toEqual([]);
    expect(currentPathname).toBe("/workspace/workspace-1");
  });
});
