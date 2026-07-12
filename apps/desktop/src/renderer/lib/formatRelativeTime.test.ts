import { describe, expect, it } from "bun:test";

import { formatRelativeTime } from "./formatRelativeTime";

describe("formatRelativeTime", () => {
  const now = Date.parse("2026-05-01T12:00:00Z");

  it("uses compact relative labels", () => {
    expect(formatRelativeTime(now - 30_000, now)).toBe("now");
    expect(formatRelativeTime(now - 12 * 60_000, now)).toBe("12m");
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe("3h");
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe("2d");
  });

  it("returns an empty label for invalid timestamps", () => {
    expect(formatRelativeTime(Number.NaN, now)).toBe("");
  });
});
