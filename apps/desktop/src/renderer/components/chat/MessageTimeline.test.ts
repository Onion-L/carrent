import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  buildUserMessageEditContent,
  getAssistantMessagePresentation,
  getUserMessageEditDraft,
  parseSkillReferenceSegments,
  splitLeadingSkillReferences,
  UserMessageAttachmentList,
} from "./MessageTimeline";
import type { Message } from "../../mock/uiShellData";
import { getPlanReviewStatusLabel } from "./PlanReviewBlock";

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

  it("preserves mixed attachments in the edit draft", () => {
    const attachments = [
      {
        id: "a1",
        kind: "image" as const,
        name: "screenshot.png",
        mimeType: "image/png",
        size: 1024,
        storageKey: "a1.png",
      },
      {
        id: "a2",
        kind: "file" as const,
        name: "main.ts",
        mimeType: "text/plain",
        size: 512,
        storageKey: "a2.ts",
      },
    ];
    const message: Message = {
      id: "msg-1",
      threadId: "thread-1",
      role: "user",
      content: "check these",
      timestamp: "09:00",
      type: "text",
      attachments,
    };

    expect(getUserMessageEditDraft(message)?.attachments).toEqual(attachments);
  });
});

describe("UserMessageAttachmentList", () => {
  it("renders file rows and image thumbnails without app-data paths", () => {
    const markup = renderToStaticMarkup(
      createElement(UserMessageAttachmentList, {
        attachments: [
          {
            id: "a1",
            kind: "image" as const,
            name: "screenshot.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a1.png",
          },
          {
            id: "a2",
            kind: "file" as const,
            name: "main.ts",
            mimeType: "text/plain",
            size: 512,
            storageKey: "a2.ts",
          },
        ],
      }),
    );

    expect(markup).toContain("main.ts");
    expect(markup).toContain("512 B");
    expect(markup).toContain("screenshot.png");
    expect(markup).not.toContain("a1.png");
    expect(markup).not.toContain("a2.ts");
    expect(markup).not.toContain("/tmp");
  });

  it("maps lightbox clicks to image-only indexes", () => {
    const clicked: number[] = [];
    const markup = renderToStaticMarkup(
      createElement(UserMessageAttachmentList, {
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "notes.md",
            mimeType: "text/plain",
            size: 5,
            storageKey: "a1.md",
          },
        ],
        onImageClick: (index: number) => clicked.push(index),
      }),
    );

    expect(clicked).toEqual([]);
    expect(markup).toContain("notes.md");
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
      prefix: "[$grill-with-docs](/Users/test/.agents/skills/grill-with-docs/SKILL.md) ",
      body: "实现编辑",
    });
  });

  it("builds submitted content from the preserved skill prefix and edited body", () => {
    expect(
      buildUserMessageEditContent(
        "[$grill-with-docs](/Users/test/.agents/skills/grill-with-docs/SKILL.md) ",
        "  改成内联编辑  ",
      ),
    ).toBe("[$grill-with-docs](/Users/test/.agents/skills/grill-with-docs/SKILL.md) 改成内联编辑");
  });
});

describe("assistant message presentation", () => {
  it("uses streamed assistant text as Thinking content until the run completes", () => {
    const parts = [
      {
        type: "reasoning" as const,
        id: "kimi-thinking-1",
        content: "Private thought",
        status: "completed" as const,
      },
      { type: "text" as const, content: "I will inspect the project first." },
      {
        type: "shell" as const,
        id: "shell-1",
        command: "pwd",
        output: "",
        status: "running" as const,
      },
    ];

    expect(getAssistantMessagePresentation(parts, "running")).toEqual({
      activityItems: [
        {
          type: "commentary",
          id: "commentary-1",
          content: "I will inspect the project first.",
        },
        parts[2],
      ],
      answerText: "",
    });
  });

  it("separates trailing text as the final answer after completion", () => {
    const parts = [
      { type: "text" as const, content: "I will inspect the project first." },
      {
        type: "shell" as const,
        id: "shell-1",
        command: "pwd",
        output: "/tmp",
        status: "completed" as const,
      },
      { type: "text" as const, content: "The project is ready." },
    ];

    expect(getAssistantMessagePresentation(parts, "completed")).toEqual({
      activityItems: [
        {
          type: "commentary",
          id: "commentary-0",
          content: "I will inspect the project first.",
        },
        parts[1],
      ],
      answerText: "The project is ready.",
    });
  });

  it("treats a tool-free completed response as the final answer", () => {
    expect(
      getAssistantMessagePresentation([{ type: "text", content: "Direct answer" }], "completed"),
    ).toEqual({ activityItems: [], answerText: "Direct answer" });
  });
});

describe("Plan Review presentation", () => {
  const review = {
    type: "plan_review" as const,
    id: "review-1",
    permissionId: "permission-1",
    content: "# Plan",
    status: "pending" as const,
    options: [
      { optionId: "plan_opt_0", name: "Approach A", kind: "allow_once" as const },
      { optionId: "plan_opt_1", name: "Approach B", kind: "allow_once" as const },
      { optionId: "plan_revise", name: "Revise", kind: "reject_once" as const },
      {
        optionId: "plan_reject_and_exit",
        name: "Reject and Exit",
        kind: "reject_once" as const,
      },
    ],
  };

  it("keeps the plan presentation conversational after resolution", () => {
    expect(getPlanReviewStatusLabel(review)).toBe("Plan");
    expect(getPlanReviewStatusLabel({ ...review, status: "rejected" })).toBe("Plan");
  });
});
