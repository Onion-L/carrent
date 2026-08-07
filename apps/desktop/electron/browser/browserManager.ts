import {
  BrowserWindow,
  WebContentsView,
  session as electronSession,
  shell,
  webContents,
  type Session,
} from "electron";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type {
  BrowserBounds,
  BrowserSearchEngine,
  BrowserTab,
  BrowserThreadState,
  BrowserThreadTarget,
} from "../../src/shared/browser";
import { isBrowserUrl, resolveBrowserInput } from "./browserNavigation";
import { installBrowserOpener } from "./browserOpener";

type TabRecord = {
  state: BrowserTab;
  view: WebContentsView;
};

type ThreadRecord = {
  threadId: string;
  projectId: string;
  open: boolean;
  placement: "side" | "window";
  activeTabId: string | null;
  tabs: Map<string, TabRecord>;
  sideOwnerId: number | null;
  sidePresentations: Map<number, { bounds: BrowserBounds | null; visible: boolean }>;
  auxiliaryWindow: BrowserWindow | null;
  focusSequence: number;
};

type BrowserOpenBinding =
  | { kind: "thread"; target: BrowserThreadTarget }
  | { kind: "project"; projectId: string };

type BrowserManagerDependencies = {
  userDataPath: string;
  createAuxiliaryWindow: (target: BrowserThreadTarget) => BrowserWindow;
  resolveOwner: (target: BrowserThreadTarget) => number | null;
  resolveProjectTarget: (
    projectId: string,
  ) => { ownerId: number; target: BrowserThreadTarget } | null;
};

const SEARCH_ENGINES = new Set<BrowserSearchEngine>(["google", "bing", "duckduckgo"]);
const DEFAULT_TITLE = "New Tab";

function projectPartition(projectId: string) {
  const key = createHash("sha256").update(projectId).digest("hex").slice(0, 24);
  return `persist:carrent-browser-${key}`;
}

function validBounds(bounds: BrowserBounds): BrowserBounds {
  const values = [bounds.x, bounds.y, bounds.width, bounds.height];
  if (!values.every(Number.isFinite) || bounds.width < 0 || bounds.height < 0) {
    throw new Error("Invalid browser bounds.");
  }
  return {
    x: Math.max(0, Math.round(bounds.x)),
    y: Math.max(0, Math.round(bounds.y)),
    width: Math.max(0, Math.round(bounds.width)),
    height: Math.max(0, Math.round(bounds.height)),
  };
}

function loopbackUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  } catch {
    return false;
  }
}

export function createBrowserManager({
  userDataPath,
  createAuxiliaryWindow,
  resolveOwner,
  resolveProjectTarget,
}: BrowserManagerDependencies) {
  const threads = new Map<string, ThreadRecord>();
  const ownerThread = new Map<number, string>();
  const auxiliaryOwners = new Map<number, string>();
  const attachedWindowByView = new Map<number, BrowserWindow>();
  const configuredSessions = new Set<string>();
  const certificateAllowOnce = new Set<string>();
  const openTargetsByToken = new Map<string, BrowserOpenBinding>();
  const settingsPath = join(userDataPath, "browser-settings.json");
  let openerPath: string | null = null;
  let searchEngine: BrowserSearchEngine = "google";
  const knownProjectIds = new Set<string>();

  try {
    openerPath = installBrowserOpener(userDataPath);
  } catch {
    // Framework auto-open remains unavailable if the helper cannot be written.
  }

  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
      searchEngine?: unknown;
      projectIds?: unknown;
    };
    if (SEARCH_ENGINES.has(parsed.searchEngine as BrowserSearchEngine)) {
      searchEngine = parsed.searchEngine as BrowserSearchEngine;
    }
    if (Array.isArray(parsed.projectIds)) {
      for (const projectId of parsed.projectIds) {
        if (typeof projectId === "string" && projectId.length <= 256)
          knownProjectIds.add(projectId);
      }
    }
  } catch {
    // The browser starts with defaults when settings have not been written yet.
  }

  const persistSettings = () => {
    try {
      writeFileSync(
        settingsPath,
        `${JSON.stringify({ searchEngine, projectIds: [...knownProjectIds] }, null, 2)}\n`,
        "utf8",
      );
    } catch {
      // A settings write failure must not make browsing unavailable.
    }
  };

  const sessionForProject = (projectId: string) => {
    if (!knownProjectIds.has(projectId)) {
      knownProjectIds.add(projectId);
      persistSettings();
    }
    const partition = projectPartition(projectId);
    const session = electronSession.fromPartition(partition);
    if (!configuredSessions.has(partition)) {
      configuredSessions.add(partition);
      session.setPermissionCheckHandler(() => false);
      session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
      session.on("will-download", (_event, item) => {
        const url = item.getURL();
        item.cancel();
        if (isBrowserUrl(url)) void shell.openExternal(url);
      });
    }
    return session;
  };

  const contentOwnerId = (thread: ThreadRecord) =>
    thread.placement === "window"
      ? (thread.auxiliaryWindow?.webContents.id ?? null)
      : thread.sideOwnerId;

  const snapshot = (thread: ThreadRecord, ownerId?: number): BrowserThreadState => ({
    threadId: thread.threadId,
    projectId: thread.projectId,
    open: thread.open,
    placement: thread.placement,
    activeTabId: thread.activeTabId,
    tabs: [...thread.tabs.values()].map(({ state }) => ({ ...state })),
    searchEngine,
    focusSequence: thread.focusSequence,
    contentOwned: ownerId !== undefined && contentOwnerId(thread) === ownerId,
  });

  const sendState = (thread: ThreadRecord) => {
    const ids = new Set<number>();
    for (const [ownerId, threadId] of ownerThread) {
      if (threadId === thread.threadId) ids.add(ownerId);
    }
    if (thread.auxiliaryWindow && !thread.auxiliaryWindow.isDestroyed()) {
      ids.add(thread.auxiliaryWindow.webContents.id);
    }
    for (const id of ids) {
      const owner = webContents.fromId(id);
      if (owner && !owner.isDestroyed()) owner.send("browser:state", snapshot(thread, id));
    }
  };

  const detachView = (view: WebContentsView) => {
    const parent = attachedWindowByView.get(view.webContents.id);
    if (parent && !parent.isDestroyed()) parent.contentView.removeChildView(view);
    attachedWindowByView.delete(view.webContents.id);
    view.setVisible(false);
  };

  const activeTab = (thread: ThreadRecord) =>
    thread.activeTabId ? (thread.tabs.get(thread.activeTabId) ?? null) : null;

  const hostWindow = (thread: ThreadRecord) => {
    if (thread.placement === "window") {
      return thread.auxiliaryWindow && !thread.auxiliaryWindow.isDestroyed()
        ? thread.auxiliaryWindow
        : null;
    }
    if (thread.sideOwnerId === null) return null;
    const contents = webContents.fromId(thread.sideOwnerId);
    return contents ? BrowserWindow.fromWebContents(contents) : null;
  };

  const presentationFor = (thread: ThreadRecord, ownerId: number) => {
    let presentation = thread.sidePresentations.get(ownerId);
    if (!presentation) {
      presentation = { bounds: null, visible: false };
      thread.sidePresentations.set(ownerId, presentation);
    }
    return presentation;
  };

  const syncAttachment = (thread: ThreadRecord) => {
    for (const tab of thread.tabs.values()) detachView(tab.view);
    const tab = activeTab(thread);
    const host = hostWindow(thread);
    const ownerId = contentOwnerId(thread);
    const presentation = ownerId === null ? null : (thread.sidePresentations.get(ownerId) ?? null);
    const visible =
      thread.open &&
      presentation?.visible === true &&
      tab !== null &&
      host !== null &&
      !host.isDestroyed() &&
      presentation.bounds !== null;
    if (!visible || !tab || !host || !presentation?.bounds) return;
    host.contentView.addChildView(tab.view);
    attachedWindowByView.set(tab.view.webContents.id, host);
    tab.view.setBounds(validBounds(presentation.bounds));
    tab.view.setVisible(true);
  };

  const getThread = (target: BrowserThreadTarget) => {
    const existing = threads.get(target.threadId);
    if (existing) {
      if (existing.projectId !== target.projectId) throw new Error("Browser Project mismatch.");
      return existing;
    }
    const created: ThreadRecord = {
      ...target,
      open: false,
      placement: "side",
      activeTabId: null,
      tabs: new Map(),
      sideOwnerId: null,
      sidePresentations: new Map(),
      auxiliaryWindow: null,
      focusSequence: 0,
    };
    threads.set(target.threadId, created);
    return created;
  };

  const updateTabState = (thread: ThreadRecord, tab: TabRecord) => {
    const history = tab.view.webContents.navigationHistory;
    const rawUrl = tab.view.webContents.getURL();
    tab.state = {
      ...tab.state,
      title:
        rawUrl === "about:blank" ? DEFAULT_TITLE : tab.view.webContents.getTitle() || DEFAULT_TITLE,
      url: rawUrl === "about:blank" ? "" : rawUrl,
      loading: tab.view.webContents.isLoading(),
      canGoBack: history.canGoBack(),
      canGoForward: history.canGoForward(),
      zoomFactor: tab.view.webContents.getZoomFactor(),
    };
    sendState(thread);
  };

  const navigateTab = async (thread: ThreadRecord, tab: TabRecord, value: string) => {
    const url = resolveBrowserInput(value, searchEngine);
    delete tab.state.certificateError;
    await tab.view.webContents.loadURL(url);
    updateTabState(thread, tab);
  };

  const createTab = (thread: ThreadRecord, initialUrl = "about:blank") => {
    const id = randomUUID();
    const view = new WebContentsView({
      webPreferences: {
        session: sessionForProject(thread.projectId),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const tab: TabRecord = {
      view,
      state: {
        id,
        title: DEFAULT_TITLE,
        url: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        zoomFactor: 1,
      },
    };
    thread.tabs.set(id, tab);
    thread.activeTabId = id;

    const update = () => updateTabState(thread, tab);
    view.webContents.on("did-start-loading", update);
    view.webContents.on("did-stop-loading", update);
    view.webContents.on("did-navigate", update);
    view.webContents.on("did-navigate-in-page", update);
    view.webContents.on("page-title-updated", update);
    view.webContents.on("page-favicon-updated", (_event, favicons) => {
      tab.state.faviconUrl = favicons.find(isBrowserUrl);
      sendState(thread);
    });
    view.webContents.on("will-navigate", (event, url) => {
      if (isBrowserUrl(url)) return;
      event.preventDefault();
    });
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isBrowserUrl(url)) {
        const next = createTab(thread, url);
        thread.activeTabId = next.state.id;
        syncAttachment(thread);
        sendState(thread);
      }
      return { action: "deny" };
    });
    view.webContents.on("before-input-event", (event, input) => {
      const command = process.platform === "darwin" ? input.meta : input.control;
      if (!command || input.alt || input.type !== "keyDown") return;
      const key = input.key.toLowerCase();
      if (key === "l") {
        event.preventDefault();
        const owner =
          thread.placement === "window"
            ? thread.auxiliaryWindow?.webContents
            : thread.sideOwnerId
              ? webContents.fromId(thread.sideOwnerId)
              : null;
        owner?.send("browser:focus-address");
      } else if (key === "f") {
        event.preventDefault();
        const owner =
          thread.placement === "window"
            ? thread.auxiliaryWindow?.webContents
            : thread.sideOwnerId
              ? webContents.fromId(thread.sideOwnerId)
              : null;
        owner?.send("browser:find");
      } else if (key === "t") {
        event.preventDefault();
        createTab(thread);
        syncAttachment(thread);
        sendState(thread);
      } else if (key === "w") {
        event.preventDefault();
        closeTab(thread, id);
      } else if (key === "r") {
        event.preventDefault();
        view.webContents.reload();
      } else if (key === "=" || key === "+") {
        event.preventDefault();
        const factor = Math.min(3, view.webContents.getZoomFactor() + 0.1);
        view.webContents.setZoomFactor(factor);
        updateTabState(thread, tab);
      } else if (key === "-") {
        event.preventDefault();
        const factor = Math.max(0.25, view.webContents.getZoomFactor() - 0.1);
        view.webContents.setZoomFactor(factor);
        updateTabState(thread, tab);
      } else if (key === "0") {
        event.preventDefault();
        view.webContents.setZoomFactor(1);
        updateTabState(thread, tab);
      }
    });

    void view.webContents.loadURL(initialUrl);
    return tab;
  };

  function closeTab(thread: ThreadRecord, tabId: string) {
    const tab = thread.tabs.get(tabId);
    if (!tab) throw new Error("Browser tab not found.");
    detachView(tab.view);
    tab.view.webContents.close();
    thread.tabs.delete(tabId);
    if (thread.tabs.size === 0) {
      thread.activeTabId = null;
      thread.open = false;
      for (const presentation of thread.sidePresentations.values()) {
        presentation.visible = false;
      }
      if (thread.auxiliaryWindow && !thread.auxiliaryWindow.isDestroyed()) {
        thread.auxiliaryWindow.close();
      }
      thread.placement = "side";
    } else if (thread.activeTabId === tabId) {
      thread.activeTabId = [...thread.tabs.keys()].at(-1) ?? null;
    }
    syncAttachment(thread);
    sendState(thread);
  }

  const open = async (ownerId: number, target: BrowserThreadTarget, url?: string) => {
    const thread = getThread(target);
    if (!auxiliaryOwners.has(ownerId)) {
      ownerThread.set(ownerId, thread.threadId);
      thread.sideOwnerId = ownerId;
    }
    presentationFor(thread, ownerId).visible = true;
    thread.open = true;
    thread.focusSequence += 1;
    let tab = activeTab(thread);
    if (!tab || (url && tab.state.url)) tab = createTab(thread);
    if (url) await navigateTab(thread, tab, url);
    syncAttachment(thread);
    sendState(thread);
    return snapshot(thread, ownerId);
  };

  const requireOwner = (ownerId: number, thread: ThreadRecord) => {
    if (
      ownerThread.get(ownerId) !== thread.threadId &&
      auxiliaryOwners.get(ownerId) !== thread.threadId
    ) {
      throw new Error("Browser owner mismatch.");
    }
  };

  return {
    activate(ownerId: number, target: BrowserThreadTarget | null) {
      const auxiliaryThreadId = auxiliaryOwners.get(ownerId);
      if (auxiliaryThreadId) {
        const thread = threads.get(auxiliaryThreadId);
        if (!thread) return null;
        presentationFor(thread, ownerId);
        syncAttachment(thread);
        return snapshot(thread, ownerId);
      }

      const previousId = ownerThread.get(ownerId);
      if (previousId && previousId !== target?.threadId) {
        const previous = threads.get(previousId);
        if (previous) {
          presentationFor(previous, ownerId).visible = false;
          syncAttachment(previous);
          sendState(previous);
        }
      }
      if (!target) {
        ownerThread.delete(ownerId);
        return null;
      }
      ownerThread.set(ownerId, target.threadId);
      const thread = getThread(target);
      thread.sideOwnerId = ownerId;
      presentationFor(thread, ownerId);
      if (
        thread.placement === "window" &&
        thread.auxiliaryWindow &&
        !thread.auxiliaryWindow.isDestroyed()
      ) {
        thread.auxiliaryWindow.show();
      }
      syncAttachment(thread);
      sendState(thread);
      return snapshot(thread, ownerId);
    },
    open,
    newTab(ownerId: number, target: BrowserThreadTarget) {
      const thread = getThread(target);
      if (!auxiliaryOwners.has(ownerId)) {
        ownerThread.set(ownerId, thread.threadId);
        thread.sideOwnerId = ownerId;
      }
      presentationFor(thread, ownerId).visible = true;
      thread.open = true;
      thread.focusSequence += 1;
      createTab(thread);
      syncAttachment(thread);
      sendState(thread);
      return snapshot(thread, ownerId);
    },
    activateTab(ownerId: number, target: BrowserThreadTarget, tabId: string) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      if (!thread.tabs.has(tabId)) throw new Error("Browser tab not found.");
      thread.activeTabId = tabId;
      syncAttachment(thread);
      sendState(thread);
      return snapshot(thread, ownerId);
    },
    closeTab(ownerId: number, target: BrowserThreadTarget, tabId: string) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      closeTab(thread, tabId);
      return snapshot(thread, ownerId);
    },
    async navigate(ownerId: number, target: BrowserThreadTarget, tabId: string, value: string) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      const tab = thread.tabs.get(tabId);
      if (!tab) throw new Error("Browser tab not found.");
      await navigateTab(thread, tab, value);
      return snapshot(thread, ownerId);
    },
    action(
      ownerId: number,
      target: BrowserThreadTarget,
      tabId: string,
      action: "back" | "forward" | "reload" | "stop" | "devtools",
    ) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      const tab = thread.tabs.get(tabId);
      if (!tab) throw new Error("Browser tab not found.");
      const contents = tab.view.webContents;
      if (action === "back" && contents.navigationHistory.canGoBack())
        contents.navigationHistory.goBack();
      if (action === "forward" && contents.navigationHistory.canGoForward())
        contents.navigationHistory.goForward();
      if (action === "reload") contents.reload();
      if (action === "stop") contents.stop();
      if (action === "devtools") contents.openDevTools({ mode: "detach" });
      updateTabState(thread, tab);
      return snapshot(thread, ownerId);
    },
    zoom(
      ownerId: number,
      target: BrowserThreadTarget,
      tabId: string,
      action: "in" | "out" | "reset",
    ) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      const tab = thread.tabs.get(tabId);
      if (!tab) throw new Error("Browser tab not found.");
      const current = tab.view.webContents.getZoomFactor();
      tab.view.webContents.setZoomFactor(
        action === "reset"
          ? 1
          : Math.min(3, Math.max(0.25, current + (action === "in" ? 0.1 : -0.1))),
      );
      updateTabState(thread, tab);
      return snapshot(thread, ownerId);
    },
    setBounds(ownerId: number, target: BrowserThreadTarget, bounds: BrowserBounds) {
      const thread = getThread(target);
      if (
        auxiliaryOwners.get(ownerId) !== thread.threadId &&
        ownerThread.get(ownerId) !== thread.threadId
      )
        return;
      presentationFor(thread, ownerId).bounds = validBounds(bounds);
      syncAttachment(thread);
    },
    setVisible(ownerId: number, target: BrowserThreadTarget, visible: boolean) {
      const thread = getThread(target);
      if (
        auxiliaryOwners.get(ownerId) !== thread.threadId &&
        ownerThread.get(ownerId) !== thread.threadId
      )
        return;
      presentationFor(thread, ownerId).visible = visible;
      syncAttachment(thread);
    },
    popOut(ownerId: number, target: BrowserThreadTarget) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      if (!thread.auxiliaryWindow || thread.auxiliaryWindow.isDestroyed()) {
        const window = createAuxiliaryWindow(target);
        thread.auxiliaryWindow = window;
        auxiliaryOwners.set(window.webContents.id, thread.threadId);
        window.on("closed", () => {
          if (threads.get(thread.threadId) !== thread) return;
          auxiliaryOwners.delete(window.webContents.id);
          thread.sidePresentations.delete(window.webContents.id);
          thread.auxiliaryWindow = null;
          thread.placement = "side";
          syncAttachment(thread);
          sendState(thread);
        });
      }
      thread.placement = "window";
      syncAttachment(thread);
      thread.auxiliaryWindow.show();
      sendState(thread);
      return snapshot(thread, ownerId);
    },
    dock(ownerId: number, target: BrowserThreadTarget) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      const window = thread.auxiliaryWindow;
      thread.placement = "side";
      thread.auxiliaryWindow = null;
      if (window && !window.isDestroyed()) {
        auxiliaryOwners.delete(window.webContents.id);
        window.destroy();
      }
      syncAttachment(thread);
      sendState(thread);
      return snapshot(thread, ownerId);
    },
    async openExternal(ownerId: number, target: BrowserThreadTarget, tabId: string) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      const url = thread.tabs.get(tabId)?.view.webContents.getURL();
      if (!url || !isBrowserUrl(url) || url === "about:blank") return;
      await shell.openExternal(url);
    },
    find(
      ownerId: number,
      target: BrowserThreadTarget,
      tabId: string,
      text: string,
      forward = true,
    ) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      const tab = thread.tabs.get(tabId);
      if (!tab) throw new Error("Browser tab not found.");
      if (text) tab.view.webContents.findInPage(text, { forward, findNext: true });
    },
    stopFind(ownerId: number, target: BrowserThreadTarget, tabId: string) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      const tab = thread.tabs.get(tabId);
      if (!tab) return;
      tab.view.webContents.stopFindInPage("clearSelection");
    },
    continueCertificate(ownerId: number, target: BrowserThreadTarget, tabId: string) {
      const thread = getThread(target);
      requireOwner(ownerId, thread);
      const tab = thread.tabs.get(tabId);
      if (!tab?.state.certificateError || !loopbackUrl(tab.state.certificateError.url)) {
        throw new Error("Certificate exception is unavailable.");
      }
      certificateAllowOnce.add(`${tab.view.webContents.id}:${tab.state.certificateError.url}`);
      const url = tab.state.certificateError.url;
      delete tab.state.certificateError;
      void tab.view.webContents.loadURL(url);
      sendState(thread);
      return snapshot(thread, ownerId);
    },
    async clearData(ownerId: number, target: BrowserThreadTarget, scope: "project" | "all") {
      requireOwner(ownerId, getThread(target));
      const affected = [...threads.values()].filter(
        (thread) => scope === "all" || thread.projectId === target.projectId,
      );
      const sessions = new Set<Session>();
      if (scope === "all") {
        for (const projectId of knownProjectIds) sessions.add(sessionForProject(projectId));
      }
      for (const thread of affected) sessions.add(sessionForProject(thread.projectId));
      await Promise.all(
        [...sessions].map(async (session) => {
          await session.clearCache();
          await session.clearStorageData();
        }),
      );
      for (const thread of affected) {
        for (const tab of thread.tabs.values()) tab.view.webContents.reload();
        sendState(thread);
      }
      return snapshot(getThread(target), ownerId);
    },
    setSearchEngine(ownerId: number, target: BrowserThreadTarget, value: BrowserSearchEngine) {
      requireOwner(ownerId, getThread(target));
      if (!SEARCH_ENGINES.has(value)) throw new Error("Invalid search engine.");
      searchEngine = value;
      persistSettings();
      for (const thread of threads.values()) sendState(thread);
      return snapshot(getThread(target), ownerId);
    },
    handleCertificateError(
      contentsId: number,
      url: string,
      error: string,
      callback: (isTrusted: boolean) => void,
    ) {
      for (const thread of threads.values()) {
        for (const tab of thread.tabs.values()) {
          if (tab.view.webContents.id !== contentsId) continue;
          const key = `${contentsId}:${url}`;
          if (certificateAllowOnce.delete(key) && loopbackUrl(url)) {
            callback(true);
            return true;
          }
          tab.state.certificateError = { url, error };
          callback(false);
          sendState(thread);
          return true;
        }
      }
      return false;
    },
    destroyOwner(ownerId: number) {
      const threadId = ownerThread.get(ownerId);
      ownerThread.delete(ownerId);
      if (!threadId) return;
      const thread = threads.get(threadId);
      if (!thread) return;
      thread.sidePresentations.delete(ownerId);
      if (thread.sideOwnerId === ownerId) thread.sideOwnerId = null;
      syncAttachment(thread);
      sendState(thread);
    },
    focusOwner(ownerId: number) {
      const threadId = ownerThread.get(ownerId);
      if (!threadId) return;
      const thread = threads.get(threadId);
      if (!thread || thread.placement !== "side") return;
      thread.sideOwnerId = ownerId;
      syncAttachment(thread);
      sendState(thread);
    },
    openForRoute(ownerId: number, route: string | null, url: string) {
      const match = route?.match(/^\/workspace\/[^/]+\/project\/([^/]+)\/thread\/([^/]+)$/u);
      if (!match || !isBrowserUrl(url)) return false;
      void open(
        ownerId,
        { projectId: decodeURIComponent(match[1]), threadId: decodeURIComponent(match[2]) },
        url,
      );
      return true;
    },
    createOpenEnvironment(target: BrowserThreadTarget): Record<string, string> {
      if (!openerPath) return {};
      const token = randomUUID();
      openTargetsByToken.set(token, { kind: "thread", target });
      return { BROWSER: openerPath, CARRENT_BROWSER_TOKEN: token };
    },
    createProjectOpenEnvironment(projectId: string): Record<string, string> {
      if (!openerPath) return {};
      const token = randomUUID();
      openTargetsByToken.set(token, { kind: "project", projectId });
      return { BROWSER: openerPath, CARRENT_BROWSER_TOKEN: token };
    },
    handleOpenProtocol(value: string) {
      try {
        const url = new URL(value);
        if (url.protocol !== "carrent:" || url.hostname !== "browser" || url.pathname !== "/open") {
          return false;
        }
        const token = url.searchParams.get("token");
        const binding = token ? openTargetsByToken.get(token) : null;
        const pageUrl = url.searchParams.get("url");
        if (!binding || !pageUrl || !isBrowserUrl(pageUrl)) return true;
        const resolved =
          binding.kind === "thread"
            ? (() => {
                const ownerId = resolveOwner(binding.target);
                return ownerId === null ? null : { ownerId, target: binding.target };
              })()
            : resolveProjectTarget(binding.projectId);
        if (resolved) {
          void open(resolved.ownerId, resolved.target, pageUrl);
        } else {
          void shell.openExternal(pageUrl);
        }
        return true;
      } catch {
        return false;
      }
    },
    deleteThreads(threadIds: string[]) {
      const deleting = new Set(threadIds);
      for (const [token, binding] of openTargetsByToken) {
        if (binding.kind === "thread" && deleting.has(binding.target.threadId)) {
          openTargetsByToken.delete(token);
        }
      }
      for (const threadId of deleting) {
        const thread = threads.get(threadId);
        if (!thread) continue;
        threads.delete(threadId);
        for (const [ownerId, ownedThreadId] of ownerThread) {
          if (ownedThreadId === threadId) ownerThread.delete(ownerId);
        }
        for (const tab of thread.tabs.values()) {
          detachView(tab.view);
          for (const key of certificateAllowOnce) {
            if (key.startsWith(`${tab.view.webContents.id}:`)) certificateAllowOnce.delete(key);
          }
          tab.view.webContents.close();
        }
        if (thread.auxiliaryWindow && !thread.auxiliaryWindow.isDestroyed()) {
          auxiliaryOwners.delete(thread.auxiliaryWindow.webContents.id);
          thread.auxiliaryWindow.destroy();
        }
      }
    },
    getState(ownerId: number, target: BrowserThreadTarget) {
      return snapshot(getThread(target), ownerId);
    },
  };
}

export type BrowserManager = ReturnType<typeof createBrowserManager>;
