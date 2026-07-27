import type {
  AppStateLoadResult,
  ProviderSessionSnapshot,
} from "../../src/shared/workspacePersistence";

type IpcListener = (event: unknown, ...args: unknown[]) => unknown;

const RECOVERY_CHANNELS = new Set([
  "app-state:load",
  "app-state:reread",
  "app-state:full-reset",
  "clipboard:write-text",
]);

export function loadProviderSessionsForAppState(
  store: { loadProviderSessions: () => Promise<ProviderSessionSnapshot> },
  result: AppStateLoadResult,
): Promise<ProviderSessionSnapshot> {
  if (result.status === "recovery-required") {
    return Promise.resolve({ version: 1, sessions: {} });
  }
  return store.loadProviderSessions();
}

export function createAppStateIpcGate<T extends { handle: unknown; on: unknown }>(
  ipcMainLike: T,
  initialResult: AppStateLoadResult,
) {
  let blocked = initialResult.status === "recovery-required";
  const registerHandle = ipcMainLike.handle as (channel: string, listener: IpcListener) => void;
  const registerListener = ipcMainLike.on as (channel: string, listener: IpcListener) => void;

  const assertAvailable = (channel: string) => {
    if (blocked && !RECOVERY_CHANNELS.has(channel)) {
      throw new Error("App State recovery is required.");
    }
  };

  const gatedIpcMain = {
    handle(channel: string, listener: IpcListener) {
      registerHandle(channel, async (event, ...args) => {
        assertAvailable(channel);
        return listener(event, ...args);
      });
    },
    on(channel: string, listener: IpcListener) {
      registerListener(channel, (event, ...args) => {
        if (blocked && !RECOVERY_CHANNELS.has(channel)) {
          return;
        }
        listener(event, ...args);
      });
    },
  } as { handle: T["handle"]; on: T["on"] };

  return {
    ipcMain: gatedIpcMain,
    update(result: AppStateLoadResult) {
      blocked = result.status === "recovery-required";
    },
  };
}
