import type { WorkspaceStore } from "./workspaceStore";

export function createWorkspaceStoreStub(overrides: Partial<WorkspaceStore> = {}): WorkspaceStore {
  return {
    waitForWrites: async () => {},
    loadAppStateSnapshot: async () => null,
    saveAppStateSnapshot: async () => {},
    loadWorkspaceSnapshot: async () => null,
    saveWorkspaceSnapshot: async () => {},
    loadProviderSessions: async () => ({ version: 1, sessions: {} }),
    saveProviderSessions: async () => {},
    ...overrides,
  };
}
