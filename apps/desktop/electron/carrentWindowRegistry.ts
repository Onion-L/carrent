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
  // The final window on macOS is destroyed, leaving Carrent alive with no
  // window. Dock activation or a repeated launch re-creates one.
  | { kind: "destroy" }
  // The final window on Windows and Linux requests application Quit.
  | { kind: "quit" };

// Result of a second-instance launch or deep link. When no Carrent Window
// exists the caller must create one (optionally with the deep-link route).
export type CarrentWindowTargeting = {
  needsWindow: boolean;
  // The route to deliver, if any. A valid deep link yields its route; an
  // invalid one yields the established fallback; an ordinary relaunch is null
  // (focus the most recent window or create a default one).
  route: string | null;
};

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
  focusWhenReady: boolean;
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

  // Terminal focus is reported per-renderer (keyed by webContents id) so the
  // main process can decide whether Cmd+W should close a terminal tab instead
  // of the window. It is reset on navigation, cleanup, and renderer blur.
  const terminalFocusedByContents = new Map<number, boolean>();

  const entryOf = (id: number) => windows.find((item) => item.window.id === id);
  const liveEntryOf = (id: number) => {
    const entry = entryOf(id);
    if (!entry || entry.window.isDestroyed()) return undefined;
    return entry;
  };

  function sendNavigation(target: RegisteredWindow, path: string) {
    target.route = path;
    if (!target.ready) {
      if (target.initialRoute !== null) {
        target.initialRoute = path;
      } else {
        target.pendingNavigation = path;
      }
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

  function resolveMostRecentShowing(path: string): RegisteredWindow | undefined {
    for (let index = windows.length - 1; index >= 0; index -= 1) {
      const entry = windows[index];
      if (!entry.window.isDestroyed() && entry.route === path) return entry;
    }
    return undefined;
  }

  function targetRoute(path: string) {
    const matching = resolveMostRecentShowing(path);
    if (matching) {
      if (matching.ready) {
        focusWindow(matching);
      } else {
        matching.focusWhenReady = true;
      }
      return;
    }

    const entry = resolveMostRecent();
    if (entry) sendNavigation(entry, path);
  }

  return {
    register(window: CarrentWindowLike) {
      windows.push({
        window,
        ready: false,
        focusWhenReady: false,
        pendingNavigation: null,
        initialRoute: null,
        route: null,
      });
    },

    setInitialRoute(id: number, path: string) {
      const entry = entryOf(id);
      if (!entry) return;
      entry.initialRoute = path;
      entry.route = path;
    },

    setRoute(id: number, path: string) {
      const entry = liveEntryOf(id);
      if (entry) entry.route = path;
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

    markLoading(
      id: number,
      navigation: RendererNavigationStart = {
        isSameDocument: false,
        isMainFrame: true,
      },
    ) {
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
      } else if (entry.pendingNavigation) {
        const path = entry.pendingNavigation;
        entry.pendingNavigation = null;
        sendNavigation(entry, path);
      }
      if (entry.focusWhenReady) {
        entry.focusWhenReady = false;
        focusWindow(entry);
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

    handleRoute(path: string) {
      targetRoute(path);
    },

    decideClose(id: number): CarrentWindowCloseDecision {
      const entry = entryOf(id);
      if (!entry) return { kind: "close" };
      const remaining = windows
        .filter((item) => item !== entry)
        .filter((item) => !item.window.isDestroyed());
      if (remaining.length > 0) return { kind: "close" };
      if (platform === "darwin") return { kind: "destroy" };
      return { kind: "quit" };
    },

    handleSecondInstance(argv: string[]): CarrentWindowTargeting {
      const resolution = resolveDeepLink(argv);
      const entry = resolveMostRecent();
      if (!entry) {
        // No Carrent Window exists; the caller creates one, optionally with the
        // deep-link route as its initial path.
        return {
          needsWindow: true,
          route:
            resolution?.kind === "valid"
              ? resolution.path
              : resolution?.kind === "invalid"
                ? "/workspace"
                : null,
        };
      }
      if (resolution?.kind === "valid") {
        targetRoute(resolution.path);
      } else if (resolution?.kind === "invalid") {
        sendNavigation(entry, "/workspace");
      } else {
        focusWindow(entry);
      }
      return { needsWindow: false, route: null };
    },

    handleOpenUrl(url: string): CarrentWindowTargeting {
      const resolution = resolveDeepLink([url]);
      const entry = resolveMostRecent();
      if (!entry) {
        return {
          needsWindow: true,
          route:
            resolution?.kind === "valid"
              ? resolution.path
              : resolution?.kind === "invalid"
                ? "/workspace"
                : null,
        };
      }
      if (resolution?.kind === "valid") {
        targetRoute(resolution.path);
      } else if (resolution?.kind === "invalid") {
        sendNavigation(entry, "/workspace");
      }
      return { needsWindow: false, route: null };
    },

    setTerminalFocused(contentsId: number, focused: boolean) {
      if (!focused) {
        terminalFocusedByContents.delete(contentsId);
        return;
      }
      terminalFocusedByContents.set(contentsId, true);
    },

    isTerminalFocused(contentsId: number) {
      return terminalFocusedByContents.get(contentsId) === true;
    },
  };
}

export type CarrentWindowRegistry = ReturnType<typeof createCarrentWindowRegistry>;
