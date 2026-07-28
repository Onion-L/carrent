import { describe, expect, it } from "bun:test";
import { createMainWindowLifecycle } from "./mainWindowLifecycle";

function createWindow() {
  const events: string[] = [];
  const navigations: string[] = [];
  let minimized = false;

  return {
    events,
    navigations,
    setMinimized(value: boolean) {
      minimized = value;
    },
    window: {
      isDestroyed: () => false,
      isMinimized: () => minimized,
      restore: () => {
        minimized = false;
        events.push("restore");
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

    lifecycle.handleRendererLoading();

    expect(loadingCount).toBe(1);
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
