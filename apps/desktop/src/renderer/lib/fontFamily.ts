// CSS owns the default font stack. A custom user font is prepended to this
// reference so Geist, Inter, and the OS stack remain as fallbacks.
export const BASE_FONT_SANS_STACK = "var(--font-sans-base)";

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
