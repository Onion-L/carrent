import type { WorkspaceSnapshot } from "../../src/shared/workspacePersistence";
import type { WorkspaceStore } from "./workspaceStore";

type BeforeQuitEvent = {
  preventDefault: () => void;
};

type WorkspaceShutdownDependencies = {
  getLastWorkspaceSnapshot: () => WorkspaceSnapshot | null;
  getWorkspaceStore: () => WorkspaceStore | null;
  quit: () => void;
  reportSaveError?: (error: unknown) => void;
};

export function createWorkspaceShutdown({
  getLastWorkspaceSnapshot,
  getWorkspaceStore,
  quit,
  reportSaveError,
}: WorkspaceShutdownDependencies) {
  let isQuitting = false;

  return {
    async beforeQuit(event: BeforeQuitEvent): Promise<void> {
      if (isQuitting) return;

      event.preventDefault();
      isQuitting = true;

      try {
        const snapshot = getLastWorkspaceSnapshot();
        const store = getWorkspaceStore();
        if (snapshot && store) {
          await store.saveWorkspaceSnapshot(snapshot);
        }
      } catch (error) {
        reportSaveError?.(error);
      } finally {
        quit();
      }
    },
  };
}
