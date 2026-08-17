export const BASE_FONT_SANS_STACK = "var(--font-sans-base)";
export const DEFAULT_FONT_SANS_STACK =
  '"Geist", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const BASE_FONT_CODE_STACK =
  '"SFMono-Regular", "IBM Plex Mono", Consolas, "Liberation Mono", monospace';
export const BASE_FONT_TERMINAL_STACK =
  '"SFMono-Regular", "IBM Plex Mono", Consolas, "MesloLGS NF", "JetBrainsMono Nerd Font", "Symbols Nerd Font Mono", "Symbols Nerd Font", monospace';

// Escape a single font-family name for safe inclusion inside a double-quoted
// CSS string. Backslash is escaped first so the quote escape's own backslash
// is not double-escaped. Control characters are already stripped by the
// settings normalizer; this only handles the residual structural characters.
export function escapeFontFamilyName(name: string): string {
  return name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

// Build the full --font-sans value for a custom font, prepending the escaped
// name to the base stack. Returns the base stack unchanged when the custom
// name is empty.
export function buildFontSansStack(customFontFamily: string): string {
  return buildFontStack(customFontFamily, BASE_FONT_SANS_STACK);
}

export function buildFontStack(customFontFamily: string, fallbackStack: string): string {
  const family = customFontFamily.trim();
  if (!family) return fallbackStack;
  return `"${escapeFontFamilyName(family)}", ${fallbackStack}`;
}
