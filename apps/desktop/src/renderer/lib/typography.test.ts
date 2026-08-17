import { describe, expect, it } from "bun:test";
import {
  DEFAULT_APP_STATE_SETTINGS,
  normalizeAppStateSettings,
} from "../../shared/workspacePersistence";
import { buildFontStack } from "./fontFamily";
import { resolveTypography, resolveTypographySizes } from "./typography";

describe("Typography settings", () => {
  it("defaults Interface and Monospace to 14 px", () => {
    expect(DEFAULT_APP_STATE_SETTINGS.fontSizeInterface).toBe(14);
    expect(DEFAULT_APP_STATE_SETTINGS.fontSizeCode).toBe(14);
  });

  it("maps legacy settings only when new fields are absent", () => {
    expect(
      normalizeAppStateSettings({ theme: "light", fontSize: 18, customFontFamily: "Noto Sans" }),
    ).toMatchObject({
      theme: "light",
      fontSizeInterface: 18,
      fontFamilySans: "Noto Sans",
    });

    expect(
      normalizeAppStateSettings({
        ...DEFAULT_APP_STATE_SETTINGS,
        fontSize: 18,
        customFontFamily: "Legacy",
        fontSizeInterface: 16,
        fontFamilySans: "Current",
      }),
    ).toMatchObject({ fontSizeInterface: 16, fontFamilySans: "Current" });
  });

  it("resolves simple mode to shared Interface and Monospace families", () => {
    const resolved = resolveTypography({
      ...DEFAULT_APP_STATE_SETTINGS,
      fontFamilySans: "Avenir",
      fontFamilyCode: "Fira Code",
      fontFamilyComposer: "Composer",
      fontFamilyTerminal: "Terminal",
      typographyMode: "simple",
    });
    expect(resolved.composer).toContain('"Avenir"');
    expect(resolved.code).toContain('"Fira Code"');
    expect(resolved.terminal).toContain('"Fira Code"');
    expect(resolved.terminal).toContain("Symbols Nerd Font");
  });

  it("resolves simple mode to shared Interface and Monospace sizes", () => {
    expect(
      resolveTypographySizes({
        typographyMode: "simple",
        fontSizeInterface: 17,
        fontSizePrompt: 12,
        fontSizeCode: 15,
        fontSizeTerminal: 9,
      }),
    ).toEqual({ interface: 17, prompt: 17, code: 15, terminal: 15 });
  });

  it("keeps independent sizes in advanced mode", () => {
    expect(
      resolveTypographySizes({
        typographyMode: "advanced",
        fontSizeInterface: 17,
        fontSizePrompt: 12,
        fontSizeCode: 15,
        fontSizeTerminal: 9,
      }),
    ).toEqual({ interface: 17, prompt: 12, code: 15, terminal: 9 });
  });

  it("escapes a selected family while preserving fallback", () => {
    expect(buildFontStack('Te"st\\Fo', "monospace")).toBe('"Te\\"st\\\\Fo", monospace');
  });
});
