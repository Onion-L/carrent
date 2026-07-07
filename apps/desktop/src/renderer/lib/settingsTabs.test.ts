import { describe, expect, it } from "bun:test";
import { buildSettingsPath, resolveSettingsTabId } from "./settingsTabs";

describe("settings tabs", () => {
  it("falls back to the runtime tab for missing or unknown values", () => {
    expect(resolveSettingsTabId(null)).toBe("runtime");
    expect(resolveSettingsTabId("missing")).toBe("runtime");
  });

  it("builds the settings path for a tab", () => {
    expect(buildSettingsPath("interface")).toBe("/settings?tab=interface");
  });
});
