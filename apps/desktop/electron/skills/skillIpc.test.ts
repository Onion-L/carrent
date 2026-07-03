import { describe, expect, it } from "bun:test";

import type { SkillRecord } from "../../src/shared/skills";
import { registerSkillIpc } from "./skillIpc";

describe("registerSkillIpc", () => {
  it("registers skills:list and dispatches to the service", async () => {
    const handlers = new Map<string, (event: unknown) => unknown>();
    const result: SkillRecord[] = [
      {
        name: "grilling",
        description: "Interview the user relentlessly.",
        path: "/Users/test/.agents/skills/grilling/SKILL.md",
        source: "agents",
      },
    ];

    registerSkillIpc(
      {
        handle(channel, listener) {
          handlers.set(channel, listener);
        },
      },
      {
        async list() {
          return result;
        },
      },
    );

    expect([...handlers.keys()]).toEqual(["skills:list"]);
    expect(await handlers.get("skills:list")?.({})).toEqual(result);
  });
});
