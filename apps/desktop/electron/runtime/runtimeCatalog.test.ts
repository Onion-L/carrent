import { describe, expect, it } from "bun:test";

import { runtimeCatalog } from "./runtimeCatalog";

describe("runtimeCatalog", () => {
  it("supports only the V1 runtimes", () => {
    const runtimeIds = new Set(runtimeCatalog.map((runtime) => runtime.id));

    expect(runtimeIds).toEqual(new Set(["kimi"]));
    expect(runtimeCatalog).toHaveLength(1);
  });

  it("defines zero-token local checks for every runtime", () => {
    for (const runtime of runtimeCatalog) {
      expect(runtime.detection.localCheck.mayUseTokens).toBe(false);
    }
  });

  it("defines versionArgs for every runtime", () => {
    for (const runtime of runtimeCatalog) {
      expect(Array.isArray(runtime.versionArgs)).toBe(true);
      expect(runtime.versionArgs.length).toBeGreaterThan(0);
    }
  });

  it("defines explicit model ping support for every runtime", () => {
    for (const runtime of runtimeCatalog) {
      if (runtime.supportsModelPing) {
        expect(runtime.verification.modelPing).toBeDefined();
        expect(runtime.verification.modelPing.mayUseTokens).toBe(true);
      } else {
        expect(runtime.verification.modelPing).toBeUndefined();
      }
    }
  });

  it("defines Kimi Code as an ACP runtime without token-spending model ping", () => {
    const kimi = runtimeCatalog.find((runtime) => runtime.id === "kimi");

    expect(kimi).toBeDefined();
    expect(kimi?.name).toBe("Kimi Code");
    expect(kimi?.command).toBe("kimi");
    expect(kimi?.configMarkers).toContain("~/.kimi-code");
    expect(kimi?.supportsModelPing).toBe(false);
    expect(kimi?.verification.modelPing).toBeUndefined();
  });
});
