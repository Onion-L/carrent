import type { RuntimeId, RuntimeModelListResult } from "../../shared/runtimes";

export const RUNTIME_MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type RuntimeModelsCacheState = {
  resultById: Partial<Record<RuntimeId, RuntimeModelListResult>>;
  loadingById: Partial<Record<RuntimeId, boolean>>;
  errorById: Partial<Record<RuntimeId, string>>;
  lastFetchedAtById: Partial<Record<RuntimeId, number>>;
};

export type RuntimeModelsStore = {
  getState: () => RuntimeModelsCacheState;
  subscribe: (listener: () => void) => () => void;
  ensureFresh: (runtimeId: RuntimeId) => Promise<void>;
  refresh: (runtimeId: RuntimeId) => Promise<void>;
};

type RuntimeModelsStoreDeps = {
  listModels: (runtimeId: RuntimeId) => Promise<RuntimeModelListResult>;
  now?: () => number;
  ttlMs?: number;
};

export function createRuntimeModelsStore({
  listModels,
  now = () => Date.now(),
  ttlMs = RUNTIME_MODELS_CACHE_TTL_MS,
}: RuntimeModelsStoreDeps): RuntimeModelsStore {
  let state: RuntimeModelsCacheState = {
    resultById: {},
    loadingById: {},
    errorById: {},
    lastFetchedAtById: {},
  };
  const listeners = new Set<() => void>();
  const inFlightById = new Map<RuntimeId, Promise<void>>();

  const notify = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  const setState = (updater: (current: RuntimeModelsCacheState) => RuntimeModelsCacheState) => {
    state = updater(state);
    notify();
  };

  const fetchModels = (runtimeId: RuntimeId): Promise<void> => {
    const existingRequest = inFlightById.get(runtimeId);
    if (existingRequest) {
      return existingRequest;
    }

    setState((current) => ({
      ...current,
      loadingById: {
        ...current.loadingById,
        [runtimeId]: true,
      },
      errorById: {
        ...current.errorById,
        [runtimeId]: undefined,
      },
    }));

    const request = listModels(runtimeId)
      .then((result) => {
        const fetchedAt = now();
        setState((current) => ({
          ...current,
          resultById: {
            ...current.resultById,
            [runtimeId]:
              result.state === "failed" && current.resultById[runtimeId]
                ? current.resultById[runtimeId]
                : result,
          },
          loadingById: {
            ...current.loadingById,
            [runtimeId]: false,
          },
          errorById: {
            ...current.errorById,
            [runtimeId]:
              result.state === "failed"
                ? (result.lastError ?? "Failed to list runtime models.")
                : undefined,
          },
          lastFetchedAtById: {
            ...current.lastFetchedAtById,
            ...(result.state === "failed" && current.resultById[runtimeId]
              ? {}
              : { [runtimeId]: fetchedAt }),
          },
        }));
      })
      .catch((error: unknown) => {
        setState((current) => ({
          ...current,
          loadingById: {
            ...current.loadingById,
            [runtimeId]: false,
          },
          errorById: {
            ...current.errorById,
            [runtimeId]: getErrorMessage(error, "Failed to list runtime models."),
          },
        }));
      })
      .finally(() => {
        inFlightById.delete(runtimeId);
      });

    inFlightById.set(runtimeId, request);
    return request;
  };

  const ensureFresh = (runtimeId: RuntimeId) => {
    const cachedResult = state.resultById[runtimeId];
    const lastFetchedAt = state.lastFetchedAtById[runtimeId];
    const isFresh = cachedResult != null && lastFetchedAt != null && now() - lastFetchedAt < ttlMs;

    if (isFresh) {
      return Promise.resolve();
    }

    return fetchModels(runtimeId);
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ensureFresh,
    refresh: fetchModels,
  };
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return fallback;
}
