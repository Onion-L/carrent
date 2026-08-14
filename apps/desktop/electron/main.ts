import {
  app,
  BrowserWindow,
  ipcMain,
  shell,
  dialog,
  clipboard,
  webContents,
  screen,
  type WebContents,
} from "electron";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureCliPaths } from "./runtime/processPath";
import { createLogger, type Logger } from "./diagnostics/logger";
import { registerRuntimeIpc } from "./runtime/runtimeIpc";
import { listKimiRuntimeModels } from "./runtime/runtimeModelLister";
import { registerChatIpc } from "./chat/chatIpc";
import { createChatSessionManager, type ChatSessionManager } from "./chat/chatSessionManager";
import { createChatRunAuthority, type ChatRunAuthority } from "./chat/chatRunAuthority";
import { createKimiAcpProcessTransportFactory } from "./chat/kimiAcpChat";
import {
  createThreadTitleCoordinator,
  registerAcceptedThreadTitlePromotion,
  type ThreadTitleCoordinator,
} from "./chat/threadTitleCoordinator";
import {
  createRunNotificationCoordinator,
  type RunNotificationCoordinator,
} from "./notifications/runNotificationCoordinator";
import { createElectronNotificationAdapter } from "./notifications/systemNotificationAdapter";
import {
  createThreadDeletionJournalStore,
  createThreadDeletionTransactionManager,
  recoverThreadDeletionTransaction,
} from "./chat/threadDeletionTransaction";
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
import { createSqliteAppStateStore } from "./persistence/sqliteAppStateStore";
import { createSqliteAppStateLifecycle } from "./persistence/sqliteAppStateLifecycle";
import {
  createSqliteProductionAppStateStore,
  type SqliteProductionAppStateStore,
} from "./persistence/sqliteProductionAppStateStore";
import { createSqliteProviderSessionStore } from "./persistence/sqliteProviderSessionStore";
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
import { buildWorktreeActivitySnapshot } from "./settings/worktreeActivity";
import { createWorktreeSizeScanner, measureWorktreeDirectorySize } from "./settings/worktreeSizes";
import { registerDialogIpc } from "./dialog/dialogIpc";
import { registerEditorsIpc } from "./editors/editorIpc";
import { spawn } from "node:child_process";
import { cascadeWindowBounds, type WindowBounds } from "./carrentWindowGeometry";
import { consumeWindowCreationSmokeFailure, openThreadInNewWindow } from "./carrentWindowOpener";
import { createCarrentWindowRegistry } from "./carrentWindowRegistry";
import {
  handleCarrentWindowActivation,
  registerCarrentWindowCleanup,
} from "./carrentWindowLifecycle";
import { createCarrentWindowCapture } from "./carrentWindowCapture";
import {
  buildRecoveredWindowOptions,
  captureSession,
  mostRecentRestoredWindow,
  restoreWindows,
  type RestoredWindow,
} from "./carrentWindowSession";
import {
  createCarrentWindowSessionStore,
  type CarrentWindowSessionStore,
} from "./carrentWindowSessionStore";
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
import { createBrowserManager, type BrowserManager } from "./browser/browserManager";
import { registerBrowserIpc } from "./browser/browserIpc";
import { isHttpOrHttpsUrl } from "./browser/browserNavigation";
import type { BrowserThreadTarget } from "../src/shared/browser";
import { resolveDroppedLocalPaths, revealLocalPath } from "./localPathContext";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveIconPath() {
  // Dev runs get the alternate "test" icon so a local build is easy to tell
  // apart from the packaged app in the Dock; packaged builds always use the
  // production icon (the bundle itself carries icon.icns).
  const iconNames = app.isPackaged ? ["icon.png"] : ["icon-dev.png", "icon.png"];
  const iconPath = iconNames
    .flatMap((name) => [
      join(app.getAppPath(), "build", name),
      join(__dirname, "../../build", name),
    ])
    .find((candidate) => existsSync(candidate));

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

let appStateStore: SqliteProductionAppStateStore | null = null;
let chatSessionManager: ChatSessionManager | null = null;
let chatRunAuthority: ChatRunAuthority | null = null;
let threadTitleCoordinator: ThreadTitleCoordinator | null = null;
let runNotificationCoordinator: RunNotificationCoordinator | null = null;
let waitForThreadDeletion: (() => Promise<void>) | null = null;
let appStateFlush: ReturnType<typeof createAppStateFlush> | null = null;
let liveRunQuitWarning: ReturnType<typeof createLiveRunQuitWarning> | null = null;
let terminalSessionManager: TerminalSessionManager | null = null;
let windowSessionStore: CarrentWindowSessionStore | null = null;
let windowCapture: ReturnType<typeof createCarrentWindowCapture> | null = null;
// Lazily created in app.whenReady(). The renderer-gone handler in the window
// factory closes over this, so it must be module-scoped rather than passed in.
let logger: Logger | null = null;
// Most recently active saved window, for Dock activation / repeated launch
// "recent-position recovery" when no Carrent Window exists but a session does.
let recentRestoredWindow: RestoredWindow | null = null;
let browserManager: BrowserManager | null = null;

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

function loadBrowserMenuOverlay(contents: WebContents) {
  const query = { browserMenuOverlay: "1" };
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    url.searchParams.set("browserMenuOverlay", "1");
    void contents.loadURL(url.toString());
  } else {
    void contents.loadFile(join(__dirname, "../renderer/index.html"), { query });
  }
}

function createBrowserWindow(target: BrowserThreadTarget) {
  const window = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 720,
    minHeight: 520,
    backgroundColor: "#181818",
    autoHideMenuBar: true,
    frame: process.platform !== "darwin",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  window.setTitle("Browser");
  window.once("ready-to-show", () => window.show());
  const query = {
    browserWindow: "1",
    threadId: target.threadId,
    projectId: target.projectId,
  };
  if (process.env.ELECTRON_RENDERER_URL) {
    const url = new URL(process.env.ELECTRON_RENDERER_URL);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    void window.loadURL(url.toString());
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"), { query });
  }
  return window;
}

function resolveNormalBounds(window: BrowserWindow): WindowBounds {
  // The *normal* (un-maximized) bounds, so a maximized source window never
  // makes the new window inherit its maximized size or position.
  const { x, y, width, height } = window.getNormalBounds();
  return { x, y, width, height };
}

function createWindow(
  icon: string | undefined,
  options: {
    initialPath?: string;
    source?: BrowserWindow | null;
    restoreBounds?: WindowBounds;
    restoreMaximized?: boolean;
  } = {},
) {
  // A new window opened from a source cascades from that source. A restored or
  // Dock-created window has no source and reuses its saved normal bounds (or,
  // with none, the default size).
  const cascadeFrom = options.source && !options.source.isDestroyed() ? options.source : null;
  const restoreBounds = options.restoreBounds ?? null;

  const constructorOptions: Electron.BrowserWindowConstructorOptions = {
    width: DEFAULT_WINDOW_WIDTH,
    height: DEFAULT_WINDOW_HEIGHT,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#181818",
    autoHideMenuBar: true,
    frame: process.platform !== "darwin",
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

  // A restored window reopens at its saved normal bounds and (optionally)
  // maximized state, so a restart recreates the workspace layout. Otherwise a
  // window opened from a source inherits the source's *normal* bounds and is
  // cascaded ~24px down and right within the display work area; a maximized
  // source never makes the new window start maximized.
  if (restoreBounds) {
    Object.assign(constructorOptions, {
      x: restoreBounds.x,
      y: restoreBounds.y,
      width: restoreBounds.width,
      height: restoreBounds.height,
    });
  } else if (cascadeFrom && !cascadeFrom.isDestroyed()) {
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
  if (process.platform === "darwin") {
    window.setWindowButtonVisibility(true);
  }
  windowRegistry.register(window);
  windowRegistry.setRoute(window.id, options.initialPath ?? "/");
  if (options.initialPath) {
    // The initial route survives the new renderer's own initial load (which
    // would otherwise clear a pending navigation) and is delivered on first
    // renderer readiness.
    windowRegistry.setInitialRoute(window.id, options.initialPath);
  }

  window.on("focus", () => {
    windowRegistry.setActive(window.id);
    browserManager?.focusOwner(window.webContents.id);
  });

  window.on("ready-to-show", () => {
    if (options.restoreMaximized) {
      // A restored maximized window maximizes on open.
      window.maximize();
    } else if (cascadeFrom && !cascadeFrom.isDestroyed()) {
      // A peer window opened from a source shows at its inherited bounds.
    } else if (!restoreBounds) {
      // The first window of an otherwise empty session maximizes on open.
      window.maximize();
    }
    window.show();
  });

  window.on("close", (event) => {
    // While Carrent is quitting every window closes normally.
    if (appShutdown.isQuitting()) return;
    const decision = windowRegistry.decideClose(window.id);
    if (decision.kind === "close" || decision.kind === "destroy") {
      // "close": only this window is affected. "destroy": the final window on
      // macOS is destroyed, leaving Carrent alive at zero windows (Dock
      // activation or a repeated launch re-creates one). In both cases the
      // BrowserWindow closes normally.
      return;
    }
    // The final Carrent Window on Windows and Linux requests application Quit.
    // Closing one of several windows is always a plain close, so only the
    // final-window Quit decision prevents the BrowserWindow close here.
    event.preventDefault();
    app.quit();
  });

  registerCarrentWindowCleanup(window, ({ windowId, contentsId }) => {
    terminalSessionManager?.detach(contentsId);
    zoomControllersByContentsId.delete(contentsId);
    windowRegistry.setTerminalFocused(contentsId, false);
    windowRegistry.unregister(windowId);
    browserManager?.destroyOwner(contentsId);
  });

  window.webContents.on("did-start-navigation", (event) => {
    if (event.isSameDocument || !event.isMainFrame) return;
    windowRegistry.markLoading(window.webContents.id, event);
    windowRegistry.setTerminalFocused(window.webContents.id, false);
    terminalSessionManager?.detach(window.webContents.id);
  });

  const zoomController = createWindowZoomController(() =>
    window.isDestroyed() ? null : window.webContents,
  );
  zoomControllersByContentsId.set(window.webContents.id, zoomController);
  window.webContents.on("before-input-event", (event, input) => {
    zoomController.handleBeforeInput(event, input);
    // macOS: while a terminal holds focus, Cmd+W closes the terminal tab
    // instead of the window. The default app menu binds Cmd+W to Window→Close,
    // which fires at the menu layer before the renderer can see the keydown;
    // preventDefault here blocks that accelerator and we ping the renderer to
    // run its existing close-tab path. When no terminal is focused we do
    // nothing and let the default menu close the window as usual.
    if (
      process.platform === "darwin" &&
      input.type === "keyDown" &&
      !input.control &&
      !input.alt &&
      !input.shift &&
      input.meta &&
      input.key.toLowerCase() === "w" &&
      windowRegistry.isTerminalFocused(window.webContents.id)
    ) {
      event.preventDefault();
      if (!window.isDestroyed()) window.webContents.send("terminal:cmd-w");
    }
  });

  window.webContents.on("zoom-changed", (event, direction) => {
    zoomController.handleZoomChanged(event, direction);
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    // The single most useful diagnostic for a renderer crash: details.reason
    // distinguishes "oom" (memory path) from "crashed" (native CHECK/abort)
    // from "killed", which the macOS .ips cannot tell us. Logged locally only.
    logger?.error("render-gone", "renderer terminated", {
      contentsId: window.webContents.id,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (
      !browserManager?.openForRoute(window.webContents.id, windowRegistry.getRoute(window.id), url)
    ) {
      if (isHttpOrHttpsUrl(url)) {
        void shell.openExternal(url);
      }
    }
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
    return window;
  }

  window.loadFile(join(__dirname, "../renderer/index.html"));
  return window;
}

function createRecoveredWindow(icon: string | undefined, targetRoute: string | null) {
  return createWindow(icon, buildRecoveredWindowOptions(recentRestoredWindow, targetRoute));
}

if (!app.isPackaged) {
  const developmentUserDataPath = `${app.getPath("userData")}-dev`;
  app.setPath("userData", developmentUserDataPath);
  app.setPath("sessionData", developmentUserDataPath);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient("carrent");
  }
  app.on("second-instance", (_event, argv) => {
    const browserUrl = argv.find((value) => value.startsWith("carrent://browser/open"));
    if (browserUrl && browserManager?.handleOpenProtocol(browserUrl)) return;
    const targeting = windowRegistry.handleSecondInstance(argv);
    // A repeated launch with no Carrent Window re-creates one, optionally with
    // the deep-link route as its initial path.
    if (targeting.needsWindow) {
      createRecoveredWindow(resolveIconPath(), targeting.route);
    }
  });
  app.on("open-url", (event, url) => {
    event.preventDefault();
    if (browserManager?.handleOpenProtocol(url)) return;
    const targeting = windowRegistry.handleOpenUrl(url);
    if (targeting.needsWindow) {
      createRecoveredWindow(resolveIconPath(), targeting.route);
    }
  });
  app.on("certificate-error", (event, contents, url, error, _certificate, callback) => {
    if (!browserManager?.handleCertificateError(contents.id, url, error, callback)) return;
    event.preventDefault();
  });
  ipcMain.on("windows:route-changed", (event, route: unknown) => {
    if (typeof route !== "string" || !route.startsWith("/") || route.length > 4_096) return;
    windowRegistry.setRoute(event.sender.id, route);
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
      create: (validRoute) => {
        if (consumeWindowCreationSmokeFailure(process.env)) {
          throw new Error("Simulated BrowserWindow creation failure.");
        }
        createWindow(resolveIconPath(), { initialPath: validRoute, source });
      },
    });
  });
  // A deep link present in the initial launch argv targets the first Carrent
  // Window, which the startup restoration below creates.
  const initialLaunchTargeting = windowRegistry.handleSecondInstance(process.argv);

  app.whenReady().then(async () => {
    ensureCliPaths();

    // Stand up diagnostics before anything else so a crash during startup or
    // run wiring leaves evidence in ~/Library/Logs/Carrent/main.log instead of
    // vanishing with the renderer. The logger never throws; failures fall back
    // to console so a broken logger cannot block boot.
    logger = createLogger({ logDirectory: app.getPath("logs") });
    process.on("uncaughtException", (error) => {
      logger?.error("uncaught", error.stack ?? String(error));
    });
    process.on("unhandledRejection", (reason) => {
      logger?.error("unhandled-rejection", String(reason));
    });
    logger.info("startup", "carrent main process ready", {
      electron: process.versions.electron,
      node: process.versions.node,
      platform: `${process.platform}/${process.arch}`,
      version: app.getVersion(),
    });

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
    const sqliteStore = createSqliteAppStateStore(join(userDataPath, "carrent.sqlite"));
    const sqliteLifecycle = createSqliteAppStateLifecycle(sqliteStore, userDataPath, {
      appVersion: app.getVersion(),
    });
    const store = createSqliteProductionAppStateStore(sqliteStore, sqliteLifecycle);
    const appStateInitialization = await store.initializeAppState();
    const appStateIpcGate = createAppStateIpcGate(ipcMain, {
      status: "recovery-required",
      diagnostics: [],
    });
    const guardedIpcMain = appStateIpcGate.ipcMain;
    let providerSessionStore: ReturnType<typeof createSqliteProviderSessionStore> | null = null;
    appStateStore = store;
    browserManager = createBrowserManager({
      userDataPath,
      createAuxiliaryWindow: createBrowserWindow,
      browserMenuOverlayPreload: join(__dirname, "../preload/browserMenuOverlay.mjs"),
      loadBrowserMenuOverlay,
      resolveOwner: (target) => {
        const suffix = `/project/${encodeURIComponent(target.projectId)}/thread/${encodeURIComponent(target.threadId)}`;
        const matching = BrowserWindow.getAllWindows().filter((window) =>
          windowRegistry.getRoute(window.id)?.endsWith(suffix),
        );
        const focused = BrowserWindow.getFocusedWindow();
        const window = (focused && matching.includes(focused) ? focused : matching.at(-1)) ?? null;
        return window?.webContents.id ?? null;
      },
      resolveProjectTarget: (projectId) => {
        const matching = BrowserWindow.getAllWindows().flatMap((window) => {
          const route = windowRegistry.getRoute(window.id);
          const match = route?.match(/^\/workspace\/[^/]+\/project\/([^/]+)\/thread\/([^/]+)$/u);
          if (!match) return [];
          try {
            const target = {
              projectId: decodeURIComponent(match[1]),
              threadId: decodeURIComponent(match[2]),
            };
            return target.projectId === projectId ? [{ window, target }] : [];
          } catch {
            return [];
          }
        });
        const activeWindowId = windowRegistry.getActive()?.id;
        const resolved =
          matching.find(({ window }) => window.id === activeWindowId) ?? matching.at(-1) ?? null;
        return resolved
          ? { ownerId: resolved.window.webContents.id, target: resolved.target }
          : null;
      },
    });
    registerBrowserIpc(guardedIpcMain, browserManager);
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
    const terminalCompletionService = createTerminalCompletionService();
    const terminalHistory = createTerminalHistory(
      parseZshHistory(readHistoryTail(join(app.getPath("home"), ".zsh_history"))),
    );
    terminalSessionManager = createTerminalSessionManager({
      pty: nodePtyAdapter,
      emit: (ownerId, event) => {
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
      browserEnvironment: (input) =>
        browserManager?.createProjectOpenEnvironment(input.projectId) ?? {},
    });
    registerTerminalIpc(guardedIpcMain, terminalSessionManager, windowRegistry);

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
      // A committed Thread Draft promotion is the only thing that authorizes
      // automatic title generation. Recording it here — from the accepted
      // command rather than from a Renderer message — keeps the trigger
      // boundary authoritative.
      onCommandAccepted: (command, data) => {
        registerAcceptedThreadTitlePromotion(threadTitleCoordinator, command, data);
      },
      onPersisted: (snapshot) => {
        threadTitleCoordinator?.reconcile(snapshot);
        const messagesById = new Map(
          (snapshot.threadMessages ?? []).map((message) => [message.id, message]),
        );
        for (const run of snapshot.threadRuns ?? []) {
          if (!run.assistantMessageId) continue;
          const eventCount = messagesById.get(run.assistantMessageId)?.runEventCount;
          if (typeof eventCount === "number") {
            chatRunAuthority?.acknowledgePersistedEvents(run.id, eventCount);
          }
        }
      },
    });
    const threadTitleTransportFactory = createKimiAcpProcessTransportFactory(
      (command, args, options) =>
        spawn(command, args, {
          cwd: options.cwd,
          stdio: options.stdio,
          windowsHide: options.windowsHide,
        }),
    );
    threadTitleCoordinator = createThreadTitleCoordinator({
      getSnapshot: () => appStateAuthority.getState().snapshot,
      submitCommand: (command) => appStateAuthority.submit(0, command),
      resolveDefaultModelId: async (signal) => {
        const result = await listKimiRuntimeModels(homedir(), threadTitleTransportFactory, signal);
        const modelId = result.defaultModelId;
        return result.state === "listed" &&
          modelId &&
          result.models.some((model) => model.id === modelId)
          ? modelId
          : null;
      },
      transportFactory: threadTitleTransportFactory,
      log: (diagnostic) => {
        const level = diagnostic.category === "success" ? "info" : "warn";
        logger?.[level]("thread-title", "automatic title job finished", diagnostic);
      },
    });
    registerAppStateAuthorityIpc(guardedIpcMain, appStateAuthority);
    const setAppStateTransactionActiveEverywhere = (active: boolean) => {
      appStateAuthority.setTransactionActive(active);
    };
    registerAppStateIpc(
      guardedIpcMain,
      store,
      startupAppStateResult,
      async (result, source) => {
        const applied = await appStateLifecycle.apply(result, source);
        appStateAuthority.replaceState(applied);
        return applied;
      },
      (active) => appStateAuthority.setTransactionActive(active),
    );
    appStateFlush = createAppStateFlush(guardedIpcMain, appStateAuthority, (subscriberId) => {
      const contents = webContents.fromId(subscriberId);
      return contents && !contents.isDestroyed() ? contents : null;
    });

    registerDialogIpc(guardedIpcMain, () =>
      dialog.showOpenDialog({ properties: ["openDirectory"] }),
    );

    registerEditorsIpc(guardedIpcMain);

    guardedIpcMain.handle("shell:open-path", async (_event, filePath) => {
      if (typeof filePath !== "string") throw new Error("Invalid file path.");
      const result = await shell.openPath(filePath);
      return result;
    });

    guardedIpcMain.handle("shell:reveal-path", async (_event, filePath) => {
      if (typeof filePath !== "string") throw new Error("Invalid file path.");
      return revealLocalPath(filePath, (path) => shell.showItemInFolder(path));
    });

    // Resolves dropped filesystem paths to validated Local Path Context descriptors.
    // The preload already converted each DOM File to an absolute path via
    // webUtils.getPathForFile; here we stat each path to confirm it exists and
    // classify it, returning only normalized absolute path, basename, and kind.
    // Missing or unsupported entries are rejected without throwing so a mixed drop
    // can still accept its valid items.
    guardedIpcMain.handle("local-paths:resolve", (_event, paths) =>
      resolveDroppedLocalPaths(paths),
    );

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

    providerSessionStore = createSqliteProviderSessionStore(sqliteStore, providerSessionsSnapshot);
    const sessionManager = createChatSessionManager({
      emit: (event) => chatRunAuthority?.handleEvent(event),
      spawn,
      providerSessions: providerSessionStore,
      attachmentStore,
      carrentBridgeFactory: async ({ runId, cwd }) => {
        return bridgeManager.getRuntimeHandle({ runId, cwd });
      },
    });
    runNotificationCoordinator = createRunNotificationCoordinator({
      getSnapshot: () => appStateAuthority.getState().snapshot,
      buildThreadRoute: (workspaceId, projectId, threadId) =>
        `/workspace/${workspaceId}/project/${projectId}/thread/${threadId}`,
      windows: {
        // Real OS focus via Electron; combined with the registry's route lookup.
        // A window in another app, minimized, hidden, or no window yields null,
        // so suppression only happens when a focused Carrent Window shows the
        // exact owning Thread route.
        focusedRoute: () => {
          const focused = BrowserWindow.getFocusedWindow();
          if (!focused || focused.isDestroyed()) return null;
          return windowRegistry.getRoute(focused.id);
        },
        // Reuses the registry's existing peer-window targeting: focus a window
        // already showing the route, otherwise navigate the most-recently-active
        // window. Returns false when no Carrent Window exists.
        routeToThread: (route) => {
          if (windowRegistry.getActive() === null) return false;
          windowRegistry.handleRoute(route);
          return true;
        },
      },
      notifications: createElectronNotificationAdapter(),
      createWindowWithRoute: (route) => {
        createWindow(undefined, { initialPath: route });
      },
    });
    chatRunAuthority = createChatRunAuthority({
      start: sessionManager.start,
      stop: sessionManager.stop,
      respondToPermission: sessionManager.respondToPermission,
      respondToQuestion: sessionManager.respondToQuestion,
      onChange: (state) => runNotificationCoordinator?.onRunStateChanged(state),
      publish: (subscriberId, update) => {
        const contents = webContents.fromId(subscriberId);
        if (contents && !contents.isDestroyed()) {
          contents.send("chat:changed", update);
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
        adoptCommittedProviderSessionDeletion: sessionManager.adoptCommittedProviderSessionDeletion,
      },
      onActiveChange: setAppStateTransactionActiveEverywhere,
      onSnapshotCommitted: (snapshot) => appStateAuthority.adoptExternalSnapshot(snapshot),
      onThreadsDeleted: (threadIds) => browserManager?.deleteThreads(threadIds),
    });
    waitForThreadDeletion = threadDeletionManager.waitForIdle;
    registerChatIpc(guardedIpcMain, {
      sessionManager,
      runAuthority: chatRunAuthority,
      isProjectDirectoryAvailable,
      threadDeletionManager,
      threadTitleCoordinator,
    });

    // Registered here so the Worktrees scan can read live Run and Terminal Tab
    // authority state directly; every window's scan evaluates the same state.
    const worktreeSizeScanner = createWorktreeSizeScanner({
      measure: measureWorktreeDirectorySize,
      publish: (ownerId, event) => {
        const contents = webContents.fromId(ownerId);
        if (contents && !contents.isDestroyed()) {
          contents.send("settings:worktrees:sizes:event", event);
        }
      },
    });
    registerSettingsIpc(
      guardedIpcMain,
      () => app.getVersion(),
      () => appStateAuthority.getState().snapshot.projects,
      () =>
        buildWorktreeActivitySnapshot({
          threads: appStateAuthority.getState().snapshot.threads ?? [],
          runs: chatRunAuthority?.getState().runs ?? [],
          runningTerminalTabs: terminalSessionManager?.listRunningTerminalTabs() ?? [],
        }),
      worktreeSizeScanner,
    );

    windowSessionStore = createCarrentWindowSessionStore(userDataPath);
    const savedSession = await windowSessionStore.load();
    const restoredWindows = savedSession ? restoreWindows(savedSession) : [];

    // Coordinated quit-time capture of every live window's route, bounds, and
    // maximized state, persisted as the next-launch window session.
    windowCapture = createCarrentWindowCapture(
      guardedIpcMain,
      () =>
        BrowserWindow.getAllWindows()
          .filter((target) => !target.isDestroyed())
          .map((target) => ({
            id: target.id,
            isDestroyed: () => target.isDestroyed(),
            getBounds: () =>
              target.isDestroyed()
                ? { x: 0, y: 0, width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }
                : resolveNormalBounds(target),
            isMaximized: () => !target.isDestroyed() && target.isMaximized(),
            getRoute: () => windowRegistry.getRoute(target.id),
            send: (channel) => {
              if (!target.isDestroyed()) target.webContents.send(channel);
            },
          })),
      (target) => target.send("windows:capture-request"),
    );

    // Restart restores every Carrent Window still open at Quit with its route,
    // normal bounds, and maximized state. A window explicitly closed before
    // Quit is not restored (it was not in the saved session). Invalid restored
    // routes fall back normally via the renderer's nearest-valid-parent logic.
    recentRestoredWindow = savedSession ? mostRecentRestoredWindow(savedSession) : null;
    if (restoredWindows.length > 0) {
      for (const restored of restoredWindows) {
        createWindow(icon, {
          initialPath: restored.route,
          restoreBounds: restored.bounds,
          restoreMaximized: restored.maximized,
        });
      }
      if (initialLaunchTargeting.route) {
        windowRegistry.handleRoute(initialLaunchTargeting.route);
      }
    } else if (initialLaunchTargeting.route) {
      // A first-launch deep link opens its route in the initial window.
      createWindow(icon, { initialPath: initialLaunchTargeting.route });
    } else {
      createWindow(icon);
    }

    app.on("activate", () => {
      handleCarrentWindowActivation({
        windowCount: () => windowRegistry.count(),
        // Dock activation with no Carrent Window re-creates one using normal
        // recent-position recovery from the saved window session.
        createRecoveredWindow: () => createRecoveredWindow(icon, null),
        focusMostRecent: () => windowRegistry.focusMostRecent(),
      });
    });
  });
}

const appShutdown = createAppShutdown({
  quit: () => app.quit(),
  reportShutdownError: (error) => console.error("[app] failed to quit safely", error),
  beforeSave: async () => {
    await threadTitleCoordinator?.shutdown();
    await chatSessionManager?.shutdown();
    terminalSessionManager?.shutdown();
    await waitForThreadDeletion?.();
    // Ask renderers to flush pending App State commands, then drain the
    // authority queue so everything typed before quitting is persisted.
    await appStateFlush?.flush();
    await appStateStore?.waitForWrites();
    // Capture each live window's route, bounds, and maximized state so the next
    // launch restores every Carrent Window still open at Quit. The capture
    // runs after the App State flush so the routes reflect the persisted state.
    if (windowCapture && windowSessionStore) {
      const captured = await windowCapture.capture();
      await windowSessionStore.save(captureSession(captured));
    }
    await appStateStore?.close();
  },
  liveRunQuitPolicy: {
    hasLiveRuns: () => chatSessionManager?.hasLiveRuns?.() ?? false,
    confirmQuitWithLiveRuns: () => liveRunQuitWarning?.confirmQuit() ?? Promise.resolve(true),
    cancelLiveRuns: async () => {
      await threadTitleCoordinator?.shutdown();
      await chatSessionManager?.shutdown();
    },
  },
});

app.on("before-quit", (event) => {
  logger?.info("shutdown", "carrent before-quit");
  void appShutdown.beforeQuit(event);
});

app.on("window-all-closed", () => {
  // On macOS the final Carrent Window is destroyed while Carrent (and its Runs
  // and Terminal Tabs) stays active; Dock activation re-creates a window. On
  // Windows and Linux closing the final window requests application Quit.
  if (process.platform !== "darwin") app.quit();
});
