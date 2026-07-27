import {
  normalizeAppStateSnapshotForWrite,
  normalizeWorkspaceSnapshot,
  type AppStateLoadResult,
  type ProviderSessionSnapshot,
  type WorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";
import type { WorkspaceStore } from "./workspaceStore";

export type AppStateIpcResultSource = "reread" | "full-reset";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
  on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
}

let lastWorkspaceSnapshot: WorkspaceSnapshot | null = null;
let workspaceTransactionActive = false;

export function getLastWorkspaceSnapshot(): WorkspaceSnapshot | null {
  return lastWorkspaceSnapshot;
}

export function rememberWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  lastWorkspaceSnapshot = snapshot;
}

export function setWorkspaceTransactionActive(active: boolean) {
  workspaceTransactionActive = active;
}

export function registerWorkspaceIpc(
  ipcMainLike: IpcMainLike,
  store: WorkspaceStore,
  initialAppStateResult: AppStateLoadResult,
  prepareAppStateResult: (
    result: AppStateLoadResult,
    source: AppStateIpcResultSource,
  ) => Promise<AppStateLoadResult> | AppStateLoadResult,
) {
  let appStateResult = initialAppStateResult;
  const consumeAppStateResult = () => {
    const result = appStateResult;
    if (result.status === "ready" && result.notice) {
      appStateResult = { status: "ready", snapshot: result.snapshot };
    }
    return result;
  };
  ipcMainLike.handle("app-state:load", () => consumeAppStateResult());
  ipcMainLike.handle("app-state:reread", async () => {
    const result = await store.initializeAppState();
    appStateResult = await prepareAppStateResult(result, "reread");
    return consumeAppStateResult();
  });
  ipcMainLike.handle("app-state:full-reset", async () => {
    const result = await store.fullResetAppState();
    appStateResult = await prepareAppStateResult(result, "full-reset");
    return consumeAppStateResult();
  });
  ipcMainLike.handle("app-state:save", (_event, snapshot) => {
    if (workspaceTransactionActive) throw new Error("Workspace transaction is in progress.");
    const normalized = normalizeAppStateSnapshotForWrite(snapshot);
    if (!normalized) {
      throw new Error("Invalid App State snapshot.");
    }
    return store.saveAppStateSnapshot(normalized);
  });
  ipcMainLike.handle("workspace:load", () => store.loadWorkspaceSnapshot());
  ipcMainLike.on("workspace:remember", (_event, snapshot) => {
    if (workspaceTransactionActive) return;
    const normalized = normalizeWorkspaceSnapshot(snapshot);
    if (normalized) {
      rememberWorkspaceSnapshot(normalized);
    }
  });
  ipcMainLike.handle("workspace:save", async (_event, snapshot) => {
    if (workspaceTransactionActive) throw new Error("Workspace transaction is in progress.");
    const normalized = normalizeWorkspaceSnapshot(snapshot);
    if (!normalized) {
      throw new Error("Invalid workspace snapshot.");
    }
    await store.saveWorkspaceSnapshot(normalized);
    rememberWorkspaceSnapshot(normalized);
  });
  ipcMainLike.handle("provider-sessions:load", () => store.loadProviderSessions());
  ipcMainLike.handle("provider-sessions:save", (_event, snapshot) =>
    store.saveProviderSessions(snapshot as ProviderSessionSnapshot),
  );
}
