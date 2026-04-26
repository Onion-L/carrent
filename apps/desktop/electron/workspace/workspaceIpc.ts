import type { WorkspaceSnapshot, ProviderSessionSnapshot } from "../../src/shared/workspacePersistence";
import type { WorkspaceStore } from "./workspaceStore";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
}

export function registerWorkspaceIpc(ipcMainLike: IpcMainLike, store: WorkspaceStore) {
  ipcMainLike.handle("workspace:load", () => store.loadWorkspaceSnapshot());
  ipcMainLike.handle("workspace:save", (_event, snapshot) =>
    store.saveWorkspaceSnapshot(snapshot as WorkspaceSnapshot),
  );
  ipcMainLike.handle("provider-sessions:load", () => store.loadProviderSessions());
  ipcMainLike.handle("provider-sessions:save", (_event, snapshot) =>
    store.saveProviderSessions(snapshot as ProviderSessionSnapshot),
  );
}
