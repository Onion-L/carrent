import {
  normalizeAppStateSnapshotForWrite,
  type AppStateLoadResult,
  type AppStateSnapshot,
  type ProviderSessionSnapshot,
} from "../../src/shared/workspacePersistence";
import type { AppStateStore } from "./appStateStore";

export type AppStateIpcResultSource = "reread" | "full-reset";

interface IpcMainLike {
  handle: (
    channel: string,
    listener: (event: unknown, ...args: unknown[]) => Promise<unknown> | unknown,
  ) => void;
  on?: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void;
}

let appStateTransactionActive = false;
let stagedAppState: { snapshot: AppStateSnapshot; revision: number } | null = null;
let stagedAppStateRevision = 0;

export function getStagedAppStateSnapshot(): AppStateSnapshot | null {
  return stagedAppState?.snapshot ?? null;
}

export function clearStagedAppStateSnapshot() {
  stagedAppState = null;
  stagedAppStateRevision += 1;
}

export function setAppStateTransactionActive(active: boolean) {
  appStateTransactionActive = active;
  if (active) clearStagedAppStateSnapshot();
}

export function registerAppStateIpc(
  ipcMainLike: IpcMainLike,
  store: AppStateStore,
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
  ipcMainLike.on?.("app-state:stage", (_event, snapshot) => {
    if (appStateTransactionActive) return;
    const normalized = normalizeAppStateSnapshotForWrite(snapshot);
    if (!normalized) return;
    stagedAppStateRevision += 1;
    stagedAppState = { snapshot: normalized, revision: stagedAppStateRevision };
  });
  ipcMainLike.handle("app-state:save", (_event, snapshot) => {
    if (appStateTransactionActive) throw new Error("App State transaction is in progress.");
    const normalized = normalizeAppStateSnapshotForWrite(snapshot);
    if (!normalized) {
      throw new Error("Invalid App State snapshot.");
    }
    const stagedRevisionBeforeSave = stagedAppState?.revision;
    return store.saveAppStateSnapshot(normalized).then(() => {
      if (stagedAppState?.revision === stagedRevisionBeforeSave) {
        clearStagedAppStateSnapshot();
      }
    });
  });
  ipcMainLike.handle("provider-sessions:load", () => store.loadProviderSessions());
  ipcMainLike.handle("provider-sessions:save", (_event, snapshot) =>
    store.saveProviderSessions(snapshot as ProviderSessionSnapshot),
  );
}
