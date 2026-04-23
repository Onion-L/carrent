import { describe, expect, it } from "bun:test";

import type {
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
        runtimeId?: "codex" | "claude-code",
      ) => Promise<RuntimeRecord[] | RuntimeVerificationResult>
    >();
    const calls: string[] = [];
    const listResult: RuntimeRecord[] = [
      {
        id: "codex",
        name: "Codex",
        command: "codex",
        availability: "detected",
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
      },
    );

    expect([...handlers.keys()].sort()).toEqual([
      "runtimes:list",
      "runtimes:local-check",
      "runtimes:model-ping",
    ]);

    expect(await handlers.get("runtimes:list")?.({})).toEqual(listResult);
    expect(await handlers.get("runtimes:local-check")?.({}, "codex")).toEqual(
      localCheckResult,
    );
    expect(await handlers.get("runtimes:model-ping")?.({}, "claude-code")).toEqual(
      modelPingResult,
    );
    expect(calls).toEqual([
      "list",
      "local-check:codex",
      "model-ping:claude-code",
    ]);
  });
});
