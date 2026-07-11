import { describe, expect, it } from "bun:test";

import { normalizeMcpServerStatus } from "./mcpServer";

describe("normalizeMcpServerStatus", () => {
  it("treats a running legacy status as enabled and discards its URL", () => {
    expect(
      normalizeMcpServerStatus({
        running: true,
        url: "http://127.0.0.1:1234/mcp?token=test",
      }),
    ).toEqual({
      enabled: true,
      running: true,
    });
  });

  it("keeps an explicitly stopped server disabled", () => {
    expect(normalizeMcpServerStatus({ enabled: false, running: false })).toEqual({
      enabled: false,
      running: false,
    });
  });

  it("treats running as enabled if a caller returns a contradictory status", () => {
    expect(normalizeMcpServerStatus({ enabled: false, running: true })).toEqual({
      enabled: true,
      running: true,
    });
  });
});
