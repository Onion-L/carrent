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
  let recoveryQueue: Promise<unknown> = Promise.resolve();
  const consumeAppStateResult = () => {
    const result = appStateResult;
    if (result.status === "ready" && result.notice) {
      appStateResult = { status: "ready", snapshot: result.snapshot };
    }
    return result;
  };
  const runRecoveryOperation = async (
    source: AppStateIpcResultSource,
    operation: () => Promise<AppStateLoadResult>,
  ) => {
    onRecoveryTransactionActive(true);
    const result = recoveryQueue
      .catch(() => {})
      .then(async () => {
        try {
          appStateResult = await prepareAppStateResult(await operation(), source);
          return consumeAppStateResult();
        } finally {
          onRecoveryTransactionActive(false);
        }
      });
    recoveryQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  };
  ipcMainLike.handle("app-state:load", () => consumeAppStateResult());
  ipcMainLike.handle("app-state:reread", () =>
    runRecoveryOperation("reread", store.initializeAppState),
  );
  ipcMainLike.handle("app-state:full-reset", () =>
    runRecoveryOperation("full-reset", store.fullResetAppState),
  );
  ipcMainLike.handle("provider-sessions:load", () => store.loadProviderSessions());
  ipcMainLike.handle("provider-sessions:save", (_event, snapshot) =>
    store.saveProviderSessions(snapshot as ProviderSessionSnapshot),
  );
}
