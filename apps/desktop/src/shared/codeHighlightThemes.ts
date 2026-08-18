export type CodeHighlightThemeId =
  | "classic"
  | "github"
  | "one-dark-pro"
  | "catppuccin"
  | "vitesse"
  | "solarized"
  | "dracula"
  | "nord"
  | "tokyo-night"
  | "night-owl"
  | "monokai"
  | "poimandres";

export type CodeHighlightThemeOption = {
  id: CodeHighlightThemeId;
  label: string;
  // Shiki theme names resolved against the renderer's highlighter
  // (src/renderer/lib/codeHighlight). Every option is a light/dark pair that
  // follows the app theme; fixed single themes repeat their name so the code
  // block keeps the theme's own background in both modes.
  light: string;
  dark: string;
};

export const CODE_HIGHLIGHT_THEME_OPTIONS: CodeHighlightThemeOption[] = [
  { id: "classic", label: "Classic", light: "carrent-classic-light", dark: "carrent-classic-dark" },
  { id: "github", label: "GitHub", light: "github-light", dark: "github-dark" },
  { id: "one-dark-pro", label: "One Dark Pro", light: "one-light", dark: "one-dark-pro" },
  { id: "catppuccin", label: "Catppuccin", light: "catppuccin-latte", dark: "catppuccin-mocha" },
  { id: "vitesse", label: "Vitesse", light: "vitesse-light", dark: "vitesse-dark" },
  { id: "solarized", label: "Solarized", light: "solarized-light", dark: "solarized-dark" },
  { id: "dracula", label: "Dracula", light: "dracula", dark: "dracula" },
  { id: "nord", label: "Nord", light: "nord", dark: "nord" },
  { id: "tokyo-night", label: "Tokyo Night", light: "tokyo-night", dark: "tokyo-night" },
  { id: "night-owl", label: "Night Owl", light: "night-owl", dark: "night-owl" },
  { id: "monokai", label: "Monokai", light: "monokai", dark: "monokai" },
  { id: "poimandres", label: "Poimandres", light: "poimandres", dark: "poimandres" },
];

export const DEFAULT_CODE_HIGHLIGHT_THEME: CodeHighlightThemeId = "classic";

const THEME_IDS = new Set<string>(CODE_HIGHLIGHT_THEME_OPTIONS.map((option) => option.id));

export function isCodeHighlightThemeId(value: unknown): value is CodeHighlightThemeId {
  return typeof value === "string" && THEME_IDS.has(value);
}
