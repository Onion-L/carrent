import { describe, expect, it } from "bun:test";
import { deriveThreadTitle } from "./threadTitle";

describe("deriveThreadTitle", () => {
  it("returns the first sentence up to a comma", () => {
    expect(deriveThreadTitle("Hello, world")).toBe("Hello");
  });

  it("returns the first sentence up to a period", () => {
    expect(deriveThreadTitle("Fix the sidebar. Then update tests.")).toBe("Fix the sidebar");
  });

  it("stops at a semicolon", () => {
    expect(deriveThreadTitle("Refactor auth; add OAuth support")).toBe("Refactor auth");
  });

  it("stops at a newline", () => {
    expect(deriveThreadTitle("First line\nSecond line")).toBe("First line");
  });

  it("trims leading and trailing whitespace", () => {
    expect(deriveThreadTitle("  Deploy to staging  ")).toBe("Deploy to staging");
  });

  it("truncates with ellipsis when there is no punctuation and the text is too long", () => {
    const longText = "This is a very long message without any punctuation marks at all";
    expect(deriveThreadTitle(longText)).toBe("This is a very long message without any...");
  });

  it("does not truncate short text without punctuation", () => {
    expect(deriveThreadTitle("Short message")).toBe("Short message");
  });

  it("supports a custom max length", () => {
    expect(deriveThreadTitle("Hello world", { maxLength: 5 })).toBe("Hello...");
  });

  it("returns the fallback for empty input", () => {
    expect(deriveThreadTitle("")).toBe("New thread");
  });

  it("returns the fallback for whitespace-only input", () => {
    expect(deriveThreadTitle("   \n\t  ")).toBe("New thread");
  });

  it("returns the fallback when content only starts with punctuation", () => {
    expect(deriveThreadTitle(", only punctuation")).toBe("New thread");
  });

  it("handles Chinese punctuation", () => {
    expect(deriveThreadTitle("改一下这个 UI 吧，左侧栏保持折叠")).toBe("改一下这个 UI 吧");
  });

  it("uses a custom fallback", () => {
    expect(deriveThreadTitle("", { fallback: "Untitled" })).toBe("Untitled");
  });
});
