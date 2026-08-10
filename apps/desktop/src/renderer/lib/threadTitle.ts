// Deterministic Thread title foundation.
//
// A promoted Thread receives a bounded local fallback title derived from the
// user's visible composer text. The derivation is deterministic and shared by
// the draft-promotion path and the legacy non-draft backfill: it never invokes
// model generation. Model-generated titles (issue #4) replace this fallback
// only through the authoritative `thread:set-automatic-title` gate.

// A single grapheme segmenter covers every locale-independent grapheme rule
// (emoji, ZWJ sequences, regional indicators, combining marks). It is built
// once and reused; Intl.Segmenter is locale-insensitive at grapheme granularity.
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// Splits a value into its grapheme-cluster segments. The three grapheme-aware
// operations below (count, truncate, bound) all derive from this one walk.
function segmentGraphemes(value: string): string[] {
  return [...graphemeSegmenter.segment(value)].map((entry) => entry.segment);
}

// The automatic-title fallback length ceiling. An overlong value is represented
// as the first `MAX_THREAD_TITLE_GRAPHEMES - 1` graphemes followed by `…`.
export const MAX_THREAD_TITLE_GRAPHEMES = 48;

export const DEFAULT_THREAD_TITLE = "New thread";

type DeriveThreadTitleOptions = {
  // Title returned when neither the visible text nor the attachment name
  // yields a usable line. Defaults to "New thread".
  fallback?: string;
  // Basename of the first attachment, used only when the visible text yields
  // nothing. Attachment content is never part of the title source.
  attachmentName?: string;
};

// Picks the first non-empty trimmed line and collapses runs of intra-line
// whitespace to a single space. Returns "" when no usable line exists.
function firstUsableLine(value: string): string {
  for (const rawLine of value.split("\n")) {
    const folded = rawLine.trim().replace(/\s+/gu, " ");
    if (folded) return folded;
  }
  return "";
}

// Derives a deterministic, bounded Thread title from the user's visible
// composer text. The policy:
//
//   1. Split the visible text into lines, trim each, take the first non-empty
//      line, and collapse consecutive intra-line whitespace to one space.
//   2. If no usable line exists, apply the same policy to the attachment
//      basename. If neither yields a line, return the fallback (default
//      "New thread").
//   3. Truncate the result to 48 grapheme clusters. An overlong value is
//      represented as the first 47 graphemes followed by `…`.
//
// The source is the user-visible composer text, never the runtime prompt
// enriched with Skill references, and never attachment contents.
export function deriveThreadTitle(
  visibleText: string,
  options: DeriveThreadTitleOptions = {},
): string {
  const { fallback = DEFAULT_THREAD_TITLE, attachmentName } = options;

  const usable = firstUsableLine(visibleText) || firstUsableLine(attachmentName ?? "");
  if (!usable) return fallback;

  const graphemes = segmentGraphemes(usable);
  if (graphemes.length <= MAX_THREAD_TITLE_GRAPHEMES) return usable;
  return `${graphemes.slice(0, MAX_THREAD_TITLE_GRAPHEMES - 1).join("")}…`;
}

// Bounds the visible composer text to the first `maxGraphemes` grapheme
// clusters. Used to cap the title source data carried alongside the Run (for
// later model use) without altering the full user message sent to the Run.
export function boundThreadTitleSource(
  visibleText: string,
  options: { maxGraphemes?: number } = {},
): string {
  const { maxGraphemes = 8000 } = options;
  if (maxGraphemes <= 0) return "";
  const graphemes = segmentGraphemes(visibleText);
  if (graphemes.length <= maxGraphemes) return visibleText;
  return graphemes.slice(0, maxGraphemes).join("");
}
