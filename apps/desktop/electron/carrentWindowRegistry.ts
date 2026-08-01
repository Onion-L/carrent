// Peer Carrent Window registry. Every Carrent Window is a peer with complete
// navigation and its own route, browsing history, and presentation state.
// There is no privileged Main Window and no auxiliary-window role. The
// registry owns activation order, renderer readiness, pending navigation, and
// the close decision for each window.

export type CarrentWindowWebContents = {
  send: (channel: string, path?: string) => void;
};

export type CarrentWindowLike = {
  id: number;
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  isVisible: () => boolean;
  restore: () => void;
  show: () => void;
  hide: () => void;
  focus: () => void;
  webContents: CarrentWindowWebContents;
};

export type CarrentWindowCloseDecision =
  // Close only this window; other Carrent Windows and shared state are untouched.
  | { kind: "close" }
  // The final window on macOS hides instead of quitting Carrent.
  | { kind: "hide" }
  // The final window on Windows and Linux requests application Quit.
  | { kind: "quit" };

type DeepLinkResolution = { kind: "valid"; path: string } | { kind: "invalid" } | null;

function resolveDeepLink(values: string[]): DeepLinkResolution {
  let hasInvalidDeepLink = false;

  for (const value of values) {
    if (!value.startsWith("carrent://")) continue;

    try {
      const url = new URL(value);
      if (url.protocol !== "carrent:") continue;
      if (url.hostname === "workspace") {
        return { kind: "valid", path: `/workspace${url.pathname}` };
      }
      if (!url.hostname && url.pathname.startsWith("/workspace/")) {
        return { kind: "valid", path: url.pathname };
      }
      hasInvalidDeepLink = true;
    } catch {
      hasInvalidDeepLink = true;
    }
  }
  return hasInvalidDeepLink ? { kind: "invalid" } : null;
}

type RendererNavigationStart = {
  isSameDocument: boolean;
  isMainFrame: boolean;
};

type RegisteredWindow = {
  window: CarrentWindowLike;
  ready: boolean;
  // A navigation requested (deep link, repeated launch) while the renderer is
  // still loading. Cleared if the renderer starts loading again.
  pendingNavigation: string | null;
  // A new window's initial route. Unlike pendingNavigation it survives the
  // new renderer's own initial load and is delivered once on first ready.
  initialRoute: string | null;
  route: string | null;
};

type CarrentWindowRegistryDependencies = {
  platform?: NodeJS.Platform;
};

export function createCarrentWindowRegistry({
  platform = process.platform,
}: CarrentWindowRegistryDependencies = {}) {
  const windows: RegisteredWindow[] = [];

  const entryOf = (id: number) => windows.find((item) => item.window.id === id);
  const liveEntryOf = (id: number) => {
    const entry = entryOf(id);
    if (!entry || entry.window.isDestroyed()) return undefined;
    return entry;
  };

  function sendNavigation(target: RegisteredWindow, path: string) {
    target.route = path;
    if (!target.ready) {
      target.pendingNavigation = path;
      return;
    }
    target.window.webContents.send("app:navigate", path);
  }

  function focusWindow(entry: RegisteredWindow) {
    if (entry.window.isDestroyed()) return null;
    if (entry.window.isMinimized()) entry.window.restore();
    if (!entry.window.isVisible()) entry.window.show();
    entry.window.focus();
    return entry.window;
  }

  function touchActivation(id: number) {
    const index = windows.findIndex((item) => item.window.id === id);
    if (index === -1) return;
    if (index === windows.length - 1) return;
    const [entry] = windows.splice(index, 1);
    windows.push(entry);
  }

  function resolveMostRecent(): RegisteredWindow | undefined {
    for (let index = windows.length - 1; index >= 0; index -= 1) {
      const entry = windows[index];
      if (!entry.window.isDestroyed()) return entry;
    }
    return undefined;
  }

  return {
    register(window: CarrentWindowLike) {
      windows.push({
        window,
        ready: false,
        pendingNavigation: null,
        initialRoute: null,
        route: null,
      });
    },

    setInitialRoute(id: number, path: string) {
      const entry = entryOf(id);
      if (entry) entry.initialRoute = path;
    },

    unregister(id: number) {
      const index = windows.findIndex((item) => item.window.id === id);
      if (index !== -1) windows.splice(index, 1);
    },

    count() {
      return windows.length;
    },

    getAll(): CarrentWindowLike[] {
      return windows.map((item) => item.window);
    },

    getActive(): CarrentWindowLike | null {
      return resolveMostRecent()?.window ?? null;
    },

    setActive(id: number) {
      if (!entryOf(id)) return;
      touchActivation(id);
    },

    getRoute(id: number): string | null {
      return entryOf(id)?.route ?? null;
    },

    markLoading(id: number, navigation: RendererNavigationStart = {
      isSameDocument: false,
      isMainFrame: true,
    }) {
      if (navigation.isSameDocument || !navigation.isMainFrame) return;
      const entry = entryOf(id);
      if (!entry) return;
      entry.ready = false;
      entry.pendingNavigation = null;
    },

    markReady(id: number) {
      const entry = entryOf(id);
      if (!entry) return;
      entry.ready = true;
      // A new window's initial route is delivered once the renderer is ready,
      // surviving the renderer's own initial load that cleared pending nav.
      if (entry.initialRoute) {
        const path = entry.initialRoute;
        entry.initialRoute = null;
        sendNavigation(entry, path);
        return;
      }
      if (entry.pendingNavigation) {
        const path = entry.pendingNavigation;
        entry.pendingNavigation = null;
        sendNavigation(entry, path);
      }
    },

    deliverNavigation(id: number, path: string) {
      const entry = liveEntryOf(id);
      if (!entry) return;
      sendNavigation(entry, path);
    },

    focusMostRecent(): CarrentWindowLike | null {
      const entry = resolveMostRecent();
      if (!entry) return null;
      return focusWindow(entry);
    },

    decideClose(id: number): CarrentWindowCloseDecision {
      const entry = entryOf(id);
      if (!entry) return { kind: "close" };
      const remaining = windows
        .filter((item) => item !== entry)
        .filter((item) => !item.window.isDestroyed());
      if (remaining.length > 0) return { kind: "close" };
      if (platform === "darwin") return { kind: "hide" };
      return { kind: "quit" };
    },

    handleSecondInstance(argv: string[]) {
      const resolution = resolveDeepLink(argv);
      const entry = resolveMostRecent();
      if (!entry) return;
      if (resolution?.kind === "valid") {
        sendNavigation(entry, resolution.path);
      } else if (resolution?.kind === "invalid") {
        sendNavigation(entry, "/workspace");
      } else {
        focusWindow(entry);
      }
    },

    handleOpenUrl(url: string) {
      const resolution = resolveDeepLink([url]);
      const entry = resolveMostRecent();
      if (!entry) return;
      if (resolution?.kind === "valid") {
        sendNavigation(entry, resolution.path);
      } else if (resolution?.kind === "invalid") {
        sendNavigation(entry, "/workspace");
      }
    },
  };
}

export type CarrentWindowRegistry = ReturnType<typeof createCarrentWindowRegistry>;
