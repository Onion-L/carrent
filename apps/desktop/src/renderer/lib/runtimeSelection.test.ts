import { describe, expect, it } from "bun:test";

import type { RuntimeRecord } from "../../shared/runtimes";
import {
  getChatRuntimeOptions,
  getDetectedRuntimes,
  isChatRuntimeAvailable,
  resolveRuntimeEnabled,
} from "./runtimeSelection";

function makeRuntime(overrides: Partial<RuntimeRecord> = {}): RuntimeRecord {
  return {
    id: "kimi",
    name: "Kimi Code",
    command: "kimi",
    availability: "detected",
    enabled: true,
    status: "stopped",
    configuration: "configured",
    verification: "never",
    supportsModelPing: false,
    ...overrides,
  };
}

describe("runtimeSelection", () => {
  it("defaults detected Kimi to enabled", () => {
    expect(resolveRuntimeEnabled(makeRuntime(), {})).toBe(true);
  });

  it("does not enable unavailable Kimi", () => {
    const runtime = makeRuntime({ availability: "unavailable" });
    expect(resolveRuntimeEnabled(runtime, { kimi: true })).toBe(false);
    expect(getDetectedRuntimes([runtime])).toEqual([]);
    expect(getChatRuntimeOptions([runtime])).toEqual([]);
    expect(isChatRuntimeAvailable("kimi", [runtime])).toBe(false);
  });

  it("respects the persisted enabled state", () => {
    const runtime = makeRuntime();
    expect(resolveRuntimeEnabled(runtime, { kimi: false })).toBe(false);
    expect(getChatRuntimeOptions([{ ...runtime, enabled: false }])).toEqual([]);
  });
});
