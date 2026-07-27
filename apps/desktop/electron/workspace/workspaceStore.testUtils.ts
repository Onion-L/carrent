import { createEmptyAppStateSnapshot } from "../../src/shared/workspacePersistence";
import type { WorkspaceStore } from "./workspaceStore";

export function createWorkspaceStoreStub(overrides: Partial<WorkspaceStore> = {}): WorkspaceStore {
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
    loadWorkspaceSnapshot: async () => null,
    saveWorkspaceSnapshot: async () => {},
    loadProviderSessions: async () => ({ version: 1, sessions: {} }),
    saveProviderSessions: async () => {},
    ...overrides,
  };
}
