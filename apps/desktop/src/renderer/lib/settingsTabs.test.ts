import { describe, expect, it } from "bun:test";
import { buildSettingsPath, resolveSettingsTabId, SETTINGS_TABS } from "./settingsTabs";

describe("settings tabs", () => {
  it("falls back to the general tab for missing or unknown values", () => {
    expect(resolveSettingsTabId(null)).toBe("general");
    expect(resolveSettingsTabId("missing")).toBe("general");
  });

  it("resolves retained legacy tabs into general", () => {
    expect(resolveSettingsTabId("personalization")).toBe("general");
    expect(resolveSettingsTabId("about")).toBe("general");
  });

  it("builds the settings path for a tab", () => {
    expect(buildSettingsPath("interface")).toBe("/settings?tab=interface");
    expect(buildSettingsPath("keybindings")).toBe("/settings?tab=keybindings");
    expect(buildSettingsPath("general")).toBe("/settings?tab=general");
  });

  it("orders keybindings next to interface settings", () => {
    expect(SETTINGS_TABS.map((tab) => tab.id)).toEqual([
      "general",
      "interface",
      "keybindings",
      "providers",
      "worktrees",
      "archives",
    ]);
    expect(resolveSettingsTabId("keybindings")).toBe("keybindings");
  });
});
