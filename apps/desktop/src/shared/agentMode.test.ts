import { describe, expect, it } from "bun:test";

import { getAgentModeLabel, normalizeAgentMode } from "./agentMode";

describe("Agent Mode", () => {
  it("uses Ask for unknown persisted values", () => {
    expect(normalizeAgentMode("unsupported-mode")).toBe("ask");
  });

  it("uses the product mode labels", () => {
    expect(getAgentModeLabel("ask")).toBe("Ask");
    expect(getAgentModeLabel("auto-edit")).toBe("Auto Edit");
    expect(getAgentModeLabel("full-project")).toBe("Full Project");
  });
});
