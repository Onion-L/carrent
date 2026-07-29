import { describe, expect, it } from "bun:test";
import { createMainWindowLifecycle } from "./mainWindowLifecycle";

function createWindow() {
  const events: string[] = [];
  const navigations: string[] = [];
  let minimized = false;
  let visible = true;

  return {
    events,
    navigations,
    setMinimized(value: boolean) {
      minimized = value;
    },
    setVisible(value: boolean) {
      visible = value;
    },
    window: {
      isDestroyed: () => false,
      isMinimized: () => minimized,
      isVisible: () => visible,
      restore: () => {
        minimized = false;
        events.push("restore");
      },
      show: () => {
        visible = true;
        events.push("show");
      },
      hide: () => {
        visible = false;
        events.push("hide");
      },
      focus: () => events.push("focus"),
      webContents: {
        send: (_channel: string, path: string) => navigations.push(path),
      },
    },
  };
}

describe("createMainWindowLifecycle", () => {
  it("focuses the existing Main Window on a repeated ordinary launch without navigating", () => {
    const fake = createWindow();
    fake.setMinimized(true);
    const lifecycle = createMainWindowLifecycle({ getMainWindow: () => fake.window });

    lifecycle.handleSecondInstance(["/Applications/Carrent"]);

    expect(fake.events).toEqual(["restore", "focus"]);
    expect(fake.navigations).toEqual([]);
  });

  it("shows a hidden Main Window when Carrent is activated again", () => {
    const fake = createWindow();
    fake.setVisible(false);
    const lifecycle = createMainWindowLifecycle({ getMainWindow: () => fake.window });

    lifecycle.focusMainWindow();

    expect(fake.events).toEqual(["show", "focus"]);
  });

  it("hides the Main Window instead of quitting when it is closed on macOS", () => {
    const fake = createWindow();
    let quitCount = 0;
    let preventDefaultCount = 0;
    const lifecycle = createMainWindowLifecycle({
      getMainWindow: () => fake.window,
      platform: "darwin",
      isQuitting: () => false,
      requestQuit: () => {
        quitCount += 1;
      },
    });

    lifecycle.handleWindowClose({
      preventDefault: () => {
        preventDefaultCount += 1;
      },
    });

    expect(preventDefaultCount).toBe(1);
    expect(fake.events).toEqual(["hide"]);
    expect(quitCount).toBe(0);
  });

  it("allows the Main Window to close while Carrent is quitting", () => {
    const fake = createWindow();
    let preventDefaultCount = 0;
    const lifecycle = createMainWindowLifecycle({
      getMainWindow: () => fake.window,
      platform: "darwin",
      isQuitting: () => true,
      requestQuit: () => {},
    });

    lifecycle.handleWindowClose({
      preventDefault: () => {
        preventDefaultCount += 1;
      },
    });

    expect(preventDefaultCount).toBe(0);
    expect(fake.events).toEqual([]);
  });

  it("quits Carrent when the Main Window is closed outside macOS", () => {
    const fake = createWindow();
    let quitCount = 0;
    const lifecycle = createMainWindowLifecycle({
      getMainWindow: () => fake.window,
      platform: "win32",
      isQuitting: () => false,
      requestQuit: () => {
        quitCount += 1;
      },
    });

    lifecycle.handleWindowClose({ preventDefault: () => {} });

    expect(fake.events).toEqual([]);
    expect(quitCount).toBe(1);
  });

  it("focuses and navigates the existing Main Window for a three-level deep link", () => {
    const fake = createWindow();
    const lifecycle = createMainWindowLifecycle({ getMainWindow: () => fake.window });
    lifecycle.handleRendererReady();

    lifecycle.handleSecondInstance([
      "/Applications/Carrent",
      "carrent://workspace/workspace-1/project/project-1/thread/thread-1",
    ]);

    expect(fake.events).toEqual(["focus"]);
    expect(fake.navigations).toEqual(["/workspace/workspace-1/project/project-1/thread/thread-1"]);
  });

  it("keeps a deep link until the renderer navigation listener is ready", () => {
    const fake = createWindow();
    const lifecycle = createMainWindowLifecycle({ getMainWindow: () => fake.window });

    lifecycle.handleOpenUrl("carrent://workspace/missing-workspace");
    expect(fake.events).toEqual(["focus"]);
    expect(fake.navigations).toEqual([]);

    lifecycle.handleRendererReady();

    expect(fake.events).toEqual(["focus", "focus"]);
    expect(fake.navigations).toEqual(["/workspace/missing-workspace"]);
  });

  it("notifies the Main Process when the Renderer starts loading", () => {
    const fake = createWindow();
    let loadingCount = 0;
    const lifecycle = createMainWindowLifecycle({
      getMainWindow: () => fake.window,
      onRendererLoading: () => {
        loadingCount += 1;
      },
    });

    lifecycle.handleRendererNavigationStart({ isSameDocument: false, isMainFrame: true });

    expect(loadingCount).toBe(1);
  });

  it("does not treat an in-page route navigation as a Renderer reload", () => {
    const fake = createWindow();
    let loadingCount = 0;
    const lifecycle = createMainWindowLifecycle({
      getMainWindow: () => fake.window,
      onRendererLoading: () => {
        loadingCount += 1;
      },
    });

    lifecycle.handleRendererNavigationStart({ isSameDocument: true, isMainFrame: true });

    expect(loadingCount).toBe(0);
  });

  it("focuses and routes an unsupported Carrent URL through the established fallback", () => {
    const fake = createWindow();
    const lifecycle = createMainWindowLifecycle({ getMainWindow: () => fake.window });
    lifecycle.handleRendererReady();

    lifecycle.handleOpenUrl("carrent://settings");

    expect(fake.events).toEqual(["focus"]);
    expect(fake.navigations).toEqual(["/workspace"]);
  });
});
