import { contextBridge } from "electron";

const carrent = {
  platform: process.platform,
  electronVersion: process.versions.electron,
};

contextBridge.exposeInMainWorld("carrent", carrent);
