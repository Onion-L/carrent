export type LocalFontData = {
  family: string;
  fullName?: string;
  postscriptName?: string;
  style?: string;
};

export type MonospaceResult = "monospace" | "proportional" | "unknown";

type LocalFontWindow = Window & {
  queryLocalFonts?: () => Promise<LocalFontData[]>;
};

export async function queryInstalledFontFamilies(): Promise<string[]> {
  const query = (window as LocalFontWindow).queryLocalFonts;
  if (typeof query !== "function") throw new Error("Local font enumeration is unavailable.");
  const fonts = await query();
  return [
    ...new Set(
      fonts.map((font) => font.family.trim()).filter((family) => family && !family.startsWith(".")),
    ),
  ].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export async function loadFontFamily(family: string, size = 16): Promise<boolean> {
  if (!family || typeof document === "undefined" || !document.fonts) return false;
  try {
    const loaded = await document.fonts.load(`normal 400 ${size}px "${family}"`);
    return loaded.length > 0;
  } catch {
    return false;
  }
}

export function detectMonospaceFamily(family: string): MonospaceResult {
  if (!family || typeof document === "undefined") return "unknown";
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return "unknown";
    context.font = `32px "${family}"`;
    const widths = ["i", "M", "W", "0", "@", "#"].map(
      (character) => context.measureText(character).width,
    );
    if (widths.some((width) => !Number.isFinite(width) || width <= 0)) return "unknown";
    const baseline = widths[0];
    const tolerance = Math.max(0.5, baseline * 0.01);
    return widths.every((width) => Math.abs(width - baseline) <= tolerance)
      ? "monospace"
      : "proportional";
  } catch {
    return "unknown";
  }
}

export async function checkMonospaceFamily(family: string): Promise<MonospaceResult> {
  if (!(await loadFontFamily(family, 13))) return "unknown";
  return detectMonospaceFamily(family);
}

let symbolsFontPromise: Promise<void> | null = null;

/** Loads the optional bundled symbols-only face when a resource is provided. */
export function loadSymbolsFont(url?: string): Promise<void> {
  if (!url || typeof FontFace === "undefined") return Promise.resolve();
  if (symbolsFontPromise) return symbolsFontPromise;
  symbolsFontPromise = new FontFace("Symbols Nerd Font Mono", `url(${url})`)
    .load()
    .then((face) => {
      document.fonts.add(face);
    })
    .catch(() => undefined);
  return symbolsFontPromise;
}
