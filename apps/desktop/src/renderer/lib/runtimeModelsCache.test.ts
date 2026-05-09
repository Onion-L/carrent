import { describe, expect, it } from "bun:test";

import type { RuntimeId, RuntimeModelListResult } from "../../shared/runtimes";
import { createRuntimeModelsStore, RUNTIME_MODELS_CACHE_TTL_MS } from "./runtimeModelsCache";

function createListedResult(modelId: string): RuntimeModelListResult {
  return {
    state: "listed",
    models: [
      {
        id: modelId,
        name: modelId,
        source: "cli",
      },
    ],
    lastListedAt: "2026-05-10T00:00:00.000Z",
  };
}

describe("createRuntimeModelsStore", () => {
  it("fetches a runtime model list once for concurrent requests", async () => {
    let calls = 0;
    const store = createRuntimeModelsStore({
      listModels: async () => {
        calls += 1;
        return createListedResult("deepseek/deepseek-v4-flash");
      },
      now: () => 1000,
    });

    await Promise.all([store.ensureFresh("pi"), store.ensureFresh("pi")]);

    expect(calls).toBe(1);
    expect(store.getState().resultById.pi?.models[0]?.id).toBe("deepseek/deepseek-v4-flash");
  });

  it("reuses cached results inside the TTL", async () => {
    let calls = 0;
    let now = 1000;
    const store = createRuntimeModelsStore({
      listModels: async () => {
        calls += 1;
        return createListedResult(`model-${calls}`);
      },
      now: () => now,
    });

    await store.ensureFresh("pi");
    now += RUNTIME_MODELS_CACHE_TTL_MS - 1;
    await store.ensureFresh("pi");

    expect(calls).toBe(1);
    expect(store.getState().resultById.pi?.models[0]?.id).toBe("model-1");
  });

  it("returns stale data and refreshes in the background after the TTL", async () => {
    let calls = 0;
    let now = 1000;
    let resolveRefresh: (result: RuntimeModelListResult) => void = () => {};
    const store = createRuntimeModelsStore({
      listModels: () => {
        calls += 1;
        if (calls === 1) {
          return Promise.resolve(createListedResult("model-1"));
        }

        return new Promise<RuntimeModelListResult>((resolve) => {
          resolveRefresh = resolve;
        });
      },
      now: () => now,
    });

    await store.ensureFresh("pi");
    now += RUNTIME_MODELS_CACHE_TTL_MS + 1;

    const staleRefresh = store.ensureFresh("pi");
    expect(store.getState().resultById.pi?.models[0]?.id).toBe("model-1");
    expect(store.getState().loadingById.pi).toBe(true);

    resolveRefresh(createListedResult("model-2"));
    await staleRefresh;

    expect(calls).toBe(2);
    expect(store.getState().resultById.pi?.models[0]?.id).toBe("model-2");
  });

  it("force refresh ignores the TTL", async () => {
    let calls = 0;
    const store = createRuntimeModelsStore({
      listModels: async () => {
        calls += 1;
        return createListedResult(`model-${calls}`);
      },
      now: () => 1000,
    });

    await store.ensureFresh("pi");
    await store.refresh("pi");

    expect(calls).toBe(2);
    expect(store.getState().resultById.pi?.models[0]?.id).toBe("model-2");
  });

  it("keeps stale data when refresh fails", async () => {
    let calls = 0;
    let now = 1000;
    const store = createRuntimeModelsStore({
      listModels: async (_runtimeId: RuntimeId) => {
        calls += 1;
        if (calls === 1) {
          return createListedResult("model-1");
        }

        throw new Error("network down");
      },
      now: () => now,
    });

    await store.ensureFresh("pi");
    now += RUNTIME_MODELS_CACHE_TTL_MS + 1;
    await store.ensureFresh("pi");

    expect(store.getState().resultById.pi?.models[0]?.id).toBe("model-1");
    expect(store.getState().errorById.pi).toBe("network down");
  });

  it("keeps stale data when the runtime returns a failed result", async () => {
    let calls = 0;
    let now = 1000;
    const store = createRuntimeModelsStore({
      listModels: async () => {
        calls += 1;
        if (calls === 1) {
          return createListedResult("model-1");
        }

        return {
          state: "failed",
          models: [],
          lastError: "auth missing",
        };
      },
      now: () => now,
    });

    await store.ensureFresh("pi");
    now += RUNTIME_MODELS_CACHE_TTL_MS + 1;
    await store.ensureFresh("pi");

    expect(store.getState().resultById.pi?.models[0]?.id).toBe("model-1");
    expect(store.getState().errorById.pi).toBe("auth missing");
  });
});
