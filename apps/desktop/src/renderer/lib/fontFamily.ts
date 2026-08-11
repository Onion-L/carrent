// Base UI font stack. Kept in sync with the --font-sans :root default in
// src/styles/index.css. A custom user font (when set) is prepended to this so
// it wins, with Geist, Inter, and the OS stack remaining as fallbacks.
export const BASE_FONT_SANS_STACK =
  '"Geist", "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

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
  if (!customFontFamily) return BASE_FONT_SANS_STACK;
  return `"${escapeFontFamilyName(customFontFamily)}", ${BASE_FONT_SANS_STACK}`;
}
