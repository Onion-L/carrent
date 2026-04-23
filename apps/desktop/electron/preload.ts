import { contextBridge, ipcRenderer } from "electron";

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
    startAll: () => ipcRenderer.invoke("runtimes:start-all"),
    stopAll: () => ipcRenderer.invoke("runtimes:stop-all"),
    restartAll: () => ipcRenderer.invoke("runtimes:restart-all"),
  },
};

contextBridge.exposeInMainWorld("carrent", carrent);
