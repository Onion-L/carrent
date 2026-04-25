import { contextBridge, ipcRenderer } from "electron";
import type { ChatTurnRequest, ChatRunEvent } from "../src/shared/chat";

const carrent = {
  platform: process.platform,
  electronVersion: process.versions.electron,
  runtimes: {
    list: () => ipcRenderer.invoke("runtimes:list"),
    localCheck: (id: "codex" | "claude-code") => ipcRenderer.invoke("runtimes:local-check", id),
    modelPing: (id: "codex" | "claude-code") => ipcRenderer.invoke("runtimes:model-ping", id),
    start: (id: "codex" | "claude-code") => ipcRenderer.invoke("runtimes:start", id),
    stop: (id: "codex" | "claude-code") => ipcRenderer.invoke("runtimes:stop", id),
    restart: (id: "codex" | "claude-code") => ipcRenderer.invoke("runtimes:restart", id),
    refreshVersion: (id: "codex" | "claude-code") => ipcRenderer.invoke("runtimes:refresh-version", id),
    startAll: () => ipcRenderer.invoke("runtimes:start-all"),
    stopAll: () => ipcRenderer.invoke("runtimes:stop-all"),
    restartAll: () => ipcRenderer.invoke("runtimes:restart-all"),
  },
  chat: {
    send: (request: ChatTurnRequest) =>
      ipcRenderer.invoke("chat:send", request) as Promise<{ runId: string }>,
    stop: (runId: string) =>
      ipcRenderer.invoke("chat:stop", runId) as Promise<void>,
    onEvent: (listener: (event: ChatRunEvent) => void) => {
      const wrapped = (_event: unknown, evt: ChatRunEvent) => listener(evt);
      ipcRenderer.on("chat:event", wrapped);
      return () => ipcRenderer.removeListener("chat:event", wrapped);
    },
  },
  dialog: {
    openDirectory: () =>
      ipcRenderer.invoke("dialog:open-directory") as Promise<{
        canceled: boolean;
        filePaths: string[];
      }>,
  },
};

contextBridge.exposeInMainWorld("carrent", carrent);
