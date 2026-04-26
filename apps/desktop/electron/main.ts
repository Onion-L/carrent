import { app, BrowserWindow, ipcMain, shell, dialog, clipboard } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { registerRuntimeIpc } from "./runtime/runtimeIpc";
import { registerChatIpc } from "./chat/chatIpc";
import { createChatSessionManager } from "./chat/chatSessionManager";
import { createWorkspaceStore } from "./workspace/workspaceStore";
import { registerWorkspaceIpc } from "./workspace/workspaceIpc";
import { spawn } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function resolveIconPath() {
  const iconPath = [
    join(app.getAppPath(), "build", "icon.png"),
    join(__dirname, "../../build/icon.png"),
  ].find((candidate) => existsSync(candidate));

  return iconPath;
}

function createWindow(icon: string | undefined) {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 1080,
    minHeight: 720,
    backgroundColor: "#181818",
    autoHideMenuBar: true,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 14 },
    show: false,
    ...(icon && process.platform !== "darwin" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.on("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    return;
  }

  mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
}

app.whenReady().then(async () => {
  const icon = resolveIconPath();

  if (process.platform === "darwin" && icon && !app.isPackaged) {
    app.dock?.setIcon(icon);
  }

  registerRuntimeIpc(ipcMain);

  const workspaceStore = createWorkspaceStore(app.getPath("userData"));
  registerWorkspaceIpc(ipcMain, workspaceStore);

  ipcMain.handle("dialog:open-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result;
  });

  ipcMain.handle("shell:open-path", async (_event, filePath: string) => {
    const result = await shell.openPath(filePath);
    return result;
  });

  ipcMain.handle("clipboard:write-text", async (_event, text: string) => {
    clipboard.writeText(text);
  });

  const emitChatEvent = (event: unknown) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("chat:event", event);
    });
  };

  const providerSessionsSnapshot = await workspaceStore.loadProviderSessions();
  const providerSessionMemory = { ...providerSessionsSnapshot.sessions };

  registerChatIpc(ipcMain, {
    sessionManager: createChatSessionManager({
      emit: emitChatEvent as (event: { type: string }) => void,
      spawn,
      providerSessions: {
        get: (key) => providerSessionMemory[key],
        set: (key, sessionId) => {
          providerSessionMemory[key] = sessionId;
          workspaceStore.saveProviderSessions({ version: 1, sessions: providerSessionMemory });
        },
      },
    }),
  });
  createWindow(icon);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(icon);
    }
  });
});

app.on("before-quit", (event) => {
  if (BrowserWindow.getAllWindows().length > 0) {
    event.preventDefault();
    setTimeout(() => {
      app.quit();
    }, 150);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
