import { contextBridge, ipcRenderer } from "electron";

const carrent = {
  platform: process.platform,
  electronVersion: process.versions.electron,
  runtimes: {
    list: () => ipcRenderer.invoke("runtimes:list"),
    localCheck: (id: "codex" | "claude-code") =>
      ipcRenderer.invoke("runtimes:local-check", id),
    modelPing: (id: "codex" | "claude-code") =>
      ipcRenderer.invoke("runtimes:model-ping", id),
  },
};

contextBridge.exposeInMainWorld("carrent", carrent);
