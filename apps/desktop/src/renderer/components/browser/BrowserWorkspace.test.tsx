import { afterEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { BrowserThreadState, BrowserThreadTarget } from "../../../shared/browser";
import { BrowserWorkspace, useBrowserThread } from "./BrowserWorkspace";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function browserState(target: BrowserThreadTarget): BrowserThreadState {
  return {
    ...target,
    open: true,
    placement: "side",
    activeTabId: "tab-1",
    tabs: [
      {
        id: "tab-1",
        title: "New Tab",
        url: "",
        loading: false,
        canGoBack: false,
        canGoForward: false,
        zoomFactor: 1,
      },
    ],
    searchEngine: "google",
    focusSequence: 1,
    contentOwned: true,
  };
}

function BrowserStateProbe({ target }: { target: BrowserThreadTarget }) {
  const { state } = useBrowserThread(target);
  return <span>{state?.threadId ?? "none"}</span>;
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useBrowserThread", () => {
  it("clears the previous Thread state while the next Thread activates", async () => {
    const pending = new Map<string, (state: BrowserThreadState | null) => void>();
    window.carrent = {
      browser: {
        activate: async (target: BrowserThreadTarget | null) => {
          if (!target) return null;
          return new Promise<BrowserThreadState | null>((resolve) => {
            pending.set(target.threadId, resolve);
          });
        },
        onState: () => () => {},
      },
    } as unknown as typeof window.carrent;

    const first = { projectId: "project-1", threadId: "thread-1" };
    const second = { projectId: "project-1", threadId: "thread-2" };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<BrowserStateProbe target={first} />);
      await Promise.resolve();
    });
    await act(async () => pending.get(first.threadId)?.(browserState(first)));
    expect(container.textContent).toBe(first.threadId);

    await act(async () => {
      root?.render(<BrowserStateProbe target={second} />);
      await Promise.resolve();
    });

    expect(container.textContent).toBe("none");
    expect(pending.has(second.threadId)).toBe(true);
  });
});

describe("BrowserWorkspace menu", () => {
  it("opens the native menu overlay without hiding the live page", async () => {
    const visibleRequests: boolean[] = [];
    const menuRequests: unknown[] = [];
    window.carrent = {
      platform: "darwin",
      browser: {
        openMenu: async (request: unknown) => {
          menuRequests.push(request);
          return { token: "menu-1" };
        },
        updateMenu: async () => {},
        closeMenu: async () => {},
        onMenuAction: () => () => {},
        onMenuClosed: () => () => {},
        setVisible: async (request: BrowserThreadTarget & { visible: boolean }) => {
          visibleRequests.push(request.visible);
        },
        setBounds: async () => {},
        onFocusAddress: () => () => {},
        onFind: () => () => {},
        stopFind: async () => {},
      },
      clipboard: { writeText: async () => {} },
    } as unknown as typeof window.carrent;

    const target = { projectId: "project-1", threadId: "thread-1" };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <BrowserWorkspace
          target={target}
          state={{
            ...browserState(target),
            tabs: [{ ...browserState(target).tabs[0], url: "https://example.com" }],
          }}
          setState={() => {}}
          visible
        />,
      );
      await Promise.resolve();
    });

    const menuButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Browser menu"]',
    );
    if (!menuButton) throw new Error("Browser menu button not found.");
    menuButton.getBoundingClientRect = () =>
      ({
        x: 500,
        y: 50,
        top: 50,
        right: 532,
        bottom: 82,
        left: 500,
        width: 32,
        height: 32,
        toJSON: () => ({}),
      }) as DOMRect;
    await act(async () => {
      menuButton.click();
      await Promise.resolve();
    });

    expect(menuRequests).toEqual([
      {
        projectId: "project-1",
        threadId: "thread-1",
        tabId: "tab-1",
        anchor: { x: 500, y: 50, width: 32, height: 32 },
        theme: "dark",
      },
    ]);
    expect(visibleRequests.includes(false)).toBe(false);
    expect(container.textContent).not.toContain("Find in page");
  });

  it("toggles browser fullscreen in the current window without popping out", async () => {
    const popOutRequests: unknown[] = [];
    let fullscreenToggles = 0;
    window.carrent = {
      platform: "darwin",
      browser: {
        setVisible: async () => {},
        setBounds: async () => {},
        onFocusAddress: () => () => {},
        onFind: () => () => {},
        onMenuAction: () => () => {},
        onMenuClosed: () => () => {},
        popOut: async (target: unknown) => {
          popOutRequests.push(target);
          return browserState({ projectId: "project-1", threadId: "thread-1" });
        },
        stopFind: async () => {},
      },
      clipboard: { writeText: async () => {} },
    } as unknown as typeof window.carrent;

    const target = { projectId: "project-1", threadId: "thread-1" };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <BrowserWorkspace
          target={target}
          state={browserState(target)}
          setState={() => {}}
          visible
          onToggleFullscreen={() => {
            fullscreenToggles += 1;
          }}
        />,
      );
      await Promise.resolve();
    });

    const fullscreenButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Enter browser fullscreen"]',
    );
    if (!fullscreenButton) throw new Error("Browser fullscreen button not found.");

    await act(async () => {
      fullscreenButton.click();
      await Promise.resolve();
    });

    expect(fullscreenToggles).toBe(1);
    expect(popOutRequests).toHaveLength(0);
  });
});
