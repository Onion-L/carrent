export const ROOT_FONT_SIZE = 14;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 32;

const pixelFontSizes = [10, 11, 12, 13, 14, 15, 16, 18, 22, 32, 36] as const;
const relativeFontSizes = {
  xs: 0.75,
  sm: 0.875,
  base: 1,
  lg: 1.125,
} as const;
const relativeLineHeights = {
  xs: 1,
  sm: 1.25,
  base: 1.5,
  lg: 1.75,
  5: 1.25,
  6: 1.5,
  7: 1.75,
} as const;

function pixels(value: number): string {
  return `${Math.round(value * 1000) / 1000}px`;
}

export function normalizeFontSize(value: unknown, fallback = ROOT_FONT_SIZE): number {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= MIN_FONT_SIZE &&
    value <= MAX_FONT_SIZE
    ? value
    : fallback;
}

export function parseFontSizeInput(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;

  const fontSize = Number(value);
  return normalizeFontSize(fontSize, Number.NaN) === fontSize ? fontSize : null;
}

export function stepFontSize(value: number, step: -1 | 1): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, normalizeFontSize(value) + step));
}

export function getFontSizeCssVariables(fontSize: number): Record<string, string> {
  const variables: Record<string, string> = {};
  const scale = fontSize / ROOT_FONT_SIZE;

  for (const size of pixelFontSizes) {
    variables[`--font-size-${size}`] = pixels(size * scale);
  }
  for (const [name, size] of Object.entries(relativeFontSizes)) {
    variables[`--font-size-${name}`] = pixels(size * fontSize);
  }
  for (const [name, size] of Object.entries(relativeLineHeights)) {
    variables[`--line-height-${name}`] = pixels(size * fontSize);
  }

  return variables;
}
