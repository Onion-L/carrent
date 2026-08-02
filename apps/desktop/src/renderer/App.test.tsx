import { afterEach, describe, expect, it, mock } from "bun:test";

import "./test/registerHappyDom";

import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { $createParagraphNode, $createTextNode, $getRoot, type LexicalEditor } from "lexical";
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
import { normalizeAppStateSettings } from "../shared/workspacePersistence";
import { createFakeAppStateAuthority } from "./test/fakeAppStateAuthority";
import type {
  ChatRunEvent,
  ChatTurnRequest,
  DeleteThreadDataRequest,
  ThreadDeletionTransactionRequest,
  KimiSessionStatus,
} from "../shared/chat";
import type { ThreadActionRequest, ThreadActionResult } from "../shared/threadActions";
import type { SkillRecord } from "../shared/skills";

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
let reportedWindowRoutes: string[] = [];
let terminalCreateRequests: import("../shared/terminal").CreateTerminalRequest[] = [];
let terminalWriteRequests: import("../shared/terminal").TerminalWriteRequest[] = [];
let terminalFocusRequests: import("../shared/terminal").TerminalFocusRequest[] = [];
let terminalCloseProjectRequests: string[] = [];
type TestTerminalEvent = import("../shared/terminal").TerminalEvent extends infer Event
  ? Event extends { revision: number }
    ? Omit<Event, "revision">
    : never
  : never;
let emitTerminalEvent: ((event: TestTerminalEvent) => void) | null = null;

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
  chatStopRequests: string[] = [],
  skills: SkillRecord[] = [],
) {
  let chatListener: ((event: import("../shared/chat").ChatRunEvent) => void) | null = null;
  const terminalListeners = new Set<(event: import("../shared/terminal").TerminalEvent) => void>();
  let commandAttempt = 0;
  const terminalTabsByProject = new Map<string, import("../shared/terminal").TerminalTab[]>();
  const terminalOutputById = new Map<string, string>();
  const terminalRevisionByProject = new Map<string, number>();
  const dispatchTerminalEvent = (event: TestTerminalEvent) => {
    if (event.type === "output") {
      terminalOutputById.set(
        event.terminalId,
        `${terminalOutputById.get(event.terminalId) ?? ""}${event.data}`,
      );
    }
    const revision = (terminalRevisionByProject.get(event.projectId) ?? 0) + 1;
    terminalRevisionByProject.set(event.projectId, revision);
    const value = { ...event, revision } as import("../shared/terminal").TerminalEvent;
    for (const listener of terminalListeners) listener(value);
  };
  const publishTerminalState = (projectId: string) => {
    dispatchTerminalEvent({
      type: "state",
      projectId,
      tabs: structuredClone(terminalTabsByProject.get(projectId) ?? []),
    });
  };
  emitTerminalEvent = dispatchTerminalEvent;
  // Settings set through localStorage are pre-migrated into the snapshot so
  // the renderer's one-time migration does not fire an extra command.
  const legacySettingsRaw = localStorage.getItem("carrent:settings");
  const legacySettings = legacySettingsRaw
    ? normalizeAppStateSettings(JSON.parse(legacySettingsRaw))
    : null;
  const loadedAppState: AppStateSnapshot = {
    ...(appState ?? emptyAppState),
    ...(legacySettings ? { settings: legacySettings } : {}),
  };
  const authority = createFakeAppStateAuthority(loadedAppState, {
    onPersist: (snapshot) => {
      saved.push(snapshot);
    },
    commandHook: async () => {
      // Commands persist through the authority; simulate persistence failures
      // and slow writes the legacy save path used to support.
      commandAttempt += 1;
      if (
        saveFails === true ||
        saveFails === commandAttempt ||
        (Array.isArray(saveFails) && saveFails.includes(commandAttempt))
      ) {
        return {
          status: "rejected",
          reason: "persistence-failed",
          revision: authority.getState().revision,
        };
      }
      await appStateSaveGate;
      return null;
    },
  });
  window.carrent = {
    appState: {
      load: async () => ({ status: "ready", snapshot: loadedAppState }),
      reread: async () => ({ status: "ready", snapshot: loadedAppState }),
      fullReset: async () => {
        authority.adoptExternalSnapshot(emptyAppState);
        return {
          status: "ready",
          snapshot: emptyAppState,
          notice: "full-reset",
        };
      },
      subscribe: authority.subscribe,
      unsubscribe: authority.unsubscribe,
      command: authority.command,
      onChanged: authority.onChanged,
      onFlushRequest: () => () => {},
      flushDone: async () => {},
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
      revealPath: async () => {},
      openExternal: async () => {},
    },
    clipboard: {
      writeText: async () => {},
      readText: async () => "",
    },
    terminal: {
      subscribe: async (projectId: string) => ({
        projectId,
        revision: terminalRevisionByProject.get(projectId) ?? 0,
        tabs: structuredClone(terminalTabsByProject.get(projectId) ?? []),
        outputByTerminal: Object.fromEntries(terminalOutputById),
      }),
      unsubscribe: async () => {},
      create: async (request: import("../shared/terminal").CreateTerminalRequest) => {
        terminalCreateRequests.push(structuredClone(request));
        const existing = terminalTabsByProject.get(request.projectId) ?? [];
        if (request.ensureFirst && existing.length > 0) {
          return structuredClone(existing.find((tab) => tab.active) ?? existing[0]);
        }
        const tab = {
          id: `terminal-${terminalCreateRequests.length}`,
          projectId: request.projectId,
          title:
            existing.length === 0
              ? request.projectName
              : `${request.projectName} ${existing.length + 1}`,
          active: true,
          status: "running" as const,
          enhancedCompletion: request.enhancedCompletion,
        };
        terminalTabsByProject.set(request.projectId, [
          ...existing.map((item) => ({ ...item, active: false })),
          tab,
        ]);
        publishTerminalState(request.projectId);
        return structuredClone(tab);
      },
      write: async (request: import("../shared/terminal").TerminalWriteRequest) => {
        terminalWriteRequests.push(structuredClone(request));
      },
      resize: async () => {},
      focus: async (request: import("../shared/terminal").TerminalFocusRequest) => {
        terminalFocusRequests.push(structuredClone(request));
      },
      activate: async ({ projectId, terminalId }: import("../shared/terminal").TerminalTarget) => {
        terminalTabsByProject.set(
          projectId,
          (terminalTabsByProject.get(projectId) ?? []).map((tab) => ({
            ...tab,
            active: tab.id === terminalId,
          })),
        );
        publishTerminalState(projectId);
      },
      close: async ({ projectId, terminalId }: import("../shared/terminal").TerminalTarget) => {
        const remaining = (terminalTabsByProject.get(projectId) ?? []).filter(
          (tab) => tab.id !== terminalId,
        );
        if (remaining.length > 0 && !remaining.some((tab) => tab.active)) {
          remaining[remaining.length - 1] = { ...remaining.at(-1)!, active: true };
        }
        terminalTabsByProject.set(projectId, remaining);
        terminalOutputById.delete(terminalId);
        publishTerminalState(projectId);
      },
      closeProject: async (projectId: string) => {
        terminalCloseProjectRequests.push(projectId);
        terminalTabsByProject.delete(projectId);
        publishTerminalState(projectId);
      },
      onEvent: (listener: (event: import("../shared/terminal").TerminalEvent) => void) => {
        terminalListeners.add(listener);
        return () => {
          terminalListeners.delete(listener);
        };
      },
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
          ...authority.getState().snapshot,
          projects: authority
            .getState()
            .snapshot.projects.map((project) =>
              project.id === request.projectId
                ? { ...project, workingDirectory: request.targetDirectory }
                : project,
            ),
        };
        // The relocation transaction commits and the authority adopts the
        // committed snapshot, broadcasting it to every window.
        authority.adoptExternalSnapshot(relocatedAppState);
        return { appState: relocatedAppState };
      },
    },
    skills: { list: async () => skills },
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
      stop: async (runId: string) => {
        chatStopRequests.push(runId);
      },
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
        // The real transaction recomputes the committed snapshot from the
        // store and the authority adopts it, broadcasting to every window.
        authority.commitThreadDeletion(request);
      },
    },
    mainWindow: {
      onNavigate: (listener: (path: string) => void) => {
        emitMainWindowNavigation = listener;
        return () => {
          if (emitMainWindowNavigation === listener) emitMainWindowNavigation = null;
        };
      },
      zoom: {
        getFactor: async () => 1,
        change: async () => 1,
        onFactorChange: () => () => {},
      },
      windows: {
        openThread: async () => {},
        onOpenError: () => () => {},
        reportRoute: (route: string) => reportedWindowRoutes.push(route),
        onCaptureRequest: () => () => {},
        captureDone: async () => {},
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
  // A dedicated authority so reread/full-reset results become subscribable,
  // mirroring the Main-process replaceState on those channels.
  const authority = createFakeAppStateAuthority(emptyAppState);
  window.carrent.appState = {
    load: async () => current,
    reread: async () => {
      current = loadResults.shift() ?? current;
      if (current.status === "ready") authority.adoptExternalSnapshot(current.snapshot);
      return current;
    },
    fullReset: async () => {
      if (resetResult.status === "ready") authority.adoptExternalSnapshot(resetResult.snapshot);
      return resetResult;
    },
    subscribe: authority.subscribe,
    unsubscribe: authority.unsubscribe,
    command: authority.command,
    onChanged: authority.onChanged,
    onFlushRequest: () => () => {},
    flushDone: async () => {},
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
  chatStopRequests?: string[];
  skills?: SkillRecord[];
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
    options.chatStopRequests,
    options.skills,
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

async function fillComposerEditor(editor: HTMLElement, value: string) {
  const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;
  const lexicalEditor = (text as HTMLElement & { __lexicalEditor: LexicalEditor }).__lexicalEditor;
  await act(async () => {
    lexicalEditor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode();
      const textNode = $createTextNode(value);
      paragraph.append(textNode);
      root.append(paragraph);
      textNode.selectEnd();
    });
    text.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function getComposerEditorText(editor: HTMLElement) {
  const text = editor.querySelector<HTMLElement>("[data-composer-text='true']")!;
  const copy = text.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("[data-skill-marker='true']").forEach((marker) => marker.remove());
  return copy.textContent;
}

async function fillNativeTextarea(nativeTextarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )!.set!;
  await act(async () => {
    nativeTextarea.dispatchEvent(new window.FocusEvent("focusin", { bubbles: true }));
    setter.call(nativeTextarea, value);
    nativeTextarea.dispatchEvent(new window.Event("input", { bubbles: true }));
    nativeTextarea.dispatchEvent(new window.Event("change", { bubbles: true }));
    nativeTextarea.dispatchEvent(new window.KeyboardEvent("keyup", { bubbles: true, key: "a" }));
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

function composerStopButton() {
  return buttonNamed("Stop run");
}

async function waitForProjectDraft() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']");
  if (!editor) throw new Error("Project Draft Composer not found");
  return editor;
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
  reportedWindowRoutes = [];
  terminalCreateRequests = [];
  terminalWriteRequests = [];
  terminalFocusRequests = [];
  terminalCloseProjectRequests = [];
  emitTerminalEvent = null;
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

  it("reports the current Carrent Window route after navigation", async () => {
    await renderApp(
      {
        ...emptyAppState,
        workspaces: [{ id: "workspace-1", name: "Personal", order: 0 }],
        activeWorkspaceId: "workspace-1",
      },
      "/workspace/workspace-1",
    );

    expect(reportedWindowRoutes.at(-1)).toBe("/workspace/workspace-1");

    await act(async () => testNavigate?.("/settings"));

    expect(reportedWindowRoutes.at(-1)).toBe("/settings");
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

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Save before closing",
    );
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
    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Keep the newer draft",
    );

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

    await click(buttonNamed("More actions for Personal Carrent"));
    await click(buttonNamed("Delete"));
    await click(buttonNamed("Delete Project"));

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
    const emptyThreadLayout = container!.querySelector<HTMLElement>("[data-empty-thread-layout]")!;
    expect(emptyThreadLayout.parentElement?.classList.contains("h-full")).toBe(true);
    expect(emptyThreadLayout.parentElement?.parentElement?.classList.contains("flex")).toBe(true);
    expect(
      container!
        .querySelector<HTMLElement>("[data-composer-surface]")
        ?.className.includes("shadow-["),
    ).toBe(false);
    expect(container!.textContent).not.toContain("Thread Draft");
  });

  it("orders Threads by latest activity and renames them", async () => {
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

    expect(navigationPane.textContent!.indexOf("Recent Thread")).toBeLessThan(
      navigationPane.textContent!.indexOf("Personal Thread"),
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

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Track meaningful activity",
    );
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
    expect(buttonNamed("Personal").getAttribute("aria-current")).toBe(null);
    expect(buttonNamed("Client").getAttribute("aria-current")).toBe(null);
    expect(buttonNamed("Settings").getAttribute("aria-current")).toBe("page");
    expect(
      [buttonNamed("Personal"), buttonNamed("Client"), buttonNamed("Settings")].filter(
        (button) => button.getAttribute("aria-current") === "page",
      ),
    ).toHaveLength(1);

    await click(buttonNamed("Settings"));
    expect(currentPathname).toBe(entryPath);
    expect(buttonNamed("Personal").getAttribute("aria-current")).toBe("page");
    expect(buttonNamed("Settings").getAttribute("aria-current")).toBe(null);
  });

  it("switches the active Workspace directly from Settings", async () => {
    const saved = await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
    );

    await click(buttonNamed("Settings"));
    await click(buttonNamed("Client"));

    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1/thread/thread-2");
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-2");
    expect(buttonNamed("Client").getAttribute("aria-current")).toBe("page");
    expect(buttonNamed("Settings").getAttribute("aria-current")).toBe(null);
  });

  it("does not let rapid Send clicks stop the Run they start", async () => {
    const requests: ChatTurnRequest[] = [];
    const stopRequests: string[] = [];
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
      false,
      { chatStopRequests: stopRequests },
    );

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Keep this Run alive",
    );
    const sendButton = composerSendButton();
    await act(async () => {
      sendButton.click();
      sendButton.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(requests).toHaveLength(1);
    expect(stopRequests).toHaveLength(0);
    expect(composerStopButton().disabled).toBe(true);

    composerStopButton().click();
    expect(stopRequests).toHaveLength(0);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
    });
    expect(composerStopButton().disabled).toBe(false);
    await click(composerStopButton());
    expect(stopRequests).toEqual([requests[0].runId]);

    await act(async () => {
      emitChatEvent?.({
        type: "stopped",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("does not offer history editing while the Thread has a live Run", async () => {
    const state = navigationState();
    const requests: ChatTurnRequest[] = [];
    state.threadMessages = [
      {
        id: "message-1",
        threadId: "thread-1",
        role: "user",
        content: "Original request",
        createdAt: "2026-07-27T08:00:00.000Z",
        attachments: [],
      },
    ];
    await renderApp(
      state,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
    );

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Start live Run",
    );
    await click(composerSendButton());

    const originalBubble = [...container!.querySelectorAll<HTMLDivElement>(".bg-user-bubble")].find(
      (element) => element.textContent?.trim() === "Original request",
    )!.parentElement!.parentElement!;
    await act(async () => {
      originalBubble.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
    });

    expect(
      [...container!.querySelectorAll<HTMLButtonElement>("button")].some(
        (button) => button.title === "Edit",
      ),
    ).toBe(false);

    await act(async () => {
      emitChatEvent?.({
        type: "stopped",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("does not let an archive transition suppress an invalid ownership route", async () => {
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
      { appStateSaveGate: saveGate },
    );

    await click(buttonNamed("Archive Personal Thread"));
    await act(async () => {
      testNavigate!("/workspace/workspace-2/project/project-1/thread/thread-1");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1");
    expect(container!.textContent).toContain("Thread could not be found.");

    releaseSave();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(currentPathname).toBe("/workspace/workspace-2/project/project-1");
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
    expect(dialog!.textContent).toContain("Personal / Personal Carrent / Personal Thread");
    expect(dialog!.textContent).toContain("Client / Client Carrent / Client Thread");
    expect(dialog!.textContent!.indexOf("Client Thread")).toBeLessThan(
      dialog!.textContent!.indexOf("Personal Thread"),
    );
  });

  it("opens Thread search from the header button and shows matches across all Workspaces", async () => {
    await renderApp(
      navigationState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      [],
      false,
    );

    await click(buttonNamed("Search Threads"));
    const dialog = document.querySelector<HTMLElement>(
      '[role="dialog"][aria-label="Search Threads"]',
    )!;
    expect(dialog.textContent).toContain("Personal / Personal Carrent / Personal Thread");
    expect(dialog.textContent).toContain("Client / Client Carrent / Client Thread");

    await fillInput(
      dialog.querySelector<HTMLInputElement>('input[aria-label="Search Thread titles"]')!,
      "missing",
    );
    expect(dialog.textContent).toContain("No matching Threads");
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
    const searchThreadsButton = buttonNamed("Search Threads");
    const workspaceSelect = buttonNamed("Select Workspace");
    expect(addProjectButton.querySelector(".lucide-plus")).not.toBe(null);
    expect(navigationPane.contains(addProjectButton)).toBe(true);
    expect(navigationPane.contains(searchThreadsButton)).toBe(false);
    expect(
      collapseSidebarButton.compareDocumentPosition(searchThreadsButton) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
    expect(
      searchThreadsButton.compareDocumentPosition(workspaceSelect) &
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

  const existingThreadState = (): AppStateSnapshot => ({
    ...state,
    threads: [
      {
        id: "thread-1",
        workspaceId: "workspace-1",
        projectId: "project-1",
        title: "Existing Thread",
        createdAt: "2026-07-27T08:00:00.000Z",
        lastActivityAt: "2026-07-27T08:01:00.000Z",
        runtimeId: "kimi",
        runtimeModelId: "kimi-k2.5",
        runtimeMode: "approval-required",
        planMode: true,
      },
    ],
    threadMessages: [
      {
        id: "message-1",
        threadId: "thread-1",
        role: "user",
        content: "Original request",
        createdAt: "2026-07-27T08:00:00.000Z",
        attachments: [],
      },
      {
        id: "message-2",
        threadId: "thread-1",
        role: "assistant",
        content: "Original response",
        createdAt: "2026-07-27T08:01:00.000Z",
        runStatus: "completed",
        attachments: [],
      },
    ],
  });

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

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Keep this across navigation",
    );
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

    expect(container!.querySelector<HTMLElement>("[data-composer-text='true']")?.textContent).toBe(
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
    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Implement association drafts",
    );
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

  it("keeps the first user message before Stopped after App State reload", async () => {
    const requests: ChatTurnRequest[] = [];
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1",
      [],
      false,
      requests,
    );

    await waitForProjectDraft();
    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "First cancelled request",
    );
    await click(composerSendButton());
    await act(async () => {
      emitChatEvent?.({
        type: "stopped",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
      });
      await new Promise((resolve) => setTimeout(resolve, 320));
    });

    const persisted = structuredClone(saved.at(-1)!);
    const threadId = requests[0].threadId;
    const persistedMessages = persisted.threadMessages?.filter(
      (message) => message.threadId === threadId,
    );
    expect(persistedMessages?.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(persistedMessages?.[1]?.runStatus).toBe("cancelled");

    await act(async () => root!.unmount());
    container!.remove();
    root = null;
    container = null;
    await renderApp(persisted, `/workspace/workspace-1/project/project-1/thread/${threadId}`);

    const renderedText = container!.textContent ?? "";
    expect(renderedText.indexOf("First cancelled request")).toBeLessThan(
      renderedText.indexOf("Stopped"),
    );
  });

  it("keeps the first user message before an empty failed response", async () => {
    const requests: ChatTurnRequest[] = [];
    await renderApp(state, "/workspace/workspace-1/project/project-1", [], false, requests);

    await waitForProjectDraft();
    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "First failed request",
    );
    await click(composerSendButton());
    await act(async () => {
      emitChatEvent?.({
        type: "failed",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
        error: "Runtime failed before replying",
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    const renderedText = container!.textContent ?? "";
    expect(renderedText.indexOf("First failed request")).toBeLessThan(
      renderedText.indexOf("Runtime failed before replying"),
    );
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
    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Persist before dispatch",
    );
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
    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Retry this request",
    );
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
    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Retry after cleanup failure",
    );
    await click(composerSendButton());
    await click(composerSendButton());

    expect(saved.at(-1)?.threads).toEqual([]);
    expect(saved.at(-1)?.threadDrafts?.[0]).toMatchObject({
      workspaceId: "workspace-1",
      projectId: "project-1",
      content: "Retry after cleanup failure",
    });
    expect(container!.querySelector<HTMLElement>("[data-composer-text='true']")?.textContent).toBe(
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
    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Persist this before promotion",
    );
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
    expect(container!.querySelector("[data-composer-editor='true']") !== null).toBe(true);
  });

  it("keeps a new Thread message when the Runtime synchronizes Plan mode", async () => {
    const requests: ChatTurnRequest[] = [];
    const saved = await renderApp(
      existingThreadState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
    );

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "New request",
    );
    await click(composerSendButton());
    await act(async () => {
      emitChatEvent?.({
        type: "plan-mode-changed",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
        enabled: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container!.textContent).toContain("New request");
    expect(saved.at(-1)?.threadMessages?.some((message) => message.content === "New request")).toBe(
      true,
    );
    expect(saved.at(-1)?.threadRuns?.some((run) => run.id === requests[0].runId)).toBe(true);
    await act(async () => {
      emitChatEvent?.({
        type: "stopped",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });

  it("keeps an edited Thread message when the Runtime synchronizes Plan mode", async () => {
    const requests: ChatTurnRequest[] = [];
    const saved = await renderApp(
      existingThreadState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
    );
    const originalBubble = [...container!.querySelectorAll<HTMLDivElement>(".bg-user-bubble")].find(
      (element) => element.textContent?.trim() === "Original request",
    )!.parentElement!.parentElement!;
    await act(async () => {
      originalBubble.dispatchEvent(new window.MouseEvent("mouseover", { bubbles: true }));
    });
    await click(
      [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.title === "Edit",
      )!,
    );
    await fillNativeTextarea(
      container!.querySelectorAll<HTMLTextAreaElement>("textarea")[0],
      "Edited request",
    );
    await click(
      [...container!.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) => button.textContent === "发送",
      )!,
    );
    await act(async () => {
      emitChatEvent?.({
        type: "plan-mode-changed",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
        enabled: false,
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container!.textContent).toContain("Edited request");
    expect(saved.at(-1)?.threadMessages?.[0]?.content).toBe("Edited request");
    await act(async () => {
      emitChatEvent?.({
        type: "stopped",
        runId: requests[0].runId!,
        requestKey: requests[0].requestKey,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
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
    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Do not dispatch this",
    );
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
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    await fillComposerEditor(editor, "/");
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
    expect(getComposerEditorText(editor)).toBe("");

    await fillComposerEditor(editor, "/compact Keep this draft");
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(getComposerEditorText(editor)).toBe("Keep this draft");
    expect(actionRequests).toHaveLength(1);
    expect(container!.textContent).toContain("already compacting");

    await fillComposerEditor(editor, "Next request");

    await act(async () => {
      finishCompact();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container!.textContent).toContain("Context compacted");
    expect(getComposerEditorText(editor)).toBe("Next request");
    expect(saved.at(-1)?.threadActions?.[0]).toMatchObject({
      threadId: "thread-1",
      action: "compact",
      runtimeId: "kimi",
      completedAt: "2026-07-27T08:02:00.000Z",
    });
    expect(saved.at(-1)?.threadActions?.[0]?.id.startsWith("thread-action-")).toBe(true);
    expect(saved.at(-1)?.threads?.[0]?.lastActivityAt).toBe("2026-07-27T08:02:00.000Z");

    await fillComposerEditor(editor, "/compact Keep this draft");
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(getComposerEditorText(editor)).toBe("Keep this draft");
    expect(actionRequests).toHaveLength(1);
    expect(requests).toEqual([]);
    expect(container!.textContent).toContain("requires a completed user and Agent exchange");

    await fillComposerEditor(editor, "/");
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

    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    await fillComposerEditor(editor, "/compact Keep this draft");
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(getComposerEditorText(editor)).toBe("Keep this draft");
    expect(actionRequests).toHaveLength(1);

    await fillComposerEditor(editor, "/compact Try again");
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(getComposerEditorText(editor)).toBe("Try again");
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

    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    await fillComposerEditor(editor, "/compact Keep this draft");
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
        );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(getComposerEditorText(editor)).toBe("Keep this draft");
    expect(actionRequests).toHaveLength(1);
    expect(saved).toHaveLength(0);
    expect(container!.textContent).toContain("history boundary could not be saved");

    await fillComposerEditor(editor, "/compact Try again");
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(getComposerEditorText(editor)).toBe("Try again");
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

  async function submitEditor(editor: HTMLElement) {
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
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

    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;
    await fillComposerEditor(editor, "Keep this /st");
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      [...container!.querySelectorAll<HTMLButtonElement>("button")].some((button) =>
        button.textContent?.startsWith("Status"),
      ),
    ).toBe(false);

    await fillComposerEditor(editor, "/");
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
    expect(getComposerEditorText(editor)).toBe("");
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
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;

    await fillComposerEditor(editor, "/status");
    await submitEditor(editor);
    expect(container!.textContent).toContain("35,193 used");

    await fillComposerEditor(editor, "/status Keep this draft");
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
          new window.KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Enter" }),
        );
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(statusCall).toBe(2);
    expect(getComposerEditorText(editor)).toBe("Keep this draft");
    expect(container!.textContent).toContain("35,193 used");
    expect(composerSendButton().disabled).toBe(true);
    expect(container!.querySelector('[aria-busy="true"]')).not.toBe(null);

    rejectRefresh(new Error("transport failed"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(container!.textContent).toContain("35,193 used");
    expect(container!.textContent).toContain("Unable to load session status.");
    expect(getComposerEditorText(editor)).toBe("Keep this draft");
    expect(composerSendButton().disabled).toBe(false);

    await fillComposerEditor(editor, "/status");
    await submitEditor(editor);
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
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;

    await fillComposerEditor(editor, "/status Keep this draft");
    await submitEditor(editor);
    expect(getComposerEditorText(editor)).toBe("Keep this draft");
    expect(container!.textContent).toContain("Status is unavailable for this runtime.");
    expect(statusCalls).toBe(0);
    expect(chatRequests).toEqual([]);

    await fillComposerEditor(editor, "/status-report");
    await submitEditor(editor);
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
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;

    await fillComposerEditor(editor, "/status");
    await submitEditor(editor);
    expect(container!.textContent).toContain("session-1234567890");
    await click(buttonNamed("Close"));
    expect(container!.textContent).not.toContain("session-1234567890");

    await fillComposerEditor(editor, "/status");
    await submitEditor(editor);
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
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;

    await fillComposerEditor(editor, "/status");
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
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
    const editor = container!.querySelector<HTMLElement>("[data-composer-editor='true']")!;

    await fillComposerEditor(editor, "/status");
    await submitEditor(editor);
    await fillComposerEditor(editor, "/status");
    await act(async () => {
      editor
        .querySelector<HTMLElement>("[data-composer-text='true']")!
        .dispatchEvent(
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
    expect(container!.querySelector("[data-composer-editor='true']")).toBe(null);
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
    expect(container!.querySelector("[data-composer-editor='true']")).not.toBe(null);
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
    expect(terminalCloseProjectRequests).toEqual(["project-1"]);
    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(currentNavigationType).toBe("REPLACE");
    expect(container!.querySelector("[data-composer-editor='true']")).not.toBe(null);

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Use the relocated directory",
    );
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
    expect(container!.querySelector("[data-composer-editor='true']")).toBe(null);
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
    const state = lifecycleState();
    state.threads?.push({
      id: "thread-3",
      workspaceId: "workspace-1",
      projectId: "project-1",
      title: "Pinned Sibling",
      createdAt: "2026-07-27T06:00:00.000Z",
      lastActivityAt: "2026-07-27T08:00:00.000Z",
      pinned: true,
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

    expect(container!.querySelector('header [aria-label^="Archive "]')).toBe(null);
    await click(buttonNamed("Archive Primary Thread"));

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-3");
    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.archived).toBe(true);
    expect(saved.at(-1)?.threadMessages).toEqual(lifecycleState().threadMessages);
    expect(saved.at(-1)?.threadRuns).toEqual(lifecycleState().threadRuns);
    expect(container!.textContent).not.toContain("Primary Thread");
    expect(container!.textContent).not.toContain("Thread could not be found.");

    expect(container!.textContent).toContain("Thread archived.");
    await click(buttonNamed("View"));
    expect(currentPathname).toBe("/settings");
    expect(container!.textContent).toContain("Primary Thread");
  });

  it("shows one archive toast when archiving several Threads", async () => {
    const state = lifecycleState();
    state.threads?.push({
      id: "thread-3",
      workspaceId: "workspace-1",
      projectId: "project-1",
      title: "Third Thread",
      createdAt: "2026-07-27T06:00:00.000Z",
      lastActivityAt: "2026-07-27T08:00:00.000Z",
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

    await click(buttonNamed("Archive Primary Thread"));
    await click(buttonNamed("Archive Secondary Thread"));
    await click(buttonNamed("Archive Third Thread"));

    const archiveToasts = [...container!.querySelectorAll('[role="status"]')].filter((toast) =>
      toast.textContent?.includes("Thread archived."),
    );
    expect(archiveToasts).toHaveLength(1);
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

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Keep this Run visible",
    );
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
    const stopRequests: string[] = [];
    const state = lifecycleState();
    state.threadWork = {
      "thread-1": {
        draft: {
          content: "Do not race this archive",
          attachedSkillNames: ["tdd"],
          attachments: [
            {
              id: "draft-attachment",
              kind: "file",
              name: "notes.txt",
              mimeType: "text/plain",
              size: 5,
              storageKey: "draft-notes.txt",
            },
          ],
        },
        queuedMessages: [],
      },
    };
    const saved = await renderApp(
      state,
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
      false,
      {
        appStateSaveGate: saveGate,
        chatStopRequests: stopRequests,
        skills: [
          {
            name: "tdd",
            description: "Test-driven development",
            path: "/skills/tdd/SKILL.md",
            source: "agents",
          },
        ],
      },
    );

    await click(buttonNamed("Secondary Thread"));
    await click(buttonNamed("Primary Thread"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(
      getComposerEditorText(
        container!.querySelector<HTMLElement>("[data-composer-editor='true']")!,
      ),
    ).toBe("Do not race this archive");
    await click(buttonNamed("Archive Primary Thread"));
    await click(composerSendButton());

    expect(requests).toHaveLength(0);
    expect(stopRequests).toHaveLength(0);
    expect(container!.textContent).toContain(
      "This thread is being updated and cannot accept messages right now.",
    );
    expect(container!.querySelector('[aria-label="Stop run"]')).toBe(null);

    releaseSave();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });

    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.archived).toBe(true);
    expect(saved.at(-1)?.threadWork?.["thread-1"]?.draft).toMatchObject(
      state.threadWork["thread-1"].draft,
    );
    expect(saved.at(-1)?.threadMessages).toEqual(state.threadMessages);
    expect(saved.at(-1)?.threadRuns).toEqual(state.threadRuns);
  });

  it("keeps the current route and shows only the archive error when archiving fails", async () => {
    await renderApp(
      lifecycleState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      true,
    );

    await click(buttonNamed("Archive Primary Thread"));

    expect(currentPathname).toBe("/workspace/workspace-1/project/project-1/thread/thread-1");
    expect(container!.textContent).toContain("Thread could not be archived.");
    expect(container!.textContent).not.toContain("Thread could not be found.");
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
    expect(container!.textContent).not.toContain("Thread could not be found.");
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
    expect(container!.textContent).not.toContain("Thread could not be found.");
    await waitForProjectDraft();
    expect(container!.querySelector("h1")?.textContent).toBe("New thread");
    expect(container!.querySelector("[data-composer-editor='true']")).not.toBe(null);
  });

  it("restores an Archived Thread in Settings", async () => {
    const saved = await renderApp(
      lifecycleState(["thread-1"]),
      "/settings?tab=archives",
      [],
      false,
      [],
      false,
    );

    expect(container!.textContent).toContain("Primary Thread");
    await click(buttonNamed("Restore"));

    expect(currentPathname).toBe("/settings");
    expect(
      saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.archived,
    ).toBeUndefined();
    expect(saved.at(-1)?.threads?.find((thread) => thread.id === "thread-1")?.lastActivityAt).toBe(
      "2026-07-27T10:00:00.000Z",
    );
    expect(container!.textContent).toContain('"Primary Thread" was restored.');
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
    expect(buttonNamed("Permanently delete Primary Thread").disabled).toBe(true);

    releaseSave();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(cleanupRequests).toHaveLength(0);
  });

  it("keeps an Archived Thread when permanent deletion confirmation is canceled", async () => {
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    await renderApp(lifecycleState(["thread-1"]), "/settings?tab=archives", [], false, [], false, {
      deleteThreadDataRequests: cleanupRequests,
    });

    await click(buttonNamed("Permanently delete Primary Thread"));

    expect(container!.textContent).toContain('Permanently delete "Primary Thread"');

    await click(buttonNamed("Cancel"));

    expect(cleanupRequests).toHaveLength(0);
    expect(container!.textContent).toContain("Primary Thread");
  });

  it("permanently deletes an Archived Thread and keeps the rest listed", async () => {
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    const saved = await renderApp(
      lifecycleState(["thread-1", "thread-2"]),
      "/settings?tab=archives",
      [],
      false,
      [],
      false,
      { deleteThreadDataRequests: cleanupRequests },
    );

    await click(buttonNamed("Permanently delete Primary Thread"));
    await click(buttonNamed("Delete"));

    expect(currentPathname).toBe("/settings");
    expect(cleanupRequests).toEqual([
      { threadIds: ["thread-1"], attachmentStorageKeys: ["attachment-1.txt"] },
    ]);
    expect(saved.at(-1)?.threads?.map((thread) => thread.id)).toEqual(["thread-2"]);
    expect(saved.at(-1)?.threadMessages).toEqual([]);
    expect(saved.at(-1)?.threadRuns).toEqual([]);
    expect(terminalCloseProjectRequests).toEqual([]);
    expect(container!.textContent).toContain("Secondary Thread");
  });

  it("preserves another Thread's live updates while permanent deletion is pending", async () => {
    let releaseDeletion!: () => void;
    const deletionGate = new Promise<void>((resolve) => {
      releaseDeletion = resolve;
    });
    const requests: ChatTurnRequest[] = [];
    await renderApp(
      lifecycleState(["thread-1"]),
      "/workspace/workspace-1/project/project-1/thread/thread-2",
      [],
      false,
      requests,
      false,
      { deleteThreadTransactionGate: deletionGate },
    );

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Keep this live update",
    );
    await click(composerSendButton());
    await act(async () => {
      testNavigate!("/settings?tab=archives");
    });
    await click(buttonNamed("Permanently delete Primary Thread"));
    await click(buttonNamed("Delete"));

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

  it("keeps the remaining Archived Threads listed after deleting a middle item", async () => {
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

    await click(buttonNamed("Permanently delete Secondary Thread"));
    await click(buttonNamed("Delete"));

    expect(container!.textContent).toContain("Primary Thread");
    expect(container!.querySelector('[aria-label="Permanently delete Secondary Thread"]')).toBe(
      null,
    );
    expect(container!.textContent).toContain("Tertiary Thread");
  });

  it("keeps an Archived Thread when permanent cleanup fails", async () => {
    const cleanupRequests: DeleteThreadDataRequest[] = [];
    const saved = await renderApp(
      lifecycleState(["thread-1"]),
      "/settings?tab=archives",
      [],
      false,
      [],
      false,
      { deleteThreadDataRequests: cleanupRequests, deleteThreadDataFails: true },
    );

    await click(buttonNamed("Permanently delete Primary Thread"));
    await click(buttonNamed("Delete"));

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

    expect(container!.textContent).toContain(
      'Remove "Carrent" from "Personal"? This permanently deletes 1 Thread.',
    );

    await click(buttonNamed("Delete Project"));

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
    const saved = await renderApp(appState, "/workspace/workspace-2", [], false, [], false, {
      deleteThreadDataRequests: cleanupRequests,
    });

    await click(buttonNamed("Delete Workspace"));

    expect(container!.textContent).toContain('Delete "Client" and permanently delete 1 Thread?');

    await click(buttonNamed("Delete"));

    expect(currentPathname).toBe("/workspace/workspace-3");
    expect(container!.textContent).not.toContain("Workspace could not be found.");
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
    await click(buttonNamed("Delete"));

    expect(currentPathname).toBe("/workspace/workspace-1");
    expect(saved.at(-1)?.activeWorkspaceId).toBe("workspace-1");
    expect(container!.querySelector("h1")?.textContent).toBe("Personal");
  });

  it("opens global first use after deleting the only Workspace", async () => {
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
    await click(buttonNamed("Delete"));

    expect(currentPathname).toBe("/");
    expect(container!.textContent).not.toContain("Workspace could not be found.");
    expect(saved.at(-1)?.workspaces).toEqual([]);
    expect(saved.at(-1)?.activeWorkspaceId).toBe(null);
    expect(container!.textContent).toContain("Create your first Workspace");
  });

  it("keeps the confirmation open and shows an error when Workspace deletion fails", async () => {
    const cleanupRequests: DeleteThreadDataRequest[] = [];
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
      [],
      false,
      [],
      false,
      { deleteThreadDataRequests: cleanupRequests, deleteThreadDataFails: true },
    );

    await click(buttonNamed("Delete Workspace"));
    await click(buttonNamed("Delete"));

    expect(cleanupRequests).toHaveLength(1);
    expect(saved).toHaveLength(0);
    expect(currentPathname).toBe("/workspace/workspace-1");
    expect(container!.textContent).toContain("Workspace could not be deleted: cleanup failed");
    expect(container!.textContent).toContain("Delete Workspace?");
  });

  it("blocks Association and Workspace removal before confirmation while an affected Run is live", async () => {
    const requests: ChatTurnRequest[] = [];
    await renderApp(
      lifecycleState(),
      "/workspace/workspace-1/project/project-1/thread/thread-1",
      [],
      false,
      requests,
      false,
    );

    await fillComposerEditor(
      container!.querySelector("[data-composer-editor='true']")!,
      "Keep this Run alive",
    );
    await click(composerSendButton());

    await click(buttonNamed("More actions for Carrent"));
    expect(buttonNamed("Delete").disabled).toBe(true);
    expect(buttonNamed("Delete").title).toContain("live Run");
    await act(async () => {
      testNavigate!("/workspace/workspace-1");
    });
    expect(buttonNamed("Delete Workspace").disabled).toBe(true);
    expect(buttonNamed("Delete Workspace").title).toContain("live Run");
    expect(container!.querySelector('[role="dialog"]')).toBe(null);

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
    const saved = await renderApp(appState, "/workspace/workspace-1", [], false, [], false, {
      deleteThreadDataRequests: cleanupRequests,
    });

    await click(buttonNamed("More actions for Carrent"));
    await click(buttonNamed("Delete"));
    await click(buttonNamed("Delete Project"));

    expect(cleanupRequests).toEqual([{ threadIds: [], attachmentStorageKeys: [] }]);
    expect(saved.at(-1)?.projects).toEqual([]);
    expect(saved.at(-1)?.associations).toEqual([]);
    expect(terminalCloseProjectRequests).toEqual(["project-1"]);
    expect(currentPathname).toBe("/workspace/workspace-1");
  });
});

describe("Integrated Terminal", () => {
  const projectState: AppStateSnapshot = {
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
    threads: [],
    threadDrafts: [],
    threadMessages: [],
    threadRuns: [],
    threadPromotionIntents: [],
    lastThreadIdByWorkspace: {},
    activeWorkspaceId: "workspace-1",
  };

  it("keeps two Project terminal viewports synchronized and transfers focus", async () => {
    await renderApp(projectState, "/workspace/workspace-1/project/project-1");
    const secondContainer = document.createElement("div");
    document.body.appendChild(secondContainer);
    const secondRoot = createRoot(secondContainer);
    const findButton = (host: HTMLElement, name: string) =>
      [...host.querySelectorAll<HTMLButtonElement>("button")].find(
        (button) =>
          button.getAttribute("aria-label") === name || button.textContent?.trim() === name,
      )!;

    try {
      await act(async () => {
        secondRoot.render(
          <MemoryRouter initialEntries={["/workspace/workspace-1/project/project-1"]}>
            <App />
          </MemoryRouter>,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      await act(async () => {
        findButton(container!, "Show Integrated Terminal").click();
        findButton(secondContainer, "Show Integrated Terminal").click();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      expect(terminalCreateRequests).toHaveLength(1);
      expect(container!.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(1);
      expect(secondContainer.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(1);

      await act(async () => {
        findButton(secondContainer, "New Terminal Tab").click();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(container!.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(2);
      expect(secondContainer.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(2);

      await act(async () => {
        container!.querySelectorAll<HTMLButtonElement>('[role="tab"] > button')[0].click();
        await new Promise((resolve) => setTimeout(resolve, 20));
        emitTerminalEvent?.({
          type: "output",
          projectId: "project-1",
          terminalId: "terminal-1",
          data: "shared viewport output\r\n",
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(container!.querySelector('[role="tab"]')?.getAttribute("aria-selected")).toBe("true");
      expect(secondContainer.querySelector('[role="tab"]')?.getAttribute("aria-selected")).toBe(
        "true",
      );
      expect(container!.querySelector(".xterm-rows")?.textContent).toContain(
        "shared viewport output",
      );
      expect(secondContainer.querySelector(".xterm-rows")?.textContent).toContain(
        "shared viewport output",
      );

      const firstInput = container!.querySelector<HTMLElement>(".xterm-helper-textarea")!;
      const secondInput = secondContainer.querySelector<HTMLElement>(".xterm-helper-textarea")!;
      await act(async () => {
        firstInput.focus();
        secondInput.focus();
        window.dispatchEvent(new window.FocusEvent("blur"));
      });
      expect(terminalFocusRequests.slice(-4).map((request) => request.focused)).toEqual([
        true,
        false,
        true,
        false,
      ]);
      expect(terminalFocusRequests.at(-1)).toMatchObject({
        projectId: "project-1",
        terminalId: "terminal-1",
        focused: false,
      });

      await act(async () => {
        findButton(container!, "Close Carrent 2").click();
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(container!.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(1);
      expect(secondContainer.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(1);
    } finally {
      await act(async () => secondRoot.unmount());
      secondContainer.remove();
    }
  });

  it("starts closed and creates the first Terminal Tab only when opened", async () => {
    await renderApp(projectState, "/workspace/workspace-1/project/project-1");

    expect(terminalCreateRequests).toHaveLength(0);
    const toggle = buttonNamed("Show Integrated Terminal");
    expect(
      container!
        .querySelector('section[aria-label="Integrated Terminal"]')
        ?.classList.contains("hidden"),
    ).toBe(true);

    await click(toggle);

    expect(terminalCreateRequests).toEqual([
      {
        projectId: "project-1",
        projectName: "Carrent",
        workingDirectory: "/code/carrent",
        enhancedCompletion: true,
        ensureFirst: true,
      },
    ]);
    expect(
      container!
        .querySelector('section[aria-label="Integrated Terminal"]')
        ?.classList.contains("hidden"),
    ).toBe(false);

    await act(async () => {
      emitTerminalEvent?.({
        type: "output",
        projectId: "project-1",
        terminalId: "terminal-1",
        data: "visible terminal output\r\n",
      });
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(container!.querySelector(".xterm-rows")?.textContent).toContain(
      "visible terminal output",
    );

    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "j", metaKey: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container!
        .querySelector('section[aria-label="Integrated Terminal"]')
        ?.classList.contains("hidden"),
    ).toBe(true);
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "j", metaKey: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(terminalCreateRequests).toHaveLength(1);

    await act(async () => {
      emitTerminalEvent?.({
        type: "completion",
        projectId: "project-1",
        terminalId: "terminal-1",
        commandLine: "git sw",
        cursor: 6,
        predictionSuffix: "itch main",
        candidates: [],
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.textContent).toContain("itch main");

    await act(async () => {
      emitTerminalEvent?.({
        type: "completion",
        projectId: "project-1",
        terminalId: "terminal-1",
        commandLine: "git switch",
        cursor: 6,
        predictionSuffix: "",
        candidates: Array.from({ length: 13 }, (_, index) => ({
          label: index === 0 ? "switch" : `switch-${index}`,
          insertText: index === 0 ? "switch" : `switch-${index}`,
          description: "Switch branches",
          kind: "command" as const,
          replacement: { start: 4, end: 10 },
        })),
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector('[role="listbox"]')?.textContent).toContain("switch");
    expect(container!.querySelectorAll('[role="option"]')).toHaveLength(12);
    const terminalInput = container!.querySelector<HTMLElement>(".xterm-helper-textarea")!;
    await act(async () => {
      terminalInput.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      container!.querySelector('[role="listbox"]')?.getAttribute("aria-activedescendant"),
    ).toBe("terminal-candidate-11");
    await click(container!.querySelector<HTMLButtonElement>('[role="option"]')!);
    expect(terminalWriteRequests).toEqual([
      {
        projectId: "project-1",
        terminalId: "terminal-1",
        data: "\u007f\u007f\u001b[3~\u001b[3~\u001b[3~\u001b[3~switch",
      },
    ]);
  });

  it("hides the action when the Project Working Directory is unavailable", async () => {
    await renderApp(
      projectState,
      "/workspace/workspace-1/project/project-1",
      [],
      false,
      [],
      false,
      { projectDirectoryAvailable: false },
    );

    expect(
      [...container!.querySelectorAll("button")].some(
        (button) => button.getAttribute("aria-label") === "Show Integrated Terminal",
      ),
    ).toBe(false);
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { key: "j", metaKey: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(terminalCreateRequests).toHaveLength(0);
  });

  it("maximizes the terminal across the main content area and restores its panel height", async () => {
    await renderApp(projectState, "/workspace/workspace-1/project/project-1");
    await click(buttonNamed("Show Integrated Terminal"));
    const section = container!.querySelector<HTMLElement>(
      'section[aria-label="Integrated Terminal"]',
    )!;

    expect(section.style.height).toBe("320px");
    const maximizeButton = buttonNamed("Maximize Integrated Terminal");
    expect(maximizeButton.getAttribute("aria-pressed")).toBe("false");
    await click(maximizeButton);
    expect(buttonNamed("Restore Integrated Terminal").getAttribute("aria-pressed")).toBe("true");
    expect(section.style.height).toBe("");
    expect(section.querySelector('[aria-label="Resize Integrated Terminal"]') == null).toBe(true);

    await click(buttonNamed("Restore Integrated Terminal"));
    expect(buttonNamed("Maximize Integrated Terminal").getAttribute("aria-pressed")).toBe("false");
    expect(section.style.height).toBe("320px");
    expect(section.querySelector('[aria-label="Resize Integrated Terminal"]') != null).toBe(true);

    await click(buttonNamed("Maximize Integrated Terminal"));
    await click(buttonNamed("Hide Integrated Terminal"));
    await click(buttonNamed("Show Integrated Terminal"));
    expect(buttonNamed("Maximize Integrated Terminal").getAttribute("aria-pressed")).toBe("false");
  });

  it("creates multiple Terminal Tabs and hides after closing the final Tab", async () => {
    await renderApp(projectState, "/workspace/workspace-1/project/project-1");
    await click(buttonNamed("Show Integrated Terminal"));
    await click(buttonNamed("New Terminal Tab"));

    expect(terminalCreateRequests).toHaveLength(2);
    expect(container!.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(2);

    const closeButtons = [
      ...container!.querySelectorAll<HTMLButtonElement>('button[title="Close Terminal Tab"]'),
    ];
    await click(closeButtons[1]);
    expect(container!.querySelectorAll('[role="tablist"] [role="tab"]')).toHaveLength(1);
    await click(container!.querySelector<HTMLButtonElement>('button[title="Close Terminal Tab"]')!);

    expect(
      container!
        .querySelector('section[aria-label="Integrated Terminal"]')
        ?.classList.contains("hidden"),
    ).toBe(true);
    await click(buttonNamed("Show Integrated Terminal"));
    expect(terminalCreateRequests).toHaveLength(3);
  });

  it("keeps terminal output isolated while navigating between Projects", async () => {
    const twoProjectState: AppStateSnapshot = {
      ...projectState,
      projects: [
        ...projectState.projects,
        { id: "project-2", name: "Other", workingDirectory: "/code/other" },
      ],
      associations: [
        ...projectState.associations,
        {
          workspaceId: "workspace-1",
          projectId: "project-2",
          order: 1,
          defaultRuntimeId: "kimi",
          defaultRuntimeMode: "approval-required",
        },
      ],
    };
    await renderApp(twoProjectState, "/workspace/workspace-1/project/project-1");
    await click(buttonNamed("Show Integrated Terminal"));
    await act(async () => {
      emitTerminalEvent?.({
        type: "output",
        projectId: "project-1",
        terminalId: "terminal-1",
        data: "project-one-output\r\n",
      });
      testNavigate?.("/workspace/workspace-1/project/project-2");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(terminalCreateRequests.map((request) => request.projectId)).toEqual([
      "project-1",
      "project-2",
    ]);
    expect(container!.querySelector('[role="tab"]')?.textContent).toContain("Other");
    await act(async () => {
      emitTerminalEvent?.({
        type: "output",
        projectId: "project-2",
        terminalId: "terminal-2",
        data: "project-two-output\r\n",
      });
      testNavigate?.("/workspace/workspace-1/project/project-1");
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(terminalCreateRequests).toHaveLength(2);
    expect(container!.querySelector('[role="tab"]')?.textContent).toContain("Carrent");
    expect(container!.querySelector('[aria-label="Carrent"] .xterm-rows')?.textContent).toContain(
      "project-one-output",
    );
    expect(
      container!.querySelector('[aria-label="Carrent"] .xterm-rows')?.textContent,
    ).not.toContain("project-two-output");
  });

  it("supports dynamic titles, focused search, and the terminal context menu", async () => {
    await renderApp(projectState, "/workspace/workspace-1/project/project-1");
    await click(buttonNamed("Show Integrated Terminal"));
    await act(async () => {
      emitTerminalEvent?.({
        type: "title",
        projectId: "project-1",
        terminalId: "terminal-1",
        title: "remote host",
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector('[role="tab"]')?.textContent).toContain("remote host");

    const terminalInput = container!.querySelector<HTMLElement>(".xterm-helper-textarea")!;
    await act(async () => {
      terminalInput.dispatchEvent(
        new window.KeyboardEvent("keydown", { key: "f", metaKey: true, bubbles: true }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container!.querySelector('input[aria-label="Search terminal output"]') != null).toBe(
      true,
    );
    expect(terminalWriteRequests).toEqual([]);

    const section = container!.querySelector<HTMLElement>(
      'section[aria-label="Integrated Terminal"]',
    )!;
    await act(async () => {
      section.dispatchEvent(
        new window.MouseEvent("contextmenu", {
          bubbles: true,
          clientX: 20,
          clientY: 20,
        }),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const menuItems = container!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]');
    expect([...menuItems].map((item) => item.textContent)).toEqual([
      "Copy",
      "Paste",
      "Select All",
      "Clear",
      "Terminate Current Terminal",
    ]);
    expect(menuItems[0].disabled).toBe(true);
  });
});
