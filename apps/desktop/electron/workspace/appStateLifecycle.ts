import type { AppStateLoadResult, AppStateSnapshot } from "../../src/shared/workspacePersistence";

export type AppStateLifecycleSource = "startup" | "reread" | "full-reset";

type AppStateLifecycleDependencies = {
  recoverThreadDeletion: () => Promise<void>;
  reloadAppState: () => Promise<AppStateLoadResult>;
  reconcileAttachments: (snapshot: AppStateSnapshot) => Promise<void>;
  reloadProviderSessions: () => Promise<void>;
  clearProviderSessions: () => Promise<void>;
  resetRuntimeSessions: () => void;
  initializeMcpBridge: () => Promise<unknown>;
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

      if (source === "reread") {
        await dependencies.reloadProviderSessions();
        dependencies.resetRuntimeSessions();
      } else if (source === "full-reset") {
        await dependencies.clearProviderSessions();
        dependencies.resetRuntimeSessions();
      }

      await dependencies.initializeMcpBridge();
      dependencies.updateIpcGate(authoritativeResult);
      return authoritativeResult;
    },
  };
}
