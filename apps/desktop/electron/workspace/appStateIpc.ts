import type {
  AppStateLoadResult,
  ProviderSessionSnapshot,
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

export function registerAppStateIpc(
  ipcMainLike: IpcMainLike,
  store: AppStateStore,
  initialAppStateResult: AppStateLoadResult,
  prepareAppStateResult: (
    result: AppStateLoadResult,
    source: AppStateIpcResultSource,
  ) => Promise<AppStateLoadResult> | AppStateLoadResult,
  onRecoveryTransactionActive: (active: boolean) => void = () => {},
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
    onRecoveryTransactionActive(true);
    try {
      const result = await store.initializeAppState();
      appStateResult = await prepareAppStateResult(result, "reread");
      return consumeAppStateResult();
    } finally {
      onRecoveryTransactionActive(false);
    }
  });
  ipcMainLike.handle("app-state:full-reset", async () => {
    onRecoveryTransactionActive(true);
    try {
      const result = await store.fullResetAppState();
      appStateResult = await prepareAppStateResult(result, "full-reset");
      return consumeAppStateResult();
    } finally {
      onRecoveryTransactionActive(false);
    }
  });
  ipcMainLike.handle("provider-sessions:load", () => store.loadProviderSessions());
  ipcMainLike.handle("provider-sessions:save", (_event, snapshot) =>
    store.saveProviderSessions(snapshot as ProviderSessionSnapshot),
  );
}
