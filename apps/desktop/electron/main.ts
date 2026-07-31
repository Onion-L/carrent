import { app, BrowserWindow, ipcMain, shell, dialog, clipboard, webContents } from "electron";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureCliPaths } from "./runtime/processPath";
import { registerRuntimeIpc } from "./runtime/runtimeIpc";
import { registerChatIpc } from "./chat/chatIpc";
import { createChatSessionManager, type ChatSessionManager } from "./chat/chatSessionManager";
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
import {
  clearStagedAppStateSnapshot,
  getStagedAppStateSnapshot,
  registerAppStateIpc,
  setAppStateTransactionActive,
} from "./workspace/appStateIpc";
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
import { createMainWindowLifecycle } from "./mainWindowLifecycle";
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

let mainWindow: BrowserWindow | null = null;
let appStateStore: AppStateStore | null = null;
let chatSessionManager: ChatSessionManager | null = null;
let waitForThreadDeletion: (() => Promise<void>) | null = null;
let liveRunQuitWarning: ReturnType<typeof createLiveRunQuitWarning> | null = null;
let terminalSessionManager: TerminalSessionManager | null = null;

const mainWindowLifecycle = createMainWindowLifecycle({
  getMainWindow: () => mainWindow,
  isQuitting: () => appShutdown.isQuitting(),
  requestQuit: () => app.quit(),
  onRendererLoading: () => {
    const ownerId = mainWindow?.webContents.id;
    if (ownerId != null) terminalSessionManager?.closeOwner(ownerId);
    void chatSessionManager?.shutdown().catch((error) => {
      console.error("[app] failed to stop Runs while reloading the Renderer", error);
    });
  },
});

const windowZoom = createWindowZoomController(() => mainWindow?.webContents ?? null);

function createWindow(icon: string | undefined) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindowLifecycle.focusMainWindow();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
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
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow?.maximize();
    mainWindow?.show();
  });

  mainWindow.on("close", (event) => {
    mainWindowLifecycle.handleWindowClose(event);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.webContents.on("did-start-navigation", (event) => {
    mainWindowLifecycle.handleRendererNavigationStart(event);
  });

  mainWindow.webContents.on("before-input-event", (event, input) => {
    windowZoom.handleBeforeInput(event, input);
  });

  mainWindow.webContents.on("zoom-changed", (event, direction) => {
    windowZoom.handleZoomChanged(event, direction);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return mainWindow;
  }

  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  return mainWindow;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.setAsDefaultProtocolClient("carrent");
  app.on("second-instance", (_event, argv) => {
    mainWindowLifecycle.handleSecondInstance(argv);
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    mainWindowLifecycle.handleOpenUrl(url);
  });
  ipcMain.on("app:navigation-ready", () => {
    mainWindowLifecycle.handleRendererReady();
  });
  ipcMain.handle("app:zoom:get", (event) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Unknown zoom request sender.");
    return windowZoom.getFactor();
  });
  ipcMain.handle("app:zoom:change", (event, action: MainWindowZoomAction) => {
    if (event.sender !== mainWindow?.webContents) throw new Error("Unknown zoom request sender.");
    if (action !== "in" && action !== "out" && action !== "reset") {
      throw new Error("Invalid zoom action.");
    }
    return windowZoom.change(action);
  });
  mainWindowLifecycle.handleSecondInstance(process.argv);

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
        if (mainWindow?.webContents.id === ownerId && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send("terminal:event", event);
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
      publish: (subscriberId, state) => {
        const contents = webContents.fromId(subscriberId);
        if (contents && !contents.isDestroyed()) {
          contents.send("app-state:changed", state);
        }
      },
    });
    registerAppStateAuthorityIpc(guardedIpcMain, appStateAuthority);
    const setAppStateTransactionActiveEverywhere = (active: boolean) => {
      setAppStateTransactionActive(active);
      appStateAuthority.setTransactionActive(active);
    };
    registerAppStateIpc(guardedIpcMain, store, startupAppStateResult, async (result, source) => {
      const applied = await appStateLifecycle.apply(result, source);
      appStateAuthority.replaceState(applied);
      return applied;
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

    const emitChatEvent = (event: unknown) => {
      mainWindow?.webContents.send("chat:event", event);
    };

    const providerSessionsSnapshot = await loadProviderSessionsForAppState(
      store,
      startupAppStateResult,
    );

    providerSessionStore = createPersistentProviderSessionStore(store, providerSessionsSnapshot);
    const sessionManager = createChatSessionManager({
      emit: emitChatEvent as (event: { type: string }) => void,
      spawn,
      providerSessions: providerSessionStore,
      attachmentStore,
      carrentBridgeFactory: async () => {
        return bridgeManager.getRuntimeHandle();
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
    });
    waitForThreadDeletion = threadDeletionManager.waitForIdle;
    registerChatIpc(guardedIpcMain, {
      sessionManager,
      isProjectDirectoryAvailable,
      threadDeletionManager,
    });
    createWindow(icon);

    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        createWindow(icon);
      } else {
        mainWindowLifecycle.focusMainWindow();
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
    const stagedAppState = getStagedAppStateSnapshot();
    if (stagedAppState && appStateStore) {
      await appStateStore.saveAppStateSnapshot(stagedAppState);
      clearStagedAppStateSnapshot();
    }
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
