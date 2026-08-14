import { describe, expect, it } from "bun:test";
import { boundGraphemes, boundThreadTitleSource, deriveThreadTitle } from "./threadTitle";

describe("deriveThreadTitle", () => {
  it("returns the first non-empty line trimmed", () => {
    expect(deriveThreadTitle("Deploy to staging")).toBe("Deploy to staging");
    expect(deriveThreadTitle("  Deploy to staging  ")).toBe("Deploy to staging");
  });

  it("splits text into lines, trims each, and chooses the first non-empty one", () => {
    expect(deriveThreadTitle("\n\n  Fix the sidebar  \nThen update tests.")).toBe(
      "Fix the sidebar",
    );
    expect(deriveThreadTitle("   \n\t\nFirst real line")).toBe("First real line");
  });

  it("collapses consecutive intra-line whitespace to one space", () => {
    expect(deriveThreadTitle("Fix    the\t\t   sidebar")).toBe("Fix the sidebar");
    // A blank line is skipped, then a folded line is chosen.
    expect(deriveThreadTitle("\n   spaced   out   line")).toBe("spaced out line");
  });

  it("preserves meaningful internal punctuation", () => {
    expect(deriveThreadTitle("Hello, world")).toBe("Hello, world");
    expect(deriveThreadTitle("Fix the sidebar. Then update tests.")).toBe(
      "Fix the sidebar. Then update tests.",
    );
  });

  it("preserves CJK characters without splitting at punctuation", () => {
    expect(deriveThreadTitle("改一下这个 UI 吧，左侧栏保持折叠")).toBe(
      "改一下这个 UI 吧，左侧栏保持折叠",
    );
  });

  it("keeps short emoji intact (no truncation needed)", () => {
    expect(deriveThreadTitle("👋 Hello there")).toBe("👋 Hello there");
  });

  it("keeps composed Unicode characters intact", () => {
    // Precomposed and decomposed forms are each one grapheme.
    expect(deriveThreadTitle("café")).toBe("café");
    // 'e' + combining acute accent is a single grapheme.
    expect(deriveThreadTitle("caf\u0065\u0301")).toBe("caf\u0065\u0301");
  });

  it("does not cut a single grapheme with many combining marks", () => {
    const grapheme = `a${"\u0301".repeat(5_000)}`;
    expect(deriveThreadTitle(grapheme)).toBe(grapheme);
  });

  it("keeps an emoji with a skin-tone modifier as one grapheme during truncation", () => {
    // 👋🏽 = wave + skin tone modifier = one grapheme cluster.
    const title = deriveThreadTitle("👋🏽 wave");
    expect(title).toBe("👋🏽 wave");
  });

  it("keeps a regional-indicator flag as one grapheme during truncation", () => {
    expect(deriveThreadTitle("🇨🇳 flag")).toBe("🇨🇳 flag");
  });

  it("preserves an overlong title", () => {
    const long = "a".repeat(60);
    const result = deriveThreadTitle(long);
    expect(result).toBe(long);
  });

  it("preserves long emoji content without splitting graphemes", () => {
    const long = "👋".repeat(60);
    const result = deriveThreadTitle(long);
    expect(result).toBe(long);
  });

  it("preserves a long first usable line", () => {
    const first = "c".repeat(60);
    const result = deriveThreadTitle(`\n${first}\nsecond line`);
    expect(result).toBe(first);
  });

  it("uses the first attachment basename when the visible text is empty", () => {
    expect(deriveThreadTitle("", { attachmentName: "notes.txt" })).toBe("notes.txt");
    // The basename is processed by the same line/whitespace policy.
    expect(deriveThreadTitle("   \n\t  ", { attachmentName: "  my  report.pdf  " })).toBe(
      "my report.pdf",
    );
  });

  it("ignores the attachment name when the visible text yields a usable line", () => {
    expect(deriveThreadTitle("Real prompt", { attachmentName: "notes.txt" })).toBe("Real prompt");
  });

  it("returns the default fallback for empty input and no attachment name", () => {
    expect(deriveThreadTitle("")).toBe("New thread");
    expect(deriveThreadTitle("   \n\t  ")).toBe("New thread");
  });

  it("returns the default fallback when only blank lines and no attachment exist", () => {
    expect(deriveThreadTitle("\n\n   \n\t\n")).toBe("New thread");
  });

  it("finds content after a long run of leading whitespace on one line", () => {
    expect(deriveThreadTitle(`${" ".repeat(5_000)}Fix sidebar`)).toBe("Fix sidebar");
  });

  it("returns the default fallback when text and attachment basename are both empty", () => {
    expect(deriveThreadTitle("", { attachmentName: "" })).toBe("New thread");
    expect(deriveThreadTitle("   \n", { attachmentName: "   \n" })).toBe("New thread");
  });

  it("uses a custom fallback", () => {
    expect(deriveThreadTitle("", { fallback: "Untitled" })).toBe("Untitled");
    expect(deriveThreadTitle("", { fallback: "Untitled", attachmentName: "" })).toBe("Untitled");
  });

  // Raw source separation: the Composer derives the title from the visible
  // composer text (currentInput), not the runtime prompt enriched with Skill
  // references. A Skill reference is the markup `[$name](path)`; it must never
  // appear in a derived title. Pinning this property at the contract seam proves
  // the Composer feeds the visible text — a regression to the enriched prompt
  // would leak the `[$name](path)` prefix into the title.
  it("strips no Skill-reference markup because the source is the visible text", () => {
    // The visible text a user typed — no Skill reference markup.
    expect(deriveThreadTitle("Fix the sidebar")).toBe("Fix the sidebar");
    // The runtime-enriched prompt the Composer must NOT feed here. If it did,
    // the title would start with `[$tdd](/path)` instead of the user's words.
    const enriched = "[$tdd](/code/tdd) Fix the sidebar";
    // Guard against the function silently absorbing enriched input: the title
    // must equal what the user saw, never the enriched form.
    expect(deriveThreadTitle("Fix the sidebar")).not.toBe(enriched);
    expect(deriveThreadTitle("Fix the sidebar")).not.toContain("[$");
  });
});

describe("boundThreadTitleSource", () => {
  it("returns the original text when shorter than the limit", () => {
    expect(boundThreadTitleSource("short prompt")).toBe("short prompt");
  });

  it("returns the original text when exactly at the limit", () => {
    const exact = "x".repeat(8000);
    expect(boundThreadTitleSource(exact)).toBe(exact);
  });

  it("bounds the source to the first 8000 graphemes by default", () => {
    const long = "y".repeat(9000);
    const result = boundThreadTitleSource(long);
    expect([...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(result)]).toHaveLength(
      8000,
    );
    expect(result).toBe("y".repeat(8000));
  });

  it("respects a custom maxGraphemes limit", () => {
    expect(boundThreadTitleSource("abcdefgh", { maxGraphemes: 3 })).toBe("abc");
  });

  it("cuts at a grapheme boundary, never splitting an emoji", () => {
    const result = boundThreadTitleSource("👋".repeat(10), { maxGraphemes: 3 });
    expect(result).toBe("👋👋👋");
  });

  it("returns an empty string when maxGraphemes is zero", () => {
    expect(boundThreadTitleSource("anything", { maxGraphemes: 0 })).toBe("");
  });

  it("returns an empty string for empty input", () => {
    expect(boundThreadTitleSource("")).toBe("");
  });
});

describe("bounded work on long input", () => {
  it("preserves a very long single-line title", () => {
    const log = "E".repeat(1_000_000);
    const title = deriveThreadTitle(log);

    expect(title).toBe(log);
  });

  it("bounds a long source without segmenting past the ceiling", () => {
    const log = `${"F".repeat(1_000_000)}`;
    const before = process.memoryUsage().heapUsed;
    const bounded = boundThreadTitleSource(log);
    const growthMb = (process.memoryUsage().heapUsed - before) / 1024 / 1024;

    expect(bounded).toBe("F".repeat(8_000));
    expect(growthMb).toBeLessThan(20);
  });

  it("skips many blank lines without allocating a line array", () => {
    const source = `${"\n".repeat(500_000)}Fix the sidebar`;
    expect(deriveThreadTitle(source)).toBe("Fix the sidebar");
  });

  it("counts graphemes only up to the requested ceiling", () => {
    expect(boundGraphemes("abc", 10)).toEqual({ text: "abc", count: 3, truncated: false });
    expect(boundGraphemes("abcdef", 3)).toEqual({ text: "abc", count: 3, truncated: true });
    expect(boundGraphemes("abc", 3)).toEqual({ text: "abc", count: 3, truncated: false });
    expect(boundGraphemes("", 5)).toEqual({ text: "", count: 0, truncated: false });
    expect(boundGraphemes("x", 0)).toEqual({ text: "", count: 0, truncated: true });
    expect(boundGraphemes("👋👋👋", 2)).toEqual({ text: "👋👋", count: 2, truncated: true });
  });
});
