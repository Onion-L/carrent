// Deterministic Thread title foundation, shared by the Main Process and the
// Renderer so one grapheme policy governs every title path.
//
// The Main Process owns fallback calculation: the `thread-draft:promote`
// reducer derives the promoted Thread's title from the visible composer text
// the Renderer supplies as title *source* data. The Renderer imports the same
// policy only to render an optimistic title; it never supplies a finished
// title. Model-generated titles (issue #4) replace this fallback only through
// the authoritative `thread:set-automatic-title` gate.

// A single grapheme segmenter covers every locale-independent grapheme rule
// (emoji, ZWJ sequences, regional indicators, combining marks). It is built
// once and reused; Intl.Segmenter is locale-insensitive at grapheme granularity.
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });

// The ceiling on the title source handed to the model. The deterministic
// fallback still scans the complete visible input so it can find the first
// non-empty line beyond this boundary.
export const MAX_THREAD_TITLE_SOURCE_GRAPHEMES = 8_000;

export const DEFAULT_THREAD_TITLE = "New thread";

export type BoundedGraphemes = {
  // The first `maxGraphemes` grapheme clusters of the input.
  text: string;
  // Grapheme count of `text` (never above `maxGraphemes`).
  count: number;
  // Whether the input continued past `maxGraphemes`.
  truncated: boolean;
};

// Walks at most `maxGraphemes + 1` grapheme clusters and stops. Intl.Segmenter
// iterates lazily, so this stays bounded for arbitrarily long input (a long log
// paste or a large code block) instead of materializing one segment per
// character. Every grapheme-aware operation below is built on this one walk.
export function boundGraphemes(value: string, maxGraphemes: number): BoundedGraphemes {
  if (maxGraphemes <= 0) return { text: "", count: 0, truncated: value.length > 0 };
  // A string shorter than the limit cannot exceed it in graphemes, and a
  // grapheme cluster is never shorter than one code unit.
  if (value.length <= maxGraphemes) {
    let total = 0;
    for (const _segment of graphemeSegmenter.segment(value)) total += 1;
    return { text: value, count: total, truncated: false };
  }

  let count = 0;
  let end = 0;
  for (const { index, segment } of graphemeSegmenter.segment(value)) {
    if (count === maxGraphemes) return { text: value.slice(0, end), count, truncated: true };
    count += 1;
    end = index + segment.length;
  }
  return { text: value, count, truncated: false };
}

type DeriveThreadTitleOptions = {
  // Title returned when neither the visible text nor the attachment name
  // yields a usable line. Defaults to "New thread".
  fallback?: string;
  // Basename of the first attachment, used only when the visible text yields
  // nothing. Attachment content is never part of the title source.
  attachmentName?: string;
};

// Picks the first non-empty trimmed line and collapses runs of intra-line
// whitespace to a single space.
function firstUsableLine(value: string): string {
  let lineHasContent = false;
  let pendingSpace = false;
  let graphemes: string[] = [];

  for (const { segment } of graphemeSegmenter.segment(value)) {
    if (segment.includes("\n")) {
      if (lineHasContent) return graphemes.join("");
      pendingSpace = false;
      graphemes.length = 0;
      continue;
    }
    if (/^\s+$/u.test(segment)) {
      if (lineHasContent) pendingSpace = true;
      continue;
    }

    lineHasContent = true;
    if (pendingSpace) {
      graphemes.push(" ");
      pendingSpace = false;
    }
    graphemes.push(segment);
  }
  return lineHasContent ? graphemes.join("") : "";
}

// Bounds the visible composer text to the first `maxGraphemes` grapheme
// clusters. The Main Process coordinator applies this only when recording the
// source for later model use, after the reducer has derived the fallback from
// the complete visible input.
export function boundThreadTitleSource(
  visibleText: string,
  options: { maxGraphemes?: number } = {},
): string {
  const { maxGraphemes = MAX_THREAD_TITLE_SOURCE_GRAPHEMES } = options;
  return boundGraphemes(visibleText, maxGraphemes).text;
}

// Derives a deterministic, bounded Thread title from the user's visible
// composer text. The policy:
//
//   1. Split the visible text into lines, trim each, take the first non-empty
//      line, and collapse consecutive intra-line whitespace to one space.
//   2. If no usable line exists, apply the same policy to the attachment
//      basename. If neither yields a line, return the fallback (default
//      "New thread").
//   3. Preserve the complete first usable line.
//
// The source is the user-visible composer text, never the agent prompt
// enriched with Skill references, and never attachment contents.
export function deriveThreadTitle(
  visibleText: string,
  options: DeriveThreadTitleOptions = {},
): string {
  const { fallback = DEFAULT_THREAD_TITLE, attachmentName } = options;

  const usable = firstUsableLine(visibleText) || firstUsableLine(attachmentName ?? "");
  if (!usable) return fallback;
  return usable;
}
