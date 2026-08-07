import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type {
  BrowserMenuAction,
  BrowserMenuOverlayApi,
  BrowserMenuOverlayState,
} from "../src/shared/browser";

const browserMenuOverlay: BrowserMenuOverlayApi = {
  ready: () => ipcRenderer.invoke("browser:menu-overlay-ready") as Promise<void>,
  action: (request: { token: string; action: BrowserMenuAction }) =>
    ipcRenderer.invoke("browser:menu-overlay-action", request) as Promise<void>,
  onState: (listener: (state: BrowserMenuOverlayState) => void) => {
    const wrapped = (_event: IpcRendererEvent, state: BrowserMenuOverlayState) => listener(state);
    ipcRenderer.on("browser:menu-overlay-state", wrapped);
    return () => ipcRenderer.removeListener("browser:menu-overlay-state", wrapped);
  },
};

contextBridge.exposeInMainWorld("browserMenuOverlay", browserMenuOverlay);
