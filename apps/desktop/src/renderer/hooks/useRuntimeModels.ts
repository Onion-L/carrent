import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";

import type { RuntimeId } from "../../shared/runtimes";
import { useRuntimeModelsStore } from "../context/RuntimeModelsContext";

export function useRuntimeModels(runtimeId: RuntimeId | null) {
  const store = useRuntimeModelsStore();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const refresh = useCallback((id: RuntimeId) => store.refresh(id), [store]);

  useEffect(() => {
    if (!runtimeId) {
      return;
    }

    void store.ensureFresh(runtimeId);
  }, [runtimeId, store]);

  const result = runtimeId ? (state.resultById[runtimeId] ?? null) : null;
  const loading = runtimeId ? (state.loadingById[runtimeId] ?? false) : false;
  const error = runtimeId ? state.errorById[runtimeId] : undefined;
  const models = useMemo(() => result?.models ?? [], [result]);
  const defaultModelId = useMemo(() => result?.defaultModelId, [result]);

  return {
    result,
    models,
    defaultModelId,
    loading,
    error,
    refresh,
  };
}
