import { describe, expect, it } from "bun:test";

import type { RuntimeRecord, RuntimeVerificationResult } from "../../src/shared/runtimes";
import { registerRuntimeIpc } from "./runtimeIpc";

describe("registerRuntimeIpc", () => {
  it("registers the runtime channels and dispatches to the matching service", async () => {
    const handlers = new Map<
      string,
      (
        event: unknown,
        runtimeId?: "codex" | "claude-code",
      ) => Promise<RuntimeRecord[] | RuntimeRecord | RuntimeVerificationResult | void> | void
    >();
    const calls: string[] = [];
    const listResult: RuntimeRecord[] = [
      {
        id: "codex",
        name: "Codex",
        command: "codex",
        availability: "detected",
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
    expect(await handlers.get("runtimes:local-check")?.({}, "codex")).toEqual(localCheckResult);
    expect(await handlers.get("runtimes:model-ping")?.({}, "claude-code")).toEqual(modelPingResult);
    expect(await handlers.get("runtimes:refresh-version")?.({}, "codex")).toEqual(listResult[0]);
    await handlers.get("runtimes:start")?.({}, "codex");
    await handlers.get("runtimes:stop")?.({}, "claude-code");
    await handlers.get("runtimes:restart")?.({}, "codex");
    await handlers.get("runtimes:start-all")?.({});
    await handlers.get("runtimes:stop-all")?.({});
    await handlers.get("runtimes:restart-all")?.({});
    expect(calls).toEqual([
      "list",
      "local-check:codex",
      "model-ping:claude-code",
      "refresh-version:codex",
      "start:codex",
      "stop:claude-code",
      "restart:codex",
      "start-all",
      "stop-all",
      "restart-all",
    ]);
  });
});
