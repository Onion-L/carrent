import type { AppStateLoadResult, AppStateSnapshot } from "../../src/shared/workspacePersistence";

export type AppStateLifecycleSource = "startup" | "reread" | "full-reset";

type AppStateLifecycleDependencies = {
  recoverThreadDeletion: () => Promise<void>;
  reloadAppState: () => Promise<AppStateLoadResult>;
  reconcileAttachments: (snapshot: AppStateSnapshot) => Promise<void>;
  resetThreadState: () => void;
  updateIpcGate: (result: AppStateLoadResult) => void;
};

export function createAppStateLifecycle(dependencies: AppStateLifecycleDependencies) {
  return {
    async apply(result: AppStateLoadResult, source: AppStateLifecycleSource) {
      if (result.status === "recovery-required") {
        dependencies.updateIpcGate(result);
        return result;
      }

      let authoritativeResult = result;
      if (source !== "full-reset") {
        await dependencies.recoverThreadDeletion();
        const reloadedResult = await dependencies.reloadAppState();
        if (reloadedResult.status === "recovery-required") {
          dependencies.updateIpcGate(reloadedResult);
          return reloadedResult;
        }
        authoritativeResult = result.notice
          ? { ...reloadedResult, notice: result.notice }
          : reloadedResult;
        await dependencies.reconcileAttachments(authoritativeResult.snapshot);
      }

      if (source === "reread" || source === "full-reset") {
        dependencies.resetThreadState();
      }

      dependencies.updateIpcGate(authoritativeResult);
      return authoritativeResult;
    },
  };
}
