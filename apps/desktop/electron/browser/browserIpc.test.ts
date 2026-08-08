import { describe, expect, it } from "bun:test";

import { registerBrowserIpc } from "./browserIpc";
import type { BrowserManager } from "./browserManager";

describe("registerBrowserIpc", () => {
  it("passes the Renderer owner to tab mutations", async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const calls: unknown[][] = [];
    const manager = {
      activateTab: (...args: unknown[]) => {
        calls.push(args);
        return {};
      },
    } as unknown as BrowserManager;

    registerBrowserIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      manager,
    );

    await handlers.get("browser:activate-tab")?.(
      { sender: { id: 17 } },
      { projectId: "project-1", threadId: "thread-1", tabId: "tab-1" },
    );

    expect(calls).toEqual([
      [17, { projectId: "project-1", threadId: "thread-1", tabId: "tab-1" }, "tab-1"],
    ]);
  });

  it("opens the menu for the requesting Renderer", async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const calls: unknown[][] = [];
    const manager = {
      openMenu: (...args: unknown[]) => {
        calls.push(args);
        return { token: "menu-1" };
      },
    } as unknown as BrowserManager;

    registerBrowserIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      manager,
    );

    const opened = await handlers.get("browser:menu-open")?.(
      { sender: { id: 17 } },
      {
        projectId: "project-1",
        threadId: "thread-1",
        tabId: "tab-1",
        anchor: { x: 500, y: 50, width: 32, height: 32 },
        theme: "dark",
      },
    );

    expect(calls).toEqual([
      [
        17,
        {
          projectId: "project-1",
          threadId: "thread-1",
          tabId: "tab-1",
          anchor: { x: 500, y: 50, width: 32, height: 32 },
          theme: "dark",
        },
      ],
    ]);
    expect(opened).toEqual({ token: "menu-1" });
  });

  it("updates the browser view theme", async () => {
    const handlers = new Map<string, (event: unknown, input?: unknown) => unknown>();
    const themes: string[] = [];
    const manager = {
      setTheme: (theme: string) => themes.push(theme),
    } as unknown as BrowserManager;

    registerBrowserIpc(
      {
        handle: (channel, listener) => handlers.set(channel, listener),
      },
      manager,
    );

    await handlers.get("browser:set-theme")?.({ sender: { id: 17 } }, "light");

    expect(themes).toEqual(["light"]);
  });
});
