import { describe, expect, it } from "bun:test";
import { deriveThreadTitle } from "./threadTitle";

describe("deriveThreadTitle", () => {
  it("returns the full text without splitting at punctuation", () => {
    expect(deriveThreadTitle("Hello, world")).toBe("Hello, world");
    expect(deriveThreadTitle("Fix the sidebar. Then update tests.")).toBe(
      "Fix the sidebar. Then update tests.",
    );
    expect(deriveThreadTitle("改一下这个 UI 吧，左侧栏保持折叠")).toBe(
      "改一下这个 UI 吧，左侧栏保持折叠",
    );
  });

  it("does not split at a newline", () => {
    expect(deriveThreadTitle("First line\nSecond line")).toBe("First line\nSecond line");
  });

  it("trims leading and trailing whitespace", () => {
    expect(deriveThreadTitle("  Deploy to staging  ")).toBe("Deploy to staging");
  });

  it("keeps long text untruncated (the UI reveals it with a hover marquee)", () => {
    const longText = "This is a very long message without any punctuation marks at all";
    expect(deriveThreadTitle(longText)).toBe(longText);
  });

  it("returns the fallback for empty input", () => {
    expect(deriveThreadTitle("")).toBe("New thread");
  });

  it("returns the fallback for whitespace-only input", () => {
    expect(deriveThreadTitle("   \n\t  ")).toBe("New thread");
  });

  it("uses a custom fallback", () => {
    expect(deriveThreadTitle("", { fallback: "Untitled" })).toBe("Untitled");
  });
});
