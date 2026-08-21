import { describe, expect, it } from "bun:test";

import { getAgentModeDescription, getAgentModeLabel, normalizeAgentMode } from "./agentMode";

describe("Agent Mode", () => {
  it("uses Ask for unknown persisted values", () => {
    expect(normalizeAgentMode("unsupported-mode")).toBe("ask");
  });

  it("uses the product mode labels", () => {
    expect(getAgentModeLabel("ask")).toBe("Ask");
    expect(getAgentModeLabel("auto-edit")).toBe("Auto");
    expect(getAgentModeLabel("full-project")).toBe("Full Access");
  });

  it("describes what each mode allows", () => {
    expect(getAgentModeDescription("ask")).toBe("Approve every write and command");
    expect(getAgentModeDescription("auto-edit")).toBe(
      "Write and run safe commands inside the project",
    );
    expect(getAgentModeDescription("full-project")).toBe(
      "Full access inside the project, including deletes",
    );
  });
});
