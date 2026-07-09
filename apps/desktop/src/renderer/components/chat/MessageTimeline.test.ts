import { describe, expect, it } from "bun:test";

import {
  buildUserMessageEditContent,
  getUserMessageEditDraft,
  parseSkillReferenceSegments,
  splitLeadingSkillReferences,
} from "./MessageTimeline";
import type { Message } from "../../mock/uiShellData";

describe("parseSkillReferenceSegments", () => {
  it("keeps plain text unchanged", () => {
    expect(parseSkillReferenceSegments("hello")).toEqual([
      { type: "text", content: "hello" },
    ]);
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
      parseSkillReferenceSegments(
        "use [$one](/tmp/one/SKILL.md) and [$two](/tmp/two/SKILL.md)",
      ),
    ).toEqual([
      { type: "text", content: "use " },
      { type: "skill", name: "one", path: "/tmp/one/SKILL.md" },
      { type: "text", content: " and " },
      { type: "skill", name: "two", path: "/tmp/two/SKILL.md" },
    ]);
  });
});

describe("getUserMessageEditDraft", () => {
  it("returns editable content for user text messages", () => {
    const message: Message = {
      id: "msg-1",
      threadId: "thread-1",
      role: "user",
      content: "please fix this",
      timestamp: "09:00",
      type: "text",
    };

    expect(getUserMessageEditDraft(message)).toEqual({
      messageId: "msg-1",
      content: "please fix this",
      attachments: undefined,
    });
  });

  it("keeps surrounding whitespace in the draft", () => {
    const message: Message = {
      id: "msg-1",
      threadId: "thread-1",
      role: "user",
      content: "  keep spacing\n",
      timestamp: "09:00",
      type: "text",
    };

    expect(getUserMessageEditDraft(message)?.content).toBe("  keep spacing\n");
  });

  it("does not edit empty user messages", () => {
    const message: Message = {
      id: "msg-1",
      threadId: "thread-1",
      role: "user",
      content: "   ",
      timestamp: "09:00",
      type: "text",
    };

    expect(getUserMessageEditDraft(message)).toBe(null);
  });

  it("does not edit assistant messages", () => {
    const message: Message = {
      id: "msg-1",
      threadId: "thread-1",
      role: "assistant",
      content: "answer",
      timestamp: "09:00",
      type: "text",
    };

    expect(getUserMessageEditDraft(message)).toBe(null);
  });
});

describe("user message inline editing", () => {
  it("splits leading skill references from editable body text", () => {
    expect(
      splitLeadingSkillReferences(
        "[$grill-with-docs](/Users/test/.agents/skills/grill-with-docs/SKILL.md) 实现编辑",
      ),
    ).toEqual({
      skills: [
        {
          type: "skill",
          name: "grill-with-docs",
          path: "/Users/test/.agents/skills/grill-with-docs/SKILL.md",
        },
      ],
      prefix:
        "[$grill-with-docs](/Users/test/.agents/skills/grill-with-docs/SKILL.md) ",
      body: "实现编辑",
    });
  });

  it("builds submitted content from the preserved skill prefix and edited body", () => {
    expect(
      buildUserMessageEditContent(
        "[$grill-with-docs](/Users/test/.agents/skills/grill-with-docs/SKILL.md) ",
        "  改成内联编辑  ",
      ),
    ).toBe(
      "[$grill-with-docs](/Users/test/.agents/skills/grill-with-docs/SKILL.md) 改成内联编辑",
    );
  });
});
