import { createEmptyAppStateSnapshot } from "../../src/shared/workspacePersistence";
import type { AppStateStore } from "./appStateStore";

export function createAppStateStoreStub(overrides: Partial<AppStateStore> = {}): AppStateStore {
  return {
    waitForWrites: async () => {},
    initializeAppState: async () => ({
      status: "ready",
      snapshot: createEmptyAppStateSnapshot(),
    }),
    fullResetAppState: async () => ({
      status: "ready",
      snapshot: createEmptyAppStateSnapshot(),
      notice: "full-reset",
    }),
    loadAppStateSnapshot: async () => null,
    saveAppStateSnapshot: async () => {},
    loadProviderSessions: async () => ({ version: 1, sessions: {} }),
    saveProviderSessions: async () => {},
    ...overrides,
  };
}
