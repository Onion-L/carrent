import { describe, expect, it } from "bun:test";

import { formatSkillLabel } from "./skillLabel";

describe("formatSkillLabel", () => {
  it("capitalizes skill names and replaces separators with spaces", () => {
    expect(formatSkillLabel("improve")).toBe("Improve");
    expect(formatSkillLabel("diagnosing-bugs")).toBe("Diagnosing Bugs");
  });

  it("formats namespaced skills", () => {
    expect(formatSkillLabel("browser:control-in-app-browser")).toBe(
      "Browser: Control In App Browser",
    );
  });
});
