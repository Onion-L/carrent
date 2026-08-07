import { WebContentsView, type BrowserWindow, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import type {
  BrowserBounds,
  BrowserMenuMode,
  BrowserMenuOpenRequest,
  BrowserMenuOverlayState,
  BrowserSearchEngine,
} from "../../src/shared/browser";

const MENU_WIDTH = 288;
const MENU_HEIGHTS: Record<BrowserMenuMode, number> = {
  main: 278,
  data: 131,
  settings: 167,
};

export type BrowserMenuOverlayRecord = BrowserMenuOverlayState & {
  ownerId: number;
};

type InternalRecord = BrowserMenuOverlayRecord & {
  anchor: BrowserBounds;
  host: BrowserWindow;
  view: WebContentsView;
  ready: boolean;
};

type BrowserMenuOverlayDependencies = {
  preloadPath: string;
  loadOverlay: (contents: WebContents) => void;
  onClosed: (record: BrowserMenuOverlayRecord) => void;
};

function boundsFor(anchor: BrowserBounds, mode: BrowserMenuMode): BrowserBounds {
  return {
    x: Math.max(0, Math.round(anchor.x + anchor.width - MENU_WIDTH)),
    y: Math.max(0, Math.round(anchor.y + anchor.height + 2)),
    width: MENU_WIDTH,
    height: MENU_HEIGHTS[mode],
  };
}

function publicRecord(record: InternalRecord): BrowserMenuOverlayRecord {
  const { ownerId, projectId, threadId, tabId, token, mode, zoomFactor, searchEngine, theme } =
    record;
  return { ownerId, projectId, threadId, tabId, token, mode, zoomFactor, searchEngine, theme };
}

export function createBrowserMenuOverlay({
  preloadPath,
  loadOverlay,
  onClosed,
}: BrowserMenuOverlayDependencies) {
  const byOwner = new Map<number, InternalRecord>();
  const byContents = new Map<number, InternalRecord>();

  const sendState = (record: InternalRecord) => {
    if (!record.ready || record.view.webContents.isDestroyed()) return;
    record.view.webContents.send("browser:menu-overlay-state", publicRecord(record));
  };

  const bringToFront = (ownerId: number) => {
    const record = byOwner.get(ownerId);
    if (!record || record.host.isDestroyed()) return;
    record.host.contentView.removeChildView(record.view);
    record.host.contentView.addChildView(record.view);
  };

  const discard = (record: InternalRecord, closeContents: boolean) => {
    if (byOwner.get(record.ownerId) !== record) return;
    byOwner.delete(record.ownerId);
    byContents.delete(record.view.webContents.id);
    if (!record.host.isDestroyed()) record.host.contentView.removeChildView(record.view);
    record.view.setVisible(false);
    if (closeContents && !record.view.webContents.isDestroyed()) record.view.webContents.close();
    onClosed(publicRecord(record));
  };

  const close = (ownerId: number, token?: string) => {
    const record = byOwner.get(ownerId);
    if (!record || (token && record.token !== token)) return;
    discard(record, true);
  };

  return {
    open(
      ownerId: number,
      host: BrowserWindow,
      request: BrowserMenuOpenRequest,
      zoomFactor: number,
      searchEngine: BrowserSearchEngine,
    ) {
      close(ownerId);
      const view = new WebContentsView({
        webPreferences: {
          preload: preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
          // electron-vite emits an ESM preload; Electron 41 sandboxed preloads reject it.
          sandbox: false,
        },
      });
      const record: InternalRecord = {
        ownerId,
        host,
        view,
        anchor: request.anchor,
        projectId: request.projectId,
        threadId: request.threadId,
        tabId: request.tabId,
        token: randomUUID(),
        mode: "main",
        zoomFactor,
        searchEngine,
        theme: request.theme,
        ready: false,
      };
      byOwner.set(ownerId, record);
      byContents.set(view.webContents.id, record);
      view.setBackgroundColor("#00000000");
      view.setBorderRadius(6);
      view.setBounds(boundsFor(record.anchor, record.mode));
      view.setVisible(false);
      host.contentView.addChildView(view);
      view.webContents.once("destroyed", () => discard(record, false));
      loadOverlay(view.webContents);
      return { token: record.token };
    },
    update(ownerId: number, token: string, anchor: BrowserBounds) {
      const record = byOwner.get(ownerId);
      if (!record || record.token !== token) return false;
      record.anchor = anchor;
      record.view.setBounds(boundsFor(anchor, record.mode));
      bringToFront(ownerId);
      return true;
    },
    updateState(ownerId: number, state: { zoomFactor: number; searchEngine: BrowserSearchEngine }) {
      const record = byOwner.get(ownerId);
      if (!record) return;
      record.zoomFactor = state.zoomFactor;
      record.searchEngine = state.searchEngine;
      sendState(record);
    },
    setMode(contentsId: number, token: string, mode: BrowserMenuMode) {
      const record = byContents.get(contentsId);
      if (!record || record.token !== token) return false;
      record.mode = mode;
      record.view.setBounds(boundsFor(record.anchor, mode));
      sendState(record);
      bringToFront(record.ownerId);
      return true;
    },
    ready(contentsId: number) {
      const record = byContents.get(contentsId);
      if (!record) throw new Error("Browser menu overlay not found.");
      record.ready = true;
      sendState(record);
      record.view.setVisible(true);
      bringToFront(record.ownerId);
    },
    requireSender(contentsId: number, token: string) {
      const record = byContents.get(contentsId);
      if (!record || record.token !== token) throw new Error("Browser menu overlay mismatch.");
      return publicRecord(record);
    },
    close,
    closeThread(threadId: string, exceptOwnerId?: number) {
      for (const record of byOwner.values()) {
        if (record.threadId === threadId && record.ownerId !== exceptOwnerId) close(record.ownerId);
      }
    },
    bringToFront,
  };
}
