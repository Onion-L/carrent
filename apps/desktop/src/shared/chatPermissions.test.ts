import { describe, expect, it } from "bun:test";
import {
  CHAT_PERMISSION_TIMEOUT_MS,
  buildPermissionExpiry,
  isChatPermissionDecision,
} from "./chatPermissions";

describe("chatPermissions", () => {
  it("uses a bounded approval timeout", () => {
    expect(CHAT_PERMISSION_TIMEOUT_MS).toBeGreaterThan(0);
    expect(CHAT_PERMISSION_TIMEOUT_MS).toBe(60_000);
  });

  it("validates permission decisions", () => {
    expect(isChatPermissionDecision("approved")).toBe(true);
    expect(isChatPermissionDecision("denied")).toBe(true);
    expect(isChatPermissionDecision("other")).toBe(false);
  });

  it("builds an expiry timestamp from a start time", () => {
    expect(buildPermissionExpiry("2026-01-01T00:00:00.000Z", 1000)).toBe(
      "2026-01-01T00:00:01.000Z",
    );
  });
});
