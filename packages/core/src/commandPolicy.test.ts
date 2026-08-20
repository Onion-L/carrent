import { describe, expect, it } from "bun:test";

import { classifyCommand } from "./commandPolicy";

describe("classifyCommand", () => {
  it("allows ordinary project commands only in Full Project mode", () => {
    expect(classifyCommand("bun test", "/work/project", "full-project").requiresApproval).toBe(
      false,
    );
    expect(classifyCommand("bun test", "/work/project", "auto-edit").requiresApproval).toBe(true);
  });

  it("allows commands that discard output to /dev/null in Full Project mode", () => {
    expect(
      classifyCommand("git log --oneline -5 2>/dev/null", "/work/project", "full-project")
        .requiresApproval,
    ).toBe(false);
  });

  it("always requests approval for network and dangerous commands", () => {
    expect(classifyCommand("curl https://example.com", "/work/project", "full-project").action).toBe(
      "network",
    );
    expect(classifyCommand("rm -rf build", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("rm build.log", "/work/project", "full-project").action).toBe(
      "dangerous",
    );
    expect(classifyCommand("gh pr view", "/work/project", "full-project").action).toBe("network");
  });

  it("requests approval for absolute paths outside the project", () => {
    expect(
      classifyCommand("cat /private/tmp/data", "/work/project", "full-project").requiresApproval,
    ).toBe(true);
    expect(
      classifyCommand("cat ../secrets.txt", "/work/project", "full-project").requiresApproval,
    ).toBe(true);
    expect(classifyCommand("cat ~/.ssh/config", "/work/project", "full-project").requiresApproval).toBe(
      true,
    );
    expect(
      classifyCommand('cat "$HOME/.ssh/config"', "/work/project", "full-project").requiresApproval,
    ).toBe(true);
  });
});
