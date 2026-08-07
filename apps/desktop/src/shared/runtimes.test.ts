import { describe, expect, it } from "bun:test";

import {
  DEFAULT_RUNTIME_ID,
  normalizePersistedRuntimeId,
  normalizeRuntimeId,
  runtimeIds,
  runtimeNameMap,
} from "./runtimes";

describe("runtimes", () => {
  it("uses Kimi Code as the default runtime", () => {
    expect(DEFAULT_RUNTIME_ID).toBe("kimi");
    expect(runtimeNameMap.kimi).toBe("Kimi Code");
  });

  it("exposes only Kimi while migrating legacy persisted ids", () => {
    expect(runtimeIds).toEqual(["kimi"]);
    expect(normalizePersistedRuntimeId("codex")).toBe("kimi");
    expect(normalizePersistedRuntimeId("claude-code")).toBe("kimi");
    expect(normalizePersistedRuntimeId("pi")).toBe("kimi");
  });

  it("normalizes invalid runtime ids to Kimi Code", () => {
    expect(normalizeRuntimeId("bad")).toBe("kimi");
    expect(normalizeRuntimeId(undefined)).toBe("kimi");
  });
});
