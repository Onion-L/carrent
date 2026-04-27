import type {
  WorkspaceSnapshot,
  ProviderSessionSnapshot,
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
    lastWorkspaceSnapshot = snapshot as WorkspaceSnapshot;
  });
  ipcMainLike.handle("workspace:save", (_event, snapshot) => {
    const s = snapshot as WorkspaceSnapshot;
    lastWorkspaceSnapshot = s;
    return store.saveWorkspaceSnapshot(s);
  });
  ipcMainLike.handle("provider-sessions:load", () => store.loadProviderSessions());
  ipcMainLike.handle("provider-sessions:save", (_event, snapshot) =>
    store.saveProviderSessions(snapshot as ProviderSessionSnapshot),
  );
}
