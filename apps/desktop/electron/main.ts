import { app, BrowserWindow, ipcMain, shell, dialog, clipboard } from "electron";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { ensureCliPaths } from "./runtime/processPath";
import { registerRuntimeIpc } from "./runtime/runtimeIpc";
import { registerChatIpc } from "./chat/chatIpc";
import { createChatSessionManager, type ChatSessionManager } from "./chat/chatSessionManager";
import {
  createThreadDeletionJournalStore,
  createThreadDeletionTransactionManager,
  recoverThreadDeletionTransaction,
} from "./chat/threadDeletionTransaction";
import { createPersistentProviderSessionStore } from "./chat/providerSessionStore";
import { createWorkspaceStore } from "./workspace/workspaceStore";
import {
  getLastWorkspaceSnapshot,
  registerWorkspaceIpc,
  rememberWorkspaceSnapshot,
  setWorkspaceTransactionActive,
} from "./workspace/workspaceIpc";
import { createWorkspaceShutdown } from "./workspace/workspaceShutdown";
import {
  createProjectRelocationManager,
  isProjectDirectoryAvailable,
  registerProjectDirectoryIpc,
} from "./workspace/projectDirectory";
import type { WorkspaceStore } from "./workspace/workspaceStore";
import { createAttachmentStore } from "./attachments/attachmentStore";
import { registerAttachmentIpc } from "./attachments/attachmentIpc";
import { registerSkillIpc } from "./skills/skillIpc";
import { registerGitIpc } from "./git/gitIpc";
import {
  createCarrentBridgeManager,
  createMcpServerPreferenceStore,
} from "./bridge/carrentBridgeManager";
import { registerMcpServerIpc } from "./bridge/mcpServerIpc";
import { registerSettingsIpc } from "./settings/settingsIpc";
import { registerDialogIpc } from "./dialog/dialogIpc";
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

let workspaceStore: WorkspaceStore | null = null;
let chatSessionManager: ChatSessionManager | null = null;
let waitForThreadDeletion: (() => Promise<void>) | null = null;

app.whenReady().then(async () => {
  ensureCliPaths();

  const icon = resolveIconPath();

  if (process.platform === "darwin" && icon && !app.isPackaged) {
    app.dock?.setIcon(icon);
  }

  registerRuntimeIpc(ipcMain);

  const userDataPath = app.getPath("userData");
  const store = createWorkspaceStore(userDataPath);
  workspaceStore = store;
  registerWorkspaceIpc(ipcMain, store);

  const attachmentStore = createAttachmentStore(userDataPath);
  if (
    !attachmentStore.prepareDeletion ||
    !attachmentStore.commitDeletion ||
    !attachmentStore.rollbackDeletion
  ) {
    throw new Error("Transactional attachment cleanup is unavailable.");
  }
  const transactionAttachmentStore = {
    prepareDeletion: attachmentStore.prepareDeletion,
    commitDeletion: attachmentStore.commitDeletion,
    rollbackDeletion: attachmentStore.rollbackDeletion,
  };
  const threadDeletionJournalStore = createThreadDeletionJournalStore(userDataPath);
  await recoverThreadDeletionTransaction({
    journalStore: threadDeletionJournalStore,
    workspaceStore: store,
    attachmentStore: transactionAttachmentStore,
  });
  registerAttachmentIpc(ipcMain, { attachmentStore });
  registerSkillIpc(ipcMain);
  registerGitIpc(ipcMain);
  registerSettingsIpc(ipcMain);

  const bridgeManager = createCarrentBridgeManager({
    preferenceStore: createMcpServerPreferenceStore(app.getPath("userData")),
  });
  registerMcpServerIpc(ipcMain, bridgeManager);
  await bridgeManager.initialize();

  registerDialogIpc(ipcMain, () => dialog.showOpenDialog({ properties: ["openDirectory"] }));

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

  const providerSessionsSnapshot = await store.loadProviderSessions();

  const sessionManager = createChatSessionManager({
    emit: emitChatEvent as (event: { type: string }) => void,
    spawn,
    providerSessions: createPersistentProviderSessionStore(store, providerSessionsSnapshot),
    attachmentStore,
    carrentBridgeFactory: async () => {
      return bridgeManager.getRuntimeHandle();
    },
  });
  if (!sessionManager.rollbackThreadDataDeletion) {
    throw new Error("Thread data rollback is unavailable.");
  }
  if (
    !sessionManager.hasLiveRunForThreads ||
    !sessionManager.detachRuntimeSessions ||
    !sessionManager.restoreRuntimeSessions ||
    !sessionManager.completeRuntimeSessionDetachment
  ) {
    throw new Error("Project relocation Session cleanup is unavailable.");
  }
  const projectRelocationManager = createProjectRelocationManager({
    workspaceStore: store,
    sessionManager: {
      hasLiveRunForThreads: sessionManager.hasLiveRunForThreads,
      detachRuntimeSessions: sessionManager.detachRuntimeSessions,
      restoreRuntimeSessions: sessionManager.restoreRuntimeSessions,
      completeRuntimeSessionDetachment: sessionManager.completeRuntimeSessionDetachment,
    },
    onActiveChange: setWorkspaceTransactionActive,
  });
  registerProjectDirectoryIpc(ipcMain, { relocationManager: projectRelocationManager });
  chatSessionManager = sessionManager;
  const threadDeletionManager = createThreadDeletionTransactionManager({
    journalStore: threadDeletionJournalStore,
    workspaceStore: store,
    attachmentStore: transactionAttachmentStore,
    sessionManager: {
      deleteThreadData: sessionManager.deleteThreadData,
      rollbackThreadDataDeletion: sessionManager.rollbackThreadDataDeletion,
    },
    onCommitted: rememberWorkspaceSnapshot,
    onActiveChange: setWorkspaceTransactionActive,
  });
  waitForThreadDeletion = threadDeletionManager.waitForIdle;
  registerChatIpc(ipcMain, {
    sessionManager,
    isProjectDirectoryAvailable,
    threadDeletionManager,
  });
  createWindow(icon);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(icon);
    }
  });
});

const workspaceShutdown = createWorkspaceShutdown({
  getLastWorkspaceSnapshot,
  getWorkspaceStore: () => workspaceStore,
  quit: () => app.quit(),
  reportSaveError: (error) => console.error("[workspace] failed to save before quit", error),
  beforeSave: async () => {
    await waitForThreadDeletion?.();
  },
});

app.on("before-quit", (event) => {
  // End live runs first so pending question MCP calls flush before quit.
  chatSessionManager?.shutdown();
  void workspaceShutdown.beforeQuit(event);
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
