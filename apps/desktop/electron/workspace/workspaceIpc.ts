import {
  normalizeWorkspaceSnapshot,
  type ProviderSessionSnapshot,
  type WorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";
import type { WorkspaceStore } from "./workspaceStore";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
}

let lastWorkspaceSnapshot: WorkspaceSnapshot | null = null;

export function getLastWorkspaceSnapshot(): WorkspaceSnapshot | null {
  return lastWorkspaceSnapshot;
}

export function registerWorkspaceIpc(ipcMainLike: IpcMainLike, store: WorkspaceStore) {
  ipcMainLike.handle("workspace:load", () => store.loadWorkspaceSnapshot());
  ipcMainLike.on("workspace:remember", (_event, snapshot) => {
    const normalized = normalizeWorkspaceSnapshot(snapshot);
    if (normalized) {
      lastWorkspaceSnapshot = normalized;
    }
  });
  ipcMainLike.handle("workspace:save", (_event, snapshot) => {
    const normalized = normalizeWorkspaceSnapshot(snapshot);
    if (!normalized) {
      throw new Error("Invalid workspace snapshot.");
    }
    lastWorkspaceSnapshot = normalized;
    return store.saveWorkspaceSnapshot(normalized);
  });
  ipcMainLike.handle("provider-sessions:load", () => store.loadProviderSessions());
  ipcMainLike.handle("provider-sessions:save", (_event, snapshot) =>
    store.saveProviderSessions(snapshot as ProviderSessionSnapshot),
  );
}
