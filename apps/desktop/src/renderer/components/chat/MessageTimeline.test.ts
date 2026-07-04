import { describe, expect, it } from "bun:test";

import { parseSkillReferenceSegments } from "./MessageTimeline";

describe("parseSkillReferenceSegments", () => {
  it("keeps plain text unchanged", () => {
    expect(parseSkillReferenceSegments("hello")).toEqual([{ type: "text", content: "hello" }]);
  });

  it("extracts a skill markdown reference", () => {
    expect(
      parseSkillReferenceSegments(
        "[$grill-with-docs](/Users/test/.agents/skills/grill-with-docs/SKILL.md) 写一个 plan",
      ),
    ).toEqual([
      {
        type: "skill",
        name: "grill-with-docs",
        path: "/Users/test/.agents/skills/grill-with-docs/SKILL.md",
      },
      { type: "text", content: " 写一个 plan" },
    ]);
  });

  it("handles multiple skill references", () => {
    expect(
      parseSkillReferenceSegments("use [$one](/tmp/one/SKILL.md) and [$two](/tmp/two/SKILL.md)"),
    ).toEqual([
      { type: "text", content: "use " },
      { type: "skill", name: "one", path: "/tmp/one/SKILL.md" },
      { type: "text", content: " and " },
      { type: "skill", name: "two", path: "/tmp/two/SKILL.md" },
    ]);
  });
});
