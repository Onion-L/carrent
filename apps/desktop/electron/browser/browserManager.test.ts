import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

type Listener = (...args: any[]) => void;

const createContentsId = (() => {
  let next = 100;
  return () => next++;
})();
const contentsById = new Map<number, FakeWebContents>();
const windowsByContentsId = new Map<number, FakeBrowserWindow>();
const createdViews: FakeWebContentsView[] = [];

class FakeWebContents {
  readonly sent: Array<[string, unknown]> = [];
  readonly listeners = new Map<string, Listener[]>();
  readonly navigationHistory = {
    canGoBack: () => false,
    canGoForward: () => false,
    goBack: () => {},
    goForward: () => {},
  };
  id: number;
  closed = false;
  url = "about:blank";
  zoomFactor = 1;

  constructor(id = createContentsId()) {
    this.id = id;
    contentsById.set(id, this);
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  send(channel: string, value: unknown) {
    this.sent.push([channel, value]);
  }

  isDestroyed() {
    return this.closed;
  }

  async loadURL(url: string) {
    this.url = url;
  }

  getURL() {
    return this.url;
  }

  getTitle() {
    return this.url === "about:blank" ? "" : this.url;
  }

  isLoading() {
    return false;
  }

  getZoomFactor() {
    return this.zoomFactor;
  }

  setZoomFactor(value: number) {
    this.zoomFactor = value;
  }

  setWindowOpenHandler() {}
  reload() {}
  stop() {}
  openDevTools() {}
  findInPage() {}
  stopFindInPage() {}

  close() {
    this.closed = true;
    contentsById.delete(this.id);
  }
}

class FakeWebContentsView {
  readonly webContents = new FakeWebContents();
  bounds: unknown = null;
  visible = false;

  constructor() {
    createdViews.push(this);
  }

  setBounds(bounds: unknown) {
    this.bounds = bounds;
  }

  setVisible(visible: boolean) {
    this.visible = visible;
  }
}

class FakeBrowserWindow {
  readonly contentView = {
    children: new Set<FakeWebContentsView>(),
    addChildView: (view: FakeWebContentsView) => this.contentView.children.add(view),
    removeChildView: (view: FakeWebContentsView) => this.contentView.children.delete(view),
  };
  readonly listeners = new Map<string, Listener[]>();
  readonly webContents: FakeWebContents;
  destroyed = false;

  constructor(contentsId = createContentsId()) {
    this.webContents = new FakeWebContents(contentsId);
    windowsByContentsId.set(contentsId, this);
  }

  static fromWebContents(contents: FakeWebContents) {
    return windowsByContentsId.get(contents.id) ?? null;
  }

  on(event: string, listener: Listener) {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
  }

  emit(event: string) {
    for (const listener of this.listeners.get(event) ?? []) listener();
  }

  isDestroyed() {
    return this.destroyed;
  }

  show() {}
  hide() {}

  close() {
    this.destroy();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents.close();
    this.emit("closed");
  }
}

mock.module("electron", () => ({
  BrowserWindow: FakeBrowserWindow,
  WebContentsView: FakeWebContentsView,
  session: {
    fromPartition: () => ({
      setPermissionCheckHandler: () => {},
      setPermissionRequestHandler: () => {},
      on: () => {},
      clearCache: async () => {},
      clearStorageData: async () => {},
    }),
  },
  shell: { openExternal: async () => {} },
  webContents: { fromId: (id: number) => contentsById.get(id) ?? null },
}));

const { createBrowserManager } = await import("./browserManager");

afterEach(() => {
  contentsById.clear();
  windowsByContentsId.clear();
  createdViews.length = 0;
});

describe("BrowserManager", () => {
  it("moves native content ownership without leaving stale state in another window", async () => {
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-manager-"));
    try {
      const firstWindow = new FakeBrowserWindow(17);
      const secondWindow = new FakeBrowserWindow(18);
      const target = { projectId: "project-1", threadId: "thread-1" };
      const manager = createBrowserManager({
        userDataPath: directory,
        createAuxiliaryWindow: () => new FakeBrowserWindow() as never,
        resolveOwner: () => 17,
        resolveProjectTarget: () => ({ ownerId: 17, target }),
      });

      manager.activate(17, target);
      await manager.open(17, target);
      manager.setBounds(17, target, { x: 0, y: 0, width: 500, height: 400 });
      manager.setVisible(17, target, true);
      manager.activate(18, target);
      manager.setBounds(18, target, { x: 10, y: 20, width: 600, height: 450 });
      manager.setVisible(18, target, true);
      manager.focusOwner(18);

      expect(manager.getState(17, target).contentOwned).toBe(false);
      expect(manager.getState(18, target).contentOwned).toBe(true);
      expect(firstWindow.contentView.children.size).toBe(0);
      expect(secondWindow.contentView.children.size).toBe(1);
      const firstWindowState = contentsById.get(17)?.sent.at(-1)?.[1] as
        | { contentOwned: boolean }
        | undefined;
      expect(firstWindowState?.contentOwned).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("destroys tabs and an auxiliary window when their Thread is deleted", async () => {
    const directory = mkdtempSync(join(tmpdir(), "carrent-browser-manager-"));
    try {
      new FakeBrowserWindow(17);
      const target = { projectId: "project-1", threadId: "thread-1" };
      let auxiliaryWindow: FakeBrowserWindow | null = null;
      const manager = createBrowserManager({
        userDataPath: directory,
        createAuxiliaryWindow: () => {
          auxiliaryWindow = new FakeBrowserWindow();
          return auxiliaryWindow as never;
        },
        resolveOwner: () => 17,
        resolveProjectTarget: () => ({ ownerId: 17, target }),
      });

      manager.activate(17, target);
      await manager.open(17, target);
      manager.popOut(17, target);
      manager.deleteThreads([target.threadId]);

      expect(createdViews[0].webContents.closed).toBe(true);
      expect((auxiliaryWindow as FakeBrowserWindow | null)?.destroyed).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
