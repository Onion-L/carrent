import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  clipboard,
  webContents,
  screen,
} from "electron";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureCliPaths } from "./runtime/processPath";
import { registerRuntimeIpc } from "./runtime/runtimeIpc";
import { registerChatIpc } from "./chat/chatIpc";
import { createChatSessionManager, type ChatSessionManager } from "./chat/chatSessionManager";
import { createChatRunAuthority, type ChatRunAuthority } from "./chat/chatRunAuthority";
import {
  createThreadDeletionJournalStore,
  createThreadDeletionTransactionManager,
  recoverThreadDeletionTransaction,
} from "./chat/threadDeletionTransaction";
import {
  createPersistentProviderSessionStore,
  type PersistentProviderSessionStore,
} from "./chat/providerSessionStore";
import { createAppStateStore } from "./workspace/appStateStore";
import {
  createAppStateAuthority,
  registerAppStateAuthorityIpc,
} from "./workspace/appStateAuthority";
import { appStateCommandReducers } from "./workspace/appStateCommands";
import { registerAppStateIpc } from "./workspace/appStateIpc";
import { createAppStateFlush } from "./workspace/appStateFlush";
import { createAppShutdown } from "./appShutdown";
import {
  createProjectRelocationManager,
  isProjectDirectoryAvailable,
  registerProjectDirectoryIpc,
} from "./workspace/projectDirectory";
import type { AppStateStore } from "./workspace/appStateStore";
import { createAttachmentStore } from "./attachments/attachmentStore";
import { reconcileAttachmentsAfterValidStateLoad } from "./attachments/attachmentReconciliation";
import { registerAttachmentIpc } from "./attachments/attachmentIpc";
import { registerSkillIpc } from "./skills/skillIpc";
import { registerGitIpc } from "./git/gitIpc";
import {
  createCarrentBridgeManager,
  createMcpServerPreferenceStore,
} from "./bridge/carrentBridgeManager";
import { registerMcpServerIpc } from "./bridge/mcpServerIpc";
import { registerSettingsIpc } from "./settings/settingsIpc";
import { registerDialogIpc } from "./dialog/dialogIpc";
import { spawn } from "node:child_process";
import {
  cascadeWindowBounds,
  type WindowBounds,
} from "./carrentWindowGeometry";
import { openThreadInNewWindow } from "./carrentWindowOpener";
import { createCarrentWindowRegistry } from "./carrentWindowRegistry";
import {
  createAppStateIpcGate,
  loadProviderSessionsForAppState,
} from "./workspace/appStateIpcGate";
import { createAppStateLifecycle } from "./workspace/appStateLifecycle";
import {
  createLiveRunQuitWarning,
  createLiveRunQuitWarningPreferenceStore,
} from "./liveRunQuitWarning";
import {
  createTerminalSessionManager,
  type TerminalSessionManager,
} from "./terminal/terminalSessionManager";
import { nodePtyAdapter } from "./terminal/nodePtyAdapter";
import { registerTerminalIpc } from "./terminal/terminalIpc";
import { createTerminalCompletionService } from "./terminal/completion/completionService";
import { createTerminalHistory, parseZshHistory } from "./terminal/completion/history";
import { readHistoryTail } from "./terminal/completion/historyFile";
import { createZshShellIntegration } from "./terminal/completion/shellIntegration";
import { createWindowZoomController } from "./windowZoom";
import type { MainWindowZoomAction } from "../src/shared/mainWindow";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveIconPath() {
  const iconPath = [
    join(app.getAppPath(), "build", "icon.png"),
    join(__dirname, "../../build/icon.png"),
  ].find((candidate) => existsSync(candidate));

  return iconPath;
}

function isExecutableFile(path: string) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

let appStateStore: AppStateStore | null = null;
let chatSessionManager: ChatSessionManager | null = null;
let chatRunAuthority: ChatRunAuthority | null = null;
let waitForThreadDeletion: (() => Promise<void>) | null = null;
let appStateFlush: ReturnType<typeof createAppStateFlush> | null = null;
let liveRunQuitWarning: ReturnType<typeof createLiveRunQuitWarning> | null = null;
let terminalSessionManager: TerminalSessionManager | null = null;

// Carrent Windows are peers: every window provides complete navigation and
// owns only its route, history, and presentation state. The registry tracks
// activation order, per-window renderer readiness, and the close decision;
// there is no privileged Main Window.
const windowRegistry = createCarrentWindowRegistry();

const zoomControllersByContentsId = new Map<
  number,
  ReturnType<typeof createWindowZoomController>
>();

function getZoomController(contentsId: number) {
  return zoomControllersByContentsId.get(contentsId) ?? null;
}

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 840;

function resolveNormalBounds(window: BrowserWindow): WindowBounds {
  // The *normal* (un-maximized) bounds, so a maximized source window never
  // makes the new window inherit its maximized size or position.
  const { x, y, width, height } = window.getNormalBounds();
  return { x, y, width, height };
}

function createWindow(
  icon: string | undefined,
  options: { initialPath?: string; source?: BrowserWindow | null } = {},
) {
  // A new window opens on the source window's display. When there is no source
  // (Dock activation, first window) it opens on the primary display.
  const cascadeFrom = options.source && !options.source.isDestroyed() ? options.source : null;

  const constructorOptions: Electron.BrowserWindowConstructorOptions = {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#181818",
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    show: false,
    ...(icon && process.platform !== "darwin" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  };

  // A new window opens on the source window's display, inherits the source's
  // *normal* bounds, and is cascaded ~24px down and right within the display
  // work area. A maximized source never makes the new window start maximized.
  if (cascadeFrom && !cascadeFrom.isDestroyed()) {
    const display = screen.getDisplayMatching(cascadeFrom.getBounds());
    const cascaded = cascadeWindowBounds(resolveNormalBounds(cascadeFrom), display.workArea);
    Object.assign(constructorOptions, {
      x: cascaded.x,
      y: cascaded.y,
      width: cascaded.width,
      height: cascaded.height,
    });
  }

  const window = new BrowserWindow(constructorOptions);
  windowRegistry.register(window);
  if (options.initialPath) {
    // The initial route survives the new renderer's own initial load (which
    // would otherwise clear a pending navigation) and is delivered on first
    // renderer readiness.
    windowRegistry.setInitialRoute(window.webContents.id, options.initialPath);
  }

  window.on("focus", () => windowRegistry.setActive(window.id));

  window.on("ready-to-show", () => {
    // A peer window opens at its inherited normal bounds; only the first
    // window of an otherwise empty session maximizes on ready-to-show.
    if (cascadeFrom && !cascadeFrom.isDestroyed()) {
      window.show();
    } else {
      window.maximize();
      window.show();
    }
  });

  window.on("close", (event) => {
    // While Carrent is quitting every window closes normally.
    if (appShutdown.isQuitting()) return;
    const decision = windowRegistry.decideClose(window.id);
    if (decision.kind === "close") return;
    // The final Carrent Window either hides (macOS) or requests Quit. Closing
    // one of several windows is always a plain close, so only the final-window
    // decision prevents the BrowserWindow close here.
    event.preventDefault();
    if (decision.kind === "hide") {
      window.hide();
    } else {
      app.quit();
    }
  });

  window.on("closed", () => {
    zoomControllersByContentsId.delete(window.webContents.id);
    windowRegistry.unregister(window.id);
  });

  window.webContents.on("did-start-navigation", (event) => {
    if (event.isSameDocument || !event.isMainFrame) return;
    windowRegistry.markLoading(window.webContents.id, event);
    // Terminal Tabs are Project-owned; a reloading Renderer detaches from its
    // Tabs without terminating them. (Cross-window Terminal sharing is 07.)
    terminalSessionManager?.closeOwner(window.webContents.id);
  });

  const zoomController = createWindowZoomController(() =>
    window.isDestroyed() ? null : window.webContents,
  );
  zoomControllersByContentsId.set(window.webContents.id, zoomController);
  window.webContents.on("before-input-event", (event, input) => {
    zoomController.handleBeforeInput(event, input);
  });

  window.webContents.on("zoom-changed", (event, direction) => {
    zoomController.handleZoomChanged(event, direction);
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return window;
  }

  window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.setAsDefaultProtocolClient("carrent");
  app.on("second-instance", (_event, argv) => {
    windowRegistry.handleSecondInstance(argv);
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    windowRegistry.handleOpenUrl(url);
  });
  ipcMain.on("app:navigation-ready", (event) => {
    windowRegistry.markReady(event.sender.id);
  });
  ipcMain.handle("app:zoom:get", (event) => {
    const zoom = getZoomController(event.sender.id);
    if (!zoom) throw new Error("Unknown zoom request sender.");
    return zoom.getFactor();
  });
  ipcMain.handle("app:zoom:change", (event, action: MainWindowZoomAction) => {
    const zoom = getZoomController(event.sender.id);
    if (!zoom) throw new Error("Unknown zoom request sender.");
    if (action !== "in" && action !== "out" && action !== "reset") {
      throw new Error("Invalid zoom action.");
    }
    return zoom.change(action);
  });
  ipcMain.handle("windows:open-thread", async (event, route: unknown) => {
    const source = BrowserWindow.fromWebContents(event.sender);
    const sourceAdapter = source
      ? {
          isDestroyed: () => source.isDestroyed(),
          reportOpenError: (message: string) => {
            if (!source.isDestroyed()) source.webContents.send("windows:open-error", message);
          },
        }
      : null;
    openThreadInNewWindow({
      route,
      source: sourceAdapter,
      create: (validRoute) => createWindow(resolveIconPath(), { initialPath: validRoute, source }),
    });
  });
  windowRegistry.handleSecondInstance(process.argv);

  app.whenReady().then(async () => {
    ensureCliPaths();

    const icon = resolveIconPath();

    if (process.platform === "darwin" && icon && !app.isPackaged) {
      app.dock?.setIcon(icon);
    }

    const userDataPath = app.getPath("userData");
    liveRunQuitWarning = createLiveRunQuitWarning({
      preferenceStore: createLiveRunQuitWarningPreferenceStore(userDataPath),
      showMessageBox: (options) => dialog.showMessageBox(options),
      reportError: (error) =>
        console.error("[app] failed to persist quit warning preference", error),
    });
    await liveRunQuitWarning.initialize();
    const store = createAppStateStore(userDataPath, { appVersion: app.getVersion() });
    const appStateInitialization = await store.initializeAppState();
    const appStateIpcGate = createAppStateIpcGate(ipcMain, {
      status: "recovery-required",
      diagnostics: [],
    });
    const guardedIpcMain = appStateIpcGate.ipcMain;
    let providerSessionStore: PersistentProviderSessionStore | null = null;
    appStateStore = store;
    registerRuntimeIpc(guardedIpcMain);

    const attachmentStore = createAttachmentStore(userDataPath);
    if (
      !attachmentStore.prepareDeletion ||
      !attachmentStore.commitDeletion ||
      !attachmentStore.rollbackDeletion
    ) {
      throw new Error("Transactional attachment cleanup is unavailable.");
    }
    const transactionAttachmentStore = {
      prepareDeletion: attachmentStore.prepareDeletion,
      commitDeletion: attachmentStore.commitDeletion,
      rollbackDeletion: attachmentStore.rollbackDeletion,
    };
    const threadDeletionJournalStore = createThreadDeletionJournalStore(userDataPath);
    registerAttachmentIpc(guardedIpcMain, { attachmentStore });
    registerSkillIpc(guardedIpcMain);
    registerGitIpc(guardedIpcMain);
    registerSettingsIpc(guardedIpcMain);
    const terminalCompletionService = createTerminalCompletionService();
    const terminalHistory = createTerminalHistory(
      parseZshHistory(readHistoryTail(join(app.getPath("home"), ".zsh_history"))),
    );
    terminalSessionManager = createTerminalSessionManager({
      pty: nodePtyAdapter,
      emit: (ownerId, event) => {
        // Terminal Tabs are owned by the Carrent Window (Renderer) that created
        // them; output fans out to that owner only. Cross-window Terminal
        // sharing lands in 07.
        const contents = webContents.fromId(ownerId);
        if (contents && !contents.isDestroyed()) {
          contents.send("terminal:event", event);
        }
      },
      isExecutable: isExecutableFile,
      history: terminalHistory,
      complete: (input) => terminalCompletionService.complete(input),
      createShellIntegration: (input) =>
        createZshShellIntegration({ ...input, baseDirectory: app.getPath("temp") }),
    });
    registerTerminalIpc(guardedIpcMain, terminalSessionManager);

    const bridgeManager = createCarrentBridgeManager({
      preferenceStore: createMcpServerPreferenceStore(app.getPath("userData")),
    });
    registerMcpServerIpc(guardedIpcMain, bridgeManager);

    const appStateLifecycle = createAppStateLifecycle({
      recoverThreadDeletion: () =>
        recoverThreadDeletionTransaction({
          journalStore: threadDeletionJournalStore,
          appStateStore: store,
          attachmentStore: transactionAttachmentStore,
        }),
      reloadAppState: () => store.initializeAppState(),
      reconcileAttachments: async (snapshot) => {
        await reconcileAttachmentsAfterValidStateLoad({
          appState: snapshot,
          deleteOrphanedAttachments: attachmentStore.deleteOrphanedAttachments,
        });
      },
      reloadProviderSessions: async () => {
        const snapshot = await store.loadProviderSessions();
        await providerSessionStore?.reinitialize(snapshot);
      },
      clearProviderSessions: async () => {
        await providerSessionStore?.reinitialize({ version: 1, sessions: {} });
      },
      resetRuntimeSessions: () => {
        chatSessionManager?.resetRuntimeSessions?.();
      },
      initializeMcpBridge: () => bridgeManager.initialize(),
      updateIpcGate: (result) => appStateIpcGate.update(result),
    });
    const startupAppStateResult = await appStateLifecycle.apply(appStateInitialization, "startup");
    const appStateAuthority = createAppStateAuthority({
      store,
      initialResult: startupAppStateResult,
      reducers: appStateCommandReducers,
      publish: (subscriberId, state) => {
        const contents = webContents.fromId(subscriberId);
        if (contents && !contents.isDestroyed()) {
          contents.send("app-state:changed", state);
        }
      },
    });
    registerAppStateAuthorityIpc(guardedIpcMain, appStateAuthority);
    const setAppStateTransactionActiveEverywhere = (active: boolean) => {
      appStateAuthority.setTransactionActive(active);
    };
    registerAppStateIpc(guardedIpcMain, store, startupAppStateResult, async (result, source) => {
      const applied = await appStateLifecycle.apply(result, source);
      appStateAuthority.replaceState(applied);
      return applied;
    });
    appStateFlush = createAppStateFlush(guardedIpcMain, appStateAuthority, (subscriberId) => {
      const contents = webContents.fromId(subscriberId);
      return contents && !contents.isDestroyed() ? contents : null;
    });

    registerDialogIpc(guardedIpcMain, () =>
      dialog.showOpenDialog({ properties: ["openDirectory"] }),
    );

    guardedIpcMain.handle("shell:open-path", async (_event, filePath) => {
      if (typeof filePath !== "string") throw new Error("Invalid file path.");
      const result = await shell.openPath(filePath);
      return result;
    });

    guardedIpcMain.handle("shell:reveal-path", async (_event, filePath) => {
      if (typeof filePath !== "string") throw new Error("Invalid file path.");
      shell.showItemInFolder(filePath);
    });

    guardedIpcMain.handle("clipboard:write-text", async (_event, text) => {
      if (typeof text !== "string") throw new Error("Invalid clipboard text.");
      clipboard.writeText(text);
    });

    guardedIpcMain.handle("clipboard:read-text", () => clipboard.readText());

    guardedIpcMain.handle("shell:open-external", async (_event, value) => {
      if (typeof value !== "string" || value.length > 4_096) {
        throw new Error("Invalid external URL.");
      }
      const url = new URL(value);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("Unsupported external URL.");
      }
      await shell.openExternal(url.toString());
    });

    const providerSessionsSnapshot = await loadProviderSessionsForAppState(
      store,
      startupAppStateResult,
    );

    providerSessionStore = createPersistentProviderSessionStore(store, providerSessionsSnapshot);
    const sessionManager = createChatSessionManager({
      emit: (event) => chatRunAuthority?.handleEvent(event),
      spawn,
      providerSessions: providerSessionStore,
      attachmentStore,
      carrentBridgeFactory: async () => {
        return bridgeManager.getRuntimeHandle();
      },
    });
    chatRunAuthority = createChatRunAuthority({
      start: sessionManager.start,
      stop: sessionManager.stop,
      respondToPermission: sessionManager.respondToPermission,
      respondToQuestion: sessionManager.respondToQuestion,
      publish: (subscriberId, state) => {
        const contents = webContents.fromId(subscriberId);
        if (contents && !contents.isDestroyed()) {
          contents.send("chat:changed", state);
        }
      },
    });
    if (!sessionManager.rollbackThreadDataDeletion) {
      throw new Error("Thread data rollback is unavailable.");
    }
    if (
      !sessionManager.hasLiveRunForThreads ||
      !sessionManager.detachRuntimeSessions ||
      !sessionManager.restoreRuntimeSessions ||
      !sessionManager.completeRuntimeSessionDetachment
    ) {
      throw new Error("Project relocation Session cleanup is unavailable.");
    }
    const projectRelocationManager = createProjectRelocationManager({
      appStateStore: store,
      sessionManager: {
        hasLiveRunForThreads: sessionManager.hasLiveRunForThreads,
        detachRuntimeSessions: sessionManager.detachRuntimeSessions,
        restoreRuntimeSessions: sessionManager.restoreRuntimeSessions,
        completeRuntimeSessionDetachment: sessionManager.completeRuntimeSessionDetachment,
      },
      onActiveChange: setAppStateTransactionActiveEverywhere,
      onSnapshotCommitted: (snapshot) => appStateAuthority.adoptExternalSnapshot(snapshot),
    });
    registerProjectDirectoryIpc(guardedIpcMain, { relocationManager: projectRelocationManager });
    chatSessionManager = sessionManager;
    const threadDeletionManager = createThreadDeletionTransactionManager({
      journalStore: threadDeletionJournalStore,
      appStateStore: store,
      attachmentStore: transactionAttachmentStore,
      sessionManager: {
        deleteThreadData: sessionManager.deleteThreadData,
        rollbackThreadDataDeletion: sessionManager.rollbackThreadDataDeletion,
      },
      onActiveChange: setAppStateTransactionActiveEverywhere,
      onSnapshotCommitted: (snapshot) => appStateAuthority.adoptExternalSnapshot(snapshot),
    });
    waitForThreadDeletion = threadDeletionManager.waitForIdle;
    registerChatIpc(guardedIpcMain, {
      sessionManager,
      runAuthority: chatRunAuthority,
      isProjectDirectoryAvailable,
      threadDeletionManager,
    });
    createWindow(icon);

    app.on("activate", () => {
      if (windowRegistry.count() === 0) {
        createWindow(icon);
      } else {
        windowRegistry.focusMostRecent();
      }
    });
  });
}

const appShutdown = createAppShutdown({
  quit: () => app.quit(),
  reportShutdownError: (error) => console.error("[app] failed to quit safely", error),
  beforeSave: async () => {
    await chatSessionManager?.shutdown();
    terminalSessionManager?.shutdown();
    await waitForThreadDeletion?.();
    // Ask renderers to flush pending App State commands, then drain the
    // authority queue so everything typed before quitting is persisted.
    await appStateFlush?.flush();
    await appStateStore?.waitForWrites();
  },
  liveRunQuitPolicy: {
    hasLiveRuns: () => chatSessionManager?.hasLiveRuns?.() ?? false,
    confirmQuitWithLiveRuns: () => liveRunQuitWarning?.confirmQuit() ?? Promise.resolve(true),
    cancelLiveRuns: async () => {
      await chatSessionManager?.shutdown();
    },
  },
});

app.on("before-quit", (event) => {
  void appShutdown.beforeQuit(event);
});

app.on("window-all-closed", () => {
  app.quit();
});
