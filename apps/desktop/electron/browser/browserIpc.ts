import type {
  BrowserActionRequest,
  BrowserBounds,
  BrowserClearDataRequest,
  BrowserMenuAction,
  BrowserMenuCloseRequest,
  BrowserMenuOpenRequest,
  BrowserMenuUpdateRequest,
  BrowserNavigateRequest,
  BrowserOpenRequest,
  BrowserSearchEngine,
  BrowserTabTarget,
  BrowserThreadTarget,
  BrowserZoomRequest,
} from "../../src/shared/browser";
import type { BrowserManager } from "./browserManager";

type IpcMainLike = {
  handle: (channel: string, listener: (event: unknown, input?: unknown) => unknown) => void;
};

type SenderEvent = { sender: { id: number } };

function senderId(event: unknown) {
  const id = (event as Partial<SenderEvent>)?.sender?.id;
  if (!Number.isInteger(id)) throw new Error("Unexpected browser owner.");
  return id as number;
}

function record(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Invalid browser request.");
  }
  return input as Record<string, unknown>;
}

function text(input: Record<string, unknown>, key: string, max = 4_096) {
  const value = input[key];
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new Error(`Invalid browser ${key}.`);
  }
  return value;
}

function target(input: unknown): BrowserThreadTarget {
  const value = record(input);
  return { threadId: text(value, "threadId", 256), projectId: text(value, "projectId", 256) };
}

function tabTarget(input: unknown): BrowserTabTarget {
  const value = record(input);
  return { ...target(value), tabId: text(value, "tabId", 256) };
}

function bounds(input: unknown): BrowserBounds {
  const value = record(input);
  const result = { x: value.x, y: value.y, width: value.width, height: value.height };
  if (!Object.values(result).every((item) => typeof item === "number" && Number.isFinite(item))) {
    throw new Error("Invalid browser bounds.");
  }
  return result as BrowserBounds;
}

function menuOpenRequest(input: unknown): BrowserMenuOpenRequest {
  const value = record(input);
  const request = tabTarget(value);
  if (value.theme !== "light" && value.theme !== "dark") {
    throw new Error("Invalid browser menu theme.");
  }
  return { ...request, anchor: bounds(value.anchor), theme: value.theme };
}

function menuAction(input: unknown): BrowserMenuAction {
  const value = record(input);
  const type = text(value, "type", 32);
  if (type === "set-mode") {
    if (!(["main", "data", "settings"] as unknown[]).includes(value.mode)) {
      throw new Error("Invalid browser menu mode.");
    }
    return { type, mode: value.mode as "main" | "data" | "settings" };
  }
  if (type === "zoom") {
    if (!(["in", "out", "reset"] as unknown[]).includes(value.action)) {
      throw new Error("Invalid browser zoom action.");
    }
    return { type, action: value.action as "in" | "out" | "reset" };
  }
  if (type === "clear-data") {
    if (value.scope !== "project" && value.scope !== "all") {
      throw new Error("Invalid browser data scope.");
    }
    return { type, scope: value.scope };
  }
  if (type === "set-search-engine") {
    const searchEngine = text(value, "searchEngine", 32);
    if (!["google", "bing", "duckduckgo"].includes(searchEngine)) {
      throw new Error("Invalid browser search engine.");
    }
    return { type, searchEngine: searchEngine as BrowserSearchEngine };
  }
  if (type === "find" || type === "copy-link" || type === "open-external" || type === "devtools") {
    return { type };
  }
  throw new Error("Invalid browser menu action.");
}

export function registerBrowserIpc(ipcMain: IpcMainLike, manager: BrowserManager) {
  ipcMain.handle("browser:activate", (event, input) =>
    manager.activate(senderId(event), input === null ? null : target(input)),
  );
  ipcMain.handle("browser:open", (event, input) => {
    const value = record(input) as BrowserOpenRequest & Record<string, unknown>;
    return manager.open(
      senderId(event),
      target(value),
      typeof value.url === "string" ? value.url.slice(0, 4_096) : undefined,
    );
  });
  ipcMain.handle("browser:new-tab", (event, input) =>
    manager.newTab(senderId(event), target(input)),
  );
  ipcMain.handle("browser:activate-tab", (event, input) => {
    const request = tabTarget(input);
    return manager.activateTab(senderId(event), request, request.tabId);
  });
  ipcMain.handle("browser:close-tab", (event, input) => {
    const request = tabTarget(input);
    return manager.closeTab(senderId(event), request, request.tabId);
  });
  ipcMain.handle("browser:navigate", async (event, input) => {
    const value = record(input) as BrowserNavigateRequest & Record<string, unknown>;
    const request = tabTarget(value);
    return manager.navigate(senderId(event), request, request.tabId, text(value, "value"));
  });
  ipcMain.handle("browser:action", (event, input) => {
    const value = record(input) as BrowserActionRequest & Record<string, unknown>;
    const request = tabTarget(value);
    if (!["back", "forward", "reload", "stop", "devtools"].includes(String(value.action))) {
      throw new Error("Invalid browser action.");
    }
    return manager.action(senderId(event), request, request.tabId, value.action);
  });
  ipcMain.handle("browser:zoom", (event, input) => {
    const value = record(input) as BrowserZoomRequest & Record<string, unknown>;
    const request = tabTarget(value);
    if (!["in", "out", "reset"].includes(String(value.action))) {
      throw new Error("Invalid browser zoom action.");
    }
    return manager.zoom(senderId(event), request, request.tabId, value.action);
  });
  ipcMain.handle("browser:menu-open", (event, input) => {
    return manager.openMenu(senderId(event), menuOpenRequest(input));
  });
  ipcMain.handle("browser:menu-update", (event, input) => {
    const value = record(input);
    const request = tabTarget(value);
    manager.updateMenu(senderId(event), {
      ...request,
      token: text(value, "token", 256),
      anchor: bounds(value.anchor),
    } satisfies BrowserMenuUpdateRequest);
  });
  ipcMain.handle("browser:menu-close", (event, input) => {
    const value = record(input);
    const request = tabTarget(value);
    manager.closeMenu(senderId(event), {
      ...request,
      token: text(value, "token", 256),
    } satisfies BrowserMenuCloseRequest);
  });
  ipcMain.handle("browser:menu-overlay-ready", (event) =>
    manager.menuOverlayReady(senderId(event)),
  );
  ipcMain.handle("browser:menu-overlay-action", (event, input) => {
    const value = record(input);
    manager.menuOverlayAction(senderId(event), text(value, "token", 256), menuAction(value.action));
  });
  ipcMain.handle("browser:set-bounds", (event, input) => {
    const value = record(input);
    manager.setBounds(senderId(event), target(value), bounds(value.bounds));
  });
  ipcMain.handle("browser:set-visible", (event, input) => {
    const value = record(input);
    manager.setVisible(senderId(event), target(value), value.visible === true);
  });
  ipcMain.handle("browser:pop-out", (event, input) =>
    manager.popOut(senderId(event), target(input)),
  );
  ipcMain.handle("browser:dock", (event, input) => manager.dock(senderId(event), target(input)));
  ipcMain.handle("browser:open-external", async (event, input) => {
    const request = tabTarget(input);
    await manager.openExternal(senderId(event), request, request.tabId);
  });
  ipcMain.handle("browser:find", (event, input) => {
    const value = record(input);
    const request = tabTarget(value);
    manager.find(
      senderId(event),
      request,
      request.tabId,
      typeof value.text === "string" ? value.text : "",
      value.forward !== false,
    );
  });
  ipcMain.handle("browser:stop-find", (event, input) => {
    const request = tabTarget(input);
    manager.stopFind(senderId(event), request, request.tabId);
  });
  ipcMain.handle("browser:continue-certificate", (event, input) => {
    const request = tabTarget(input);
    return manager.continueCertificate(senderId(event), request, request.tabId);
  });
  ipcMain.handle("browser:clear-data", async (event, input) => {
    const value = record(input) as BrowserClearDataRequest & Record<string, unknown>;
    if (value.scope !== "project" && value.scope !== "all") {
      throw new Error("Invalid browser data scope.");
    }
    return manager.clearData(senderId(event), target(value), value.scope);
  });
  ipcMain.handle("browser:set-search-engine", (event, input) => {
    const value = record(input);
    return manager.setSearchEngine(
      senderId(event),
      target(value),
      text(value, "searchEngine", 32) as BrowserSearchEngine,
    );
  });
}
