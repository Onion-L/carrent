import { describe, expect, it } from "bun:test";

import {
  TYPEWRITER_CHARS_PER_TICK,
  getNextTypewriterText,
  hasPendingTypewriterText,
} from "./typewriter";

describe("typewriter", () => {
  it("reveals only the next chunk of received text", () => {
    expect(getNextTypewriterText("", "hello")).toBe("hello".slice(0, TYPEWRITER_CHARS_PER_TICK));
  });

  it("keeps existing visible text and appends the next chunk", () => {
    expect(getNextTypewriterText("he", "hello world")).toBe(
      "hello world".slice(0, 2 + TYPEWRITER_CHARS_PER_TICK),
    );
  });

  it("never overshoots the received text", () => {
    expect(getNextTypewriterText("hell", "hello")).toBe("hello");
  });

  it("reconciles immediately when final text is not a prefix extension", () => {
    expect(getNextTypewriterText("hello extra", "hello")).toBe("hello");
    expect(getNextTypewriterText("hello", "goodbye")).toBe("goodbye");
  });

  it("detects pending received text", () => {
    expect(hasPendingTypewriterText("he", "hello")).toBe(true);
    expect(hasPendingTypewriterText("hello", "hello")).toBe(false);
  });
});
