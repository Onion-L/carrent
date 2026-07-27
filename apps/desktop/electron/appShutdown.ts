import type { WorkspaceSnapshot } from "../src/shared/workspacePersistence";
import type { WorkspaceStore } from "./workspace/workspaceStore";

type BeforeQuitEvent = {
  preventDefault: () => void;
};

type LiveRunQuitPolicy = {
  hasLiveRuns: () => boolean;
  confirmQuitWithLiveRuns: () => Promise<boolean>;
  cancelLiveRuns: () => Promise<void>;
};

type AppShutdownDependencies = {
  getLastWorkspaceSnapshot: () => WorkspaceSnapshot | null;
  getWorkspaceStore: () => WorkspaceStore | null;
  quit: () => void;
  reportShutdownError?: (error: unknown) => void;
  beforeSave?: () => Promise<void>;
  liveRunQuitPolicy?: LiveRunQuitPolicy;
};

export function createAppShutdown({
  getLastWorkspaceSnapshot,
  getWorkspaceStore,
  quit,
  reportShutdownError,
  beforeSave,
  liveRunQuitPolicy,
}: AppShutdownDependencies) {
  let isQuitting = false;
  let allowQuit = false;

  return {
    isQuitting: () => allowQuit,
    async beforeQuit(event: BeforeQuitEvent): Promise<void> {
      if (allowQuit) return;

      if (isQuitting) {
        event.preventDefault();
        return;
      }

      event.preventDefault();
      isQuitting = true;

      try {
        const activeLiveRunQuitPolicy = liveRunQuitPolicy?.hasLiveRuns() ? liveRunQuitPolicy : null;
        if (activeLiveRunQuitPolicy && !(await activeLiveRunQuitPolicy.confirmQuitWithLiveRuns())) {
          isQuitting = false;
          return;
        }

        await activeLiveRunQuitPolicy?.cancelLiveRuns();
        await beforeSave?.();
        const snapshot = getLastWorkspaceSnapshot();
        const store = getWorkspaceStore();
        if (snapshot && store) {
          await store.saveWorkspaceSnapshot(snapshot);
        }
      } catch (error) {
        isQuitting = false;
        reportShutdownError?.(error);
        return;
      }

      allowQuit = true;
      quit();
    },
  };
}
