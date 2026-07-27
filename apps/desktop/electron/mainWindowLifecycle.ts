type MainWindowLike = {
  isDestroyed: () => boolean;
  isMinimized: () => boolean;
  restore: () => void;
  focus: () => void;
  webContents: {
    send: (channel: string, path: string) => void;
  };
};

type MainWindowLifecycleDependencies = {
  getMainWindow: () => MainWindowLike | null;
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

export function createMainWindowLifecycle({ getMainWindow }: MainWindowLifecycleDependencies) {
  let pendingNavigation: string | null = null;
  let rendererReady = false;

  const focusMainWindow = () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return mainWindow;
  };

  const navigate = (path: string) => {
    const mainWindow = focusMainWindow();
    if (!mainWindow || !rendererReady) {
      pendingNavigation = path;
      return;
    }
    mainWindow.webContents.send("app:navigate", path);
  };

  return {
    handleSecondInstance(argv: string[]) {
      const resolution = resolveDeepLink(argv);
      if (resolution?.kind === "valid") {
        navigate(resolution.path);
      } else if (resolution?.kind === "invalid") {
        navigate("/workspace");
      } else {
        focusMainWindow();
      }
    },
    handleOpenUrl(url: string) {
      const resolution = resolveDeepLink([url]);
      if (resolution?.kind === "valid") {
        navigate(resolution.path);
      } else if (resolution?.kind === "invalid") {
        navigate("/workspace");
      }
    },
    handleRendererLoading() {
      rendererReady = false;
    },
    handleRendererReady() {
      rendererReady = true;
      if (!pendingNavigation) return;
      const path = pendingNavigation;
      pendingNavigation = null;
      navigate(path);
    },
    focusMainWindow,
  };
}
