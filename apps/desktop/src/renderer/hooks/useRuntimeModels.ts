import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RuntimeId, RuntimeModelListResult } from "../../shared/runtimes";

type RuntimeModelsState = {
  resultById: Partial<Record<RuntimeId, RuntimeModelListResult>>;
  loadingById: Partial<Record<RuntimeId, boolean>>;
  errorById: Partial<Record<RuntimeId, string>>;
};

export function useRuntimeModels(runtimeId: RuntimeId | null) {
  const inFlightRef = useRef(new Set<RuntimeId>());
  const [state, setState] = useState<RuntimeModelsState>({
    resultById: {},
    loadingById: {},
    errorById: {},
  });

  const refresh = useCallback(async (id: RuntimeId) => {
    if (inFlightRef.current.has(id)) {
      return;
    }

    inFlightRef.current.add(id);
    setState((current) => ({
      ...current,
      loadingById: {
        ...current.loadingById,
        [id]: true,
      },
      errorById: {
        ...current.errorById,
        [id]: undefined,
      },
    }));

    try {
      const result = await window.carrent.runtimes.listModels(id);
      setState((current) => ({
        ...current,
        resultById: {
          ...current.resultById,
          [id]: result,
        },
        loadingById: {
          ...current.loadingById,
          [id]: false,
        },
        errorById: {
          ...current.errorById,
          [id]:
            result.state === "failed" ? (result.lastError ?? "Failed to list runtime models.") : undefined,
        },
      }));
    } catch (error) {
      setState((current) => ({
        ...current,
        loadingById: {
          ...current.loadingById,
          [id]: false,
        },
        errorById: {
          ...current.errorById,
          [id]: getErrorMessage(error, "Failed to list runtime models."),
        },
      }));
    } finally {
      inFlightRef.current.delete(id);
    }
  }, []);

  useEffect(() => {
    if (!runtimeId) {
      return;
    }

    if (state.resultById[runtimeId] || state.loadingById[runtimeId] || inFlightRef.current.has(runtimeId)) {
      return;
    }

    void refresh(runtimeId);
  }, [refresh, runtimeId, state.loadingById, state.resultById]);

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

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}
