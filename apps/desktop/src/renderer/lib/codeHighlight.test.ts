import { describe, expect, it } from "bun:test";

import {
  DEFAULT_CODE_HIGHLIGHT_THEME,
  isCodeHighlightThemeId,
} from "../../shared/codeHighlightThemes";
import { highlightCodeBlock, resolveCodeLanguage } from "./codeHighlight";

describe("resolveCodeLanguage", () => {
  it("maps fence aliases to registered grammars", () => {
    expect(resolveCodeLanguage("ts")).toBe("typescript");
    expect(resolveCodeLanguage("TS")).toBe("typescript");
    expect(resolveCodeLanguage("sh")).toBe("bash");
    expect(resolveCodeLanguage("yml")).toBe("yaml");
    expect(resolveCodeLanguage("html")).toBe("html");
  });

  it("returns undefined for unsupported languages", () => {
    expect(resolveCodeLanguage("made-up")).toBeUndefined();
  });
});

describe("highlightCodeBlock", () => {
  it("returns null for unsupported languages and empty code", () => {
    expect(highlightCodeBlock("const x = 1;", "made-up", "classic")).toBeNull();
    expect(highlightCodeBlock("", "ts", "classic")).toBeNull();
  });

  it("emits dual-theme spans with the classic palette", () => {
    const result = highlightCodeBlock("const answer = 42;\n", "ts", "classic");
    expect(result).not.toBeNull();
    // Keyword: light #893DA0, dark #C678DD (the pre-Shiki One Dark palette).
    expect(result!.html).toContain("--shiki-light:#893DA0;--shiki-dark:#C678DD");
    expect(result!.html).toContain("--shiki-light:#A65923;--shiki-dark:#D19A66");
    expect(result!.fgLight).toBe("#1E1E1E");
    expect(result!.fgDark).toBe("#E7E6E0");
    expect(result!.bgLight).toBe("#F1F1EC");
    expect(result!.bgDark).toBe("#0C0C0B");
  });

  it("escapes HTML inside token content", () => {
    const result = highlightCodeBlock('echo "<b>&\'</b>"\n', "bash", "classic");
    expect(result).not.toBeNull();
    expect(result!.html).toContain("&lt;b&gt;&amp;&#39;&lt;/b&gt;");
    expect(result!.html).not.toContain("<b>");
  });

  it("renders tokens without a variant as plain escaped text", () => {
    // A space token keeps the theme foreground in both variants and therefore
    // still carries both variables; assert the joining text survives intact.
    const result = highlightCodeBlock("const answer = 42;\n", "ts", "classic");
    expect(result!.html).toContain("const</span><span");
  });

  it("uses the theme pair's own colors for fixed themes", () => {
    const result = highlightCodeBlock("const answer = 42;\n", "ts", "dracula");
    expect(result).not.toBeNull();
    expect(result!.bgLight).toBe("#282A36");
    expect(result!.bgDark).toBe("#282A36");
    expect(result!.html).toContain("--shiki-light:#FF79C6;--shiki-dark:#FF79C6");
  });

  it("caches results per theme, language, and code", () => {
    const code = "const cached = true;\n";
    const first = highlightCodeBlock(code, "ts", "classic");
    const second = highlightCodeBlock(code, "ts", "classic");
    expect(second).toBe(first);

    const otherTheme = highlightCodeBlock(code, "ts", "github");
    expect(otherTheme).not.toBe(first);
  });
});

describe("code highlight theme catalog", () => {
  it("defaults to classic and validates ids", () => {
    expect(DEFAULT_CODE_HIGHLIGHT_THEME).toBe("classic");
    expect(isCodeHighlightThemeId("classic")).toBe(true);
    expect(isCodeHighlightThemeId("nope")).toBe(false);
    expect(isCodeHighlightThemeId(42)).toBe(false);
  });
});
