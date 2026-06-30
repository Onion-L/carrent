import { describe, expect, it } from "bun:test";

import type { RuntimeRecord } from "../../shared/runtimes";
import {
  getChatRuntimeOptions,
  getDetectedRuntimes,
  isChatRuntimeAvailable,
  resolveRuntimeEnabled,
} from "./runtimeSelection";

function makeRuntime(overrides: Partial<RuntimeRecord>): RuntimeRecord {
  return {
    id: "codex",
    name: "Codex",
    command: "codex",
    availability: "detected",
    enabled: true,
    status: "stopped",
    configuration: "configured",
    verification: "never",
    supportsModelPing: true,
    ...overrides,
  };
}

describe("runtimeSelection", () => {
  it("defaults detected runtimes to enabled", () => {
    expect(resolveRuntimeEnabled(makeRuntime({ id: "codex" }), {})).toBe(true);
  });

  it("defaults unavailable runtimes to disabled", () => {
    expect(
      resolveRuntimeEnabled(makeRuntime({ id: "codex", availability: "unavailable" }), {}),
    ).toBe(false);
  });

  it("lets persisted settings override detected defaults", () => {
    expect(resolveRuntimeEnabled(makeRuntime({ id: "codex" }), { codex: false })).toBe(false);
  });

  it("does not enable unavailable runtimes from persisted settings", () => {
    expect(
      resolveRuntimeEnabled(makeRuntime({ id: "kimi", availability: "unavailable" }), {
        kimi: true,
      }),
    ).toBe(false);
  });

  it("lists only detected runtimes for the Runtime page", () => {
    const runtimes = [
      makeRuntime({ id: "codex", name: "Codex" }),
      makeRuntime({ id: "pi", name: "pi", availability: "unavailable" }),
    ];

    expect(getDetectedRuntimes(runtimes).map((runtime) => runtime.id)).toEqual(["codex"]);
  });

  it("lists only enabled and detected runtimes for chat", () => {
    const runtimes = [
      makeRuntime({ id: "codex", name: "Codex", enabled: false }),
      makeRuntime({ id: "claude-code", name: "Claude Code", command: "claude" }),
      makeRuntime({ id: "pi", name: "pi", availability: "unavailable", enabled: true }),
    ];

    expect(getChatRuntimeOptions(runtimes).map((runtime) => runtime.id)).toEqual(["claude-code"]);
    expect(isChatRuntimeAvailable("codex", runtimes)).toBe(false);
    expect(isChatRuntimeAvailable("claude-code", runtimes)).toBe(true);
  });
});
