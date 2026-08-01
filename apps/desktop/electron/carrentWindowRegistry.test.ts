import { describe, expect, it } from "bun:test";

import { createCarrentWindowRegistry, type CarrentWindowLike } from "./carrentWindowRegistry";

type FakeOptions = {
  id: number;
  destroyed?: boolean;
  minimized?: boolean;
  visible?: boolean;
};

function createFakeWindow({
  id,
  destroyed = false,
  minimized = false,
  visible = true,
}: FakeOptions) {
  const events: string[] = [];
  const sent: Array<{ channel: string; path?: string }> = [];
  const window: CarrentWindowLike = {
    id,
    isDestroyed: () => destroyed,
    isMinimized: () => minimized,
    isVisible: () => visible,
    restore: () => events.push("restore"),
    show: () => events.push("show"),
    hide: () => events.push("hide"),
    focus: () => events.push("focus"),
    webContents: {
      send: (channel: string, path?: string) => sent.push({ channel, path }),
    },
  };
  return { window, events, sent, setDestroyed: (next: boolean) => (destroyed = next) };
}

function createRegistry(platform: NodeJS.Platform = "darwin") {
  const registry = createCarrentWindowRegistry({ platform });
  return { registry };
}

describe("createCarrentWindowRegistry — registration and activation order", () => {
  it("tracks registered windows and reports a zero count initially", () => {
    const { registry } = createRegistry();
    expect(registry.count()).toBe(0);
    expect(registry.getActive()).toBe(null);

    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);

    expect(registry.count()).toBe(1);
    expect(registry.getActive()).toBe(first.window);
  });

  it("moves the most recently focused window to the top of the activation order", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    const second = createFakeWindow({ id: 2 });
    registry.register(first.window);
    registry.register(second.window);

    expect(registry.getActive()).toBe(second.window);

    registry.setActive(1);

    expect(registry.getActive()).toBe(first.window);
  });

  it("keeps the activation order stable when an already-active window is activated again", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    const second = createFakeWindow({ id: 2 });
    registry.register(first.window);
    registry.register(second.window);
    registry.setActive(1);

    // Activating the already-active window again changes nothing.
    registry.setActive(1);
    registry.setActive(1);

    expect(registry.getAll().map((item) => item.id)).toEqual([2, 1]);
  });

  it("ignores activation for an unknown window", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);

    registry.setActive(99);

    expect(registry.getActive()).toBe(first.window);
  });
});

describe("createCarrentWindowRegistry — focus and most-recent targeting", () => {
  it("restores, shows, and focuses a minimized hidden most-recent window", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1, minimized: true, visible: false });
    registry.register(first.window);

    registry.focusMostRecent();

    expect(first.events).toEqual(["restore", "show", "focus"]);
  });

  it("returns null when no registered window remains", () => {
    const { registry } = createRegistry();
    expect(registry.focusMostRecent()).toBe(null);
  });

  it("skips a destroyed most-recent window and focuses the next one", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    const second = createFakeWindow({ id: 2, destroyed: true });
    registry.register(first.window);
    registry.register(second.window);

    const focused = registry.focusMostRecent();

    expect(focused).toBe(first.window);
    expect(first.events).toContain("focus");
  });
});

describe("createCarrentWindowRegistry — renderer readiness and pending navigation", () => {
  it("holds a navigation until the target renderer reports ready, then delivers it", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.markLoading(1);

    registry.deliverNavigation(1, "/workspace/w/project/p/thread/t");

    expect(first.sent).toEqual([]);

    registry.markReady(1);

    expect(first.sent).toEqual([
      { channel: "app:navigate", path: "/workspace/w/project/p/thread/t" },
    ]);
  });

  it("delivers a navigation immediately when the renderer is already ready", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.markReady(1);

    registry.deliverNavigation(1, "/workspace/w/project/p/thread/t");

    expect(first.sent).toEqual([
      { channel: "app:navigate", path: "/workspace/w/project/p/thread/t" },
    ]);
  });

  it("drops a pending navigation if the renderer starts loading again before becoming ready", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.markLoading(1);

    registry.deliverNavigation(1, "/workspace/w");
    // The renderer reloads before the pending navigation is delivered.
    registry.markLoading(1);
    registry.markReady(1);

    expect(first.sent).toEqual([]);
  });

  it("remembers the route it delivered so each window keeps an independent route", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    const second = createFakeWindow({ id: 2 });
    registry.register(first.window);
    registry.register(second.window);
    registry.markReady(1);
    registry.markReady(2);

    registry.deliverNavigation(1, "/workspace/alpha");
    registry.deliverNavigation(2, "/workspace/beta/project/gamma");

    expect(registry.getRoute(1)).toBe("/workspace/alpha");
    expect(registry.getRoute(2)).toBe("/workspace/beta/project/gamma");
  });

  it("delivers a new window's initial route even though its own load cleared pending nav", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.setInitialRoute(1, "/workspace/w/project/p/thread/t");

    // The new renderer's own initial load reports as a navigation start.
    registry.markLoading(1);

    registry.markReady(1);

    expect(first.sent).toEqual([
      { channel: "app:navigate", path: "/workspace/w/project/p/thread/t" },
    ]);
  });

  it("delivers the initial route only once and never again on later reloads", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.setInitialRoute(1, "/workspace/w");
    registry.markReady(1);

    // A later reload becomes ready again; the initial route is not redelivered.
    registry.markLoading(1);
    registry.markReady(1);

    expect(first.sent).toEqual([{ channel: "app:navigate", path: "/workspace/w" }]);
  });
});

describe("createCarrentWindowRegistry — closure of peer windows", () => {
  it("closes only the unregistered window when other Carrent Windows remain", () => {
    const { registry } = createRegistry("darwin");
    const first = createFakeWindow({ id: 1 });
    const second = createFakeWindow({ id: 2 });
    registry.register(first.window);
    registry.register(second.window);

    expect(registry.decideClose(1)).toEqual({ kind: "close" });

    registry.unregister(1);

    expect(registry.count()).toBe(1);
    expect(registry.getActive()).toBe(second.window);
  });

  it("requests Quit when the final window closes on Windows", () => {
    const { registry } = createRegistry("win32");
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);

    // decideClose returns the decision; the caller (main.ts) requests Quit.
    expect(registry.decideClose(1)).toEqual({ kind: "quit" });
    expect(first.events).toEqual([]);
  });

  it("destroys the final window on macOS instead of quitting or hiding", () => {
    const { registry } = createRegistry("darwin");
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);

    expect(registry.decideClose(1)).toEqual({ kind: "destroy" });
  });

  it("treats an unknown window close as a plain close", () => {
    const { registry } = createRegistry("darwin");
    expect(registry.decideClose(99)).toEqual({ kind: "close" });
  });

  it("does not let a closed window stay as the most-recent window", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    const second = createFakeWindow({ id: 2 });
    registry.register(first.window);
    registry.register(second.window);
    registry.setActive(2);

    registry.unregister(2);

    expect(registry.getActive()).toBe(first.window);
  });
});

describe("createCarrentWindowRegistry — repeated launch and deep links", () => {
  it("focuses the most recent window on a repeated ordinary launch without navigating", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.markReady(1);

    registry.handleSecondInstance(["/Applications/Carrent"]);

    expect(first.events).toEqual(["focus"]);
    expect(first.sent).toEqual([]);
  });

  it("navigates the most recent window to a valid Thread deep link", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.markReady(1);

    registry.handleSecondInstance([
      "/Applications/Carrent",
      "carrent://workspace/w-1/project/p-1/thread/t-1",
    ]);

    expect(first.sent).toEqual([
      { channel: "app:navigate", path: "/workspace/w-1/project/p-1/thread/t-1" },
    ]);
  });

  it("focuses the most recent window already showing the deep-linked Thread", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    const second = createFakeWindow({ id: 2 });
    const third = createFakeWindow({ id: 3 });
    registry.register(first.window);
    registry.register(second.window);
    registry.register(third.window);
    registry.markReady(1);
    registry.markReady(2);
    registry.markReady(3);
    registry.setRoute(1, "/workspace/w-1/project/p-1/thread/t-1");
    registry.setRoute(2, "/workspace/w-1/project/p-1/thread/t-1");
    registry.setRoute(3, "/workspace/w-2");
    registry.setActive(2);
    registry.setActive(3);

    registry.handleOpenUrl("carrent://workspace/w-1/project/p-1/thread/t-1");

    expect(first.events).toEqual([]);
    expect(second.events).toEqual(["focus"]);
    expect(second.sent).toEqual([]);
    expect(third.events).toEqual([]);
    expect(third.sent).toEqual([]);
  });

  it("replaces a restored initial route when a deep link arrives before readiness", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.setInitialRoute(1, "/workspace/old");

    registry.handleOpenUrl("carrent://workspace/new/project/p-1/thread/t-1");
    registry.markReady(1);

    expect(first.sent).toEqual([
      { channel: "app:navigate", path: "/workspace/new/project/p-1/thread/t-1" },
    ]);
  });

  it("holds the deep-link navigation until the renderer becomes ready", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);

    registry.handleOpenUrl("carrent://workspace/w-1/project/p-1/thread/t-1");
    expect(first.sent).toEqual([]);

    registry.markReady(1);

    expect(first.sent).toEqual([
      { channel: "app:navigate", path: "/workspace/w-1/project/p-1/thread/t-1" },
    ]);
  });

  it("routes an unsupported Carrent URL through the established fallback", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.markReady(1);

    registry.handleOpenUrl("carrent://settings");

    expect(first.sent).toEqual([{ channel: "app:navigate", path: "/workspace" }]);
  });

  it("signals a window must be created with the deep-link route when no window exists", () => {
    const { registry } = createRegistry();

    expect(
      registry.handleSecondInstance([
        "/Applications/Carrent",
        "carrent://workspace/w-1/project/p-1/thread/t-1",
      ]),
    ).toEqual({ needsWindow: true, route: "/workspace/w-1/project/p-1/thread/t-1" });
  });

  it("signals a window must be created with the fallback route for an invalid deep link", () => {
    const { registry } = createRegistry();

    expect(registry.handleOpenUrl("carrent://settings")).toEqual({
      needsWindow: true,
      route: "/workspace",
    });
  });

  it("signals a window must be created with no route on an ordinary relaunch with no window", () => {
    const { registry } = createRegistry();

    expect(registry.handleSecondInstance(["/Applications/Carrent"])).toEqual({
      needsWindow: true,
      route: null,
    });
  });

  it("reports no window needed and no route when a window already received the deep link", () => {
    const { registry } = createRegistry();
    const first = createFakeWindow({ id: 1 });
    registry.register(first.window);
    registry.markReady(1);

    expect(
      registry.handleSecondInstance([
        "/Applications/Carrent",
        "carrent://workspace/w-1/project/p-1/thread/t-1",
      ]),
    ).toEqual({ needsWindow: false, route: null });
  });
});
