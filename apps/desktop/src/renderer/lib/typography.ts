import type { AppStateSettings } from "../../shared/workspacePersistence";
import {
  BASE_FONT_CODE_STACK,
  DEFAULT_FONT_SANS_STACK,
  BASE_FONT_TERMINAL_STACK,
  buildFontStack,
} from "./fontFamily";

export const TYPOGRAPHY_SIZE_RANGES = {
  interface: { min: 12, max: 20, defaultValue: 14 },
  prompt: { min: 12, max: 20, defaultValue: 14 },
  code: { min: 10, max: 18, defaultValue: 14 },
  terminal: { min: 8, max: 20, defaultValue: 12 },
} as const;

export type TypographyRegion = keyof typeof TYPOGRAPHY_SIZE_RANGES;

export function resolveTypography(
  settings: Pick<
    AppStateSettings,
    | "typographyMode"
    | "fontFamilySans"
    | "fontFamilyComposer"
    | "fontFamilyCode"
    | "fontFamilyTerminal"
  >,
): {
  sans: string;
  composer: string;
  code: string;
  terminal: string;
} {
  const sans = buildFontStack(settings.fontFamilySans, DEFAULT_FONT_SANS_STACK);
  const code = buildFontStack(settings.fontFamilyCode, BASE_FONT_CODE_STACK);
  return {
    sans,
    composer: buildFontStack(
      settings.typographyMode === "advanced"
        ? settings.fontFamilyComposer
        : settings.fontFamilySans,
      DEFAULT_FONT_SANS_STACK,
    ),
    code,
    terminal: buildFontStack(
      settings.typographyMode === "advanced"
        ? settings.fontFamilyTerminal
        : settings.fontFamilyCode,
      BASE_FONT_TERMINAL_STACK,
    ),
  };
}

export function resolveTypographySizes(
  settings: Pick<
    AppStateSettings,
    | "typographyMode"
    | "fontSizeInterface"
    | "fontSizePrompt"
    | "fontSizeCode"
    | "fontSizeTerminal"
  >,
): {
  interface: number;
  prompt: number;
  code: number;
  terminal: number;
} {
  return {
    interface: settings.fontSizeInterface,
    prompt:
      settings.typographyMode === "advanced"
        ? settings.fontSizePrompt
        : settings.fontSizeInterface,
    code: settings.fontSizeCode,
    terminal:
      settings.typographyMode === "advanced" ? settings.fontSizeTerminal : settings.fontSizeCode,
  };
}

export function clampTypographySize(region: TypographyRegion, value: number): number {
  const range = TYPOGRAPHY_SIZE_RANGES[region];
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

export function isMacPlatform(): boolean {
  return typeof window !== "undefined" && window.carrent?.platform === "darwin";
}
