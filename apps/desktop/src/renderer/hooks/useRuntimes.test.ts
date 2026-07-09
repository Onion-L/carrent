import { describe, expect, it } from "bun:test";

import type { RuntimeRecord } from "../../shared/runtimes";
import { mergeRuntimeDetectionResults } from "./useRuntimes";

function makeRuntime(overrides: Partial<RuntimeRecord>): RuntimeRecord {
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

describe("mergeRuntimeDetectionResults", () => {
  it("clears stale detection errors after a runtime becomes detected", () => {
    const existing = makeRuntime({
      availability: "unavailable",
      enabled: false,
      configuration: "unknown",
      lastError:
        'Runtime command not found: kimi. Install Kimi Code and make "kimi" available in PATH.',
    });
    const fresh = makeRuntime({
      availability: "detected",
      enabled: true,
      configuration: "configured",
      version: "0.23.1",
      lastError: undefined,
    });

    expect(mergeRuntimeDetectionResults([fresh], [existing])[0]).toEqual(fresh);
  });

  it("keeps verification state across detection refreshes", () => {
    const existing = makeRuntime({
      verification: "failed",
      lastVerifiedAt: "2026-07-08T00:00:00.000Z",
      lastError: "Old verification failure",
    });
    const fresh = makeRuntime({
      verification: "never",
      lastVerifiedAt: undefined,
      lastError: undefined,
    });

    expect(mergeRuntimeDetectionResults([fresh], [existing])[0]).toEqual({
      ...fresh,
      verification: "failed",
      lastVerifiedAt: "2026-07-08T00:00:00.000Z",
    });
  });
});
