import { describe, expect, it } from "bun:test";

import { runtimeCatalog } from "./runtimeCatalog";

describe("runtimeCatalog", () => {
  it("supports only the V1 runtimes", () => {
    const runtimeIds = new Set(runtimeCatalog.map((runtime) => runtime.id));

    expect(runtimeIds).toEqual(new Set(["codex", "claude-code"]));
    expect(runtimeCatalog).toHaveLength(2);
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

  it("defines the confirmed codex model ping", () => {
    const codex = runtimeCatalog.find((runtime) => runtime.id === "codex");

    expect(codex).toBeDefined();
    expect(codex?.supportsModelPing).toBe(true);
    expect(codex?.verification.modelPing).toEqual({
      prompt: "Reply with exactly OK.",
      mayUseTokens: true,
    });
  });

  it("defines the confirmed claude-code model ping", () => {
    const claudeCode = runtimeCatalog.find(
      (runtime) => runtime.id === "claude-code",
    );

    expect(claudeCode).toBeDefined();
    expect(claudeCode?.supportsModelPing).toBe(true);
    expect(claudeCode?.verification.modelPing).toEqual({
      prompt: "Reply with exactly OK.",
      mayUseTokens: true,
    });
  });
});
