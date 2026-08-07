import { describe, expect, it } from "bun:test";

import type {
  RuntimeId,
  RuntimeModelListResult,
  RuntimeRecord,
  RuntimeVerificationResult,
} from "../../src/shared/runtimes";
import { registerRuntimeIpc } from "./runtimeIpc";

describe("registerRuntimeIpc", () => {
  it("registers the runtime channels and dispatches to the matching service", async () => {
    const handlers = new Map<
      string,
      (
        event: unknown,
        runtimeId?: RuntimeId,
      ) => Promise<
        RuntimeRecord[] | RuntimeRecord | RuntimeVerificationResult | RuntimeModelListResult | void
      > | void
    >();
    const calls: string[] = [];
    const listResult: RuntimeRecord[] = [
      {
        id: "kimi",
        name: "Kimi Code",
        command: "kimi",
        availability: "detected",
        enabled: true,
        status: "stopped",
        configuration: "configured",
        verification: "never",
        supportsModelPing: true,
      },
    ];
    const localCheckResult: RuntimeVerificationResult = {
      verification: "passed",
      lastVerifiedAt: "2026-04-23T00:00:00.000Z",
    };
    const modelPingResult: RuntimeVerificationResult = {
      verification: "unsupported",
    };
    const modelListResult: RuntimeModelListResult = {
      state: "listed",
      models: [
        {
          id: "openai/gpt-5",
          name: "gpt-5",
          provider: "openai",
          source: "cli",
        },
      ],
      lastListedAt: "2026-04-23T00:00:00.000Z",
    };

    registerRuntimeIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      {
        list: async () => {
          calls.push("list");
          return listResult;
        },
        localCheck: async (runtimeId) => {
          calls.push(`local-check:${runtimeId}`);
          return localCheckResult;
        },
        modelPing: async (runtimeId) => {
          calls.push(`model-ping:${runtimeId}`);
          return modelPingResult;
        },
        listModels: async (runtimeId) => {
          calls.push(`list-models:${runtimeId}`);
          return modelListResult;
        },
        start: async (runtimeId) => {
          calls.push(`start:${runtimeId}`);
        },
        stop: async (runtimeId) => {
          calls.push(`stop:${runtimeId}`);
        },
        restart: async (runtimeId) => {
          calls.push(`restart:${runtimeId}`);
        },
        refreshVersion: async (runtimeId) => {
          calls.push(`refresh-version:${runtimeId}`);
          return listResult[0];
        },
        startAll: async () => {
          calls.push("start-all");
        },
        stopAll: async () => {
          calls.push("stop-all");
        },
        restartAll: async () => {
          calls.push("restart-all");
        },
      },
    );

    expect([...handlers.keys()].sort()).toEqual([
      "runtimes:list",
      "runtimes:list-models",
      "runtimes:local-check",
      "runtimes:model-ping",
      "runtimes:refresh-version",
      "runtimes:restart",
      "runtimes:restart-all",
      "runtimes:start",
      "runtimes:start-all",
      "runtimes:stop",
      "runtimes:stop-all",
    ]);

    expect(await handlers.get("runtimes:list")?.({})).toEqual(listResult);
    expect(await handlers.get("runtimes:local-check")?.({}, "kimi")).toEqual(localCheckResult);
    expect(await handlers.get("runtimes:model-ping")?.({}, "kimi")).toEqual(modelPingResult);
    expect(await handlers.get("runtimes:list-models")?.({}, "kimi")).toEqual(modelListResult);
    expect(await handlers.get("runtimes:refresh-version")?.({}, "kimi")).toEqual(listResult[0]);
    await handlers.get("runtimes:start")?.({}, "kimi");
    await handlers.get("runtimes:stop")?.({}, "kimi");
    await handlers.get("runtimes:restart")?.({}, "kimi");
    await handlers.get("runtimes:start-all")?.({});
    await handlers.get("runtimes:stop-all")?.({});
    await handlers.get("runtimes:restart-all")?.({});
    expect(calls).toEqual([
      "list",
      "local-check:kimi",
      "model-ping:kimi",
      "list-models:kimi",
      "refresh-version:kimi",
      "start:kimi",
      "stop:kimi",
      "restart:kimi",
      "start-all",
      "stop-all",
      "restart-all",
    ]);
  });
});
