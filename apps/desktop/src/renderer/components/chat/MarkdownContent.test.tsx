import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "bun:test";

import { MarkdownContent, normalizeMathDelimiters } from "./MarkdownContent";

describe("normalizeMathDelimiters", () => {
  it("converts TeX display math delimiters", () => {
    expect(normalizeMathDelimiters(String.raw`\[ \frac{AD}{\sin x} \]`)).toBe(
      "\n$$\n" + String.raw` \frac{AD}{\sin x} ` + "\n$$\n",
    );
  });

  it("converts TeX inline math delimiters", () => {
    expect(normalizeMathDelimiters(String.raw`答案是 \(150^\circ\)`)).toBe(
      String.raw`答案是 $150^\circ$`,
    );
  });
});

describe("MarkdownContent", () => {
  it("renders TeX display math delimiters with KaTeX", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent>{String.raw`\[ \frac{AD}{\sin x} \]`}</MarkdownContent>,
    );

    expect(html).toContain("katex-display");
  });

  it("highlights fenced TypeScript code when a language is provided", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent>{"```ts\nconst answer: number = 42;\n```"}</MarkdownContent>,
    );

    expect(html).toContain("markdown-code-block");
    expect(html).toContain("markdown-code-highlight");
    // Classic default theme colors keywords purple in dark mode.
    expect(html).toContain("--shiki-light:#893DA0;--shiki-dark:#C678DD");
    expect(html).toContain("--shiki-light:#A65923;--shiki-dark:#D19A66");
    expect(html).toContain("const");
    expect(html).toContain("42");
  });

  it("keeps unknown code languages as plain code", () => {
    const html = renderToStaticMarkup(
      <MarkdownContent>{"```made-up\nconst answer = 42;\n```"}</MarkdownContent>,
    );

    expect(html).not.toContain("markdown-code-block");
    expect(html).not.toContain("markdown-code-highlight");
    expect(html).toContain("const answer = 42;");
  });
});
