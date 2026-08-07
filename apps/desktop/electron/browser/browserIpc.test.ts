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
});
