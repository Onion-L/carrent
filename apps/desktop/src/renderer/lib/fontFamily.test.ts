import { describe, expect, it } from "bun:test";

import {
  BASE_FONT_SANS_STACK,
  buildFontSansStack,
  escapeFontFamilyName,
} from "./fontFamily";

describe("escapeFontFamilyName", () => {
  it("leaves a plain name untouched", () => {
    expect(escapeFontFamilyName("Comic Sans MS")).toBe("Comic Sans MS");
  });

  it("escapes a double quote", () => {
    expect(escapeFontFamilyName('a"b')).toBe('a\\"b');
  });

  it("escapes a backslash", () => {
    expect(escapeFontFamilyName("a\\b")).toBe("a\\\\b");
  });

  it("escapes backslash before quote so the quote escape is not double-escaped", () => {
    // Input is two characters: backslash, quote. The backslash must become \\
    // first, then the quote becomes \", yielding four characters: \\\" .
    expect(escapeFontFamilyName('\\"')).toBe('\\\\\\"');
  });

  it("returns an empty string unchanged", () => {
    expect(escapeFontFamilyName("")).toBe("");
  });
});

describe("buildFontSansStack", () => {
  it("returns the base stack unchanged when no custom font is set", () => {
    expect(buildFontSansStack("")).toBe(BASE_FONT_SANS_STACK);
  });

  it("prepends the quoted custom font before the base stack", () => {
    expect(buildFontSansStack("Comic Sans MS")).toBe(
      `"Comic Sans MS", ${BASE_FONT_SANS_STACK}`,
    );
  });

  it("escapes special characters in the custom font name", () => {
    expect(buildFontSansStack('Te"st')).toBe(`"Te\\"st", ${BASE_FONT_SANS_STACK}`);
  });
});
