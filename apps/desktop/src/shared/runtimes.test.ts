import { describe, expect, it } from "bun:test";

import { DEFAULT_RUNTIME_ID, normalizeRuntimeId, runtimeIds, runtimeNameMap } from "./runtimes";

describe("runtimes", () => {
  it("uses Kimi Code as the default runtime", () => {
    expect(DEFAULT_RUNTIME_ID).toBe("kimi");
    expect(runtimeNameMap.kimi).toBe("Kimi Code");
  });

  it("keeps legacy runtime ids valid for persisted records", () => {
    expect(runtimeIds).toContain("codex");
    expect(runtimeIds).toContain("claude-code");
    expect(runtimeIds).toContain("pi");
    expect(normalizeRuntimeId("codex")).toBe("codex");
    expect(normalizeRuntimeId("claude-code")).toBe("claude-code");
    expect(normalizeRuntimeId("pi")).toBe("pi");
  });

  it("normalizes invalid runtime ids to Kimi Code", () => {
    expect(normalizeRuntimeId("bad")).toBe("kimi");
    expect(normalizeRuntimeId(undefined)).toBe("kimi");
  });
});
