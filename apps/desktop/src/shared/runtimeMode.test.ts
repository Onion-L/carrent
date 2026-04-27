import { describe, expect, it } from "bun:test";
import {
  DEFAULT_RUNTIME_MODE,
  isRuntimeMode,
  normalizeRuntimeMode,
  getRuntimeModeLabel,
} from "./runtimeMode";

describe("runtimeMode", () => {
  it("defaults to approval-required", () => {
    expect(DEFAULT_RUNTIME_MODE).toBe("approval-required");
  });

  it("validates supported runtime modes", () => {
    expect(isRuntimeMode("approval-required")).toBe(true);
    expect(isRuntimeMode("auto-accept-edits")).toBe(true);
    expect(isRuntimeMode("full-access")).toBe(true);
    expect(isRuntimeMode("bad")).toBe(false);
  });

  it("normalizes invalid values to the safe default", () => {
    expect(normalizeRuntimeMode(undefined)).toBe("approval-required");
    expect(normalizeRuntimeMode("bad")).toBe("approval-required");
  });

  it("provides user-facing labels", () => {
    expect(getRuntimeModeLabel("approval-required")).toContain("Approval");
    expect(getRuntimeModeLabel("full-access")).toContain("Full");
  });
});
