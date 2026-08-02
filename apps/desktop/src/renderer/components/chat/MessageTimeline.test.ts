import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";

import {
  buildUserMessageEditContent,
  getAssistantMessagePresentation,
  getUserMessageEditDraft,
  MessageTimeline,
  parseFileReferenceSegments,
  parseSkillReferenceSegments,
  splitLeadingSkillReferences,
  UserMessageAttachmentList,
} from "./MessageTimeline";
import type { Message } from "../../../shared/threadContent";
import { getPlanReviewStatusLabel } from "./PlanReviewBlock";
import { ErrorBlock } from "./ErrorBlock";

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

  it("renders a formatted skill label without the reference marker", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageTimeline, {
        messages: [
          {
            id: "msg-1",
            threadId: "thread-1",
            role: "user" as const,
            content: "[$improve](/Users/test/.agents/skills/improve/SKILL.md)",
            timestamp: "09:00",
            type: "text" as const,
          },
        ],
      }),
    );

    expect(markup).toContain("Improve");
    expect(markup).not.toContain("$improve");
  });
});

describe("user message presentation", () => {
  it("wraps long paths inside the message bubble", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageTimeline, {
        messages: [
          {
            id: "msg-1",
            threadId: "thread-1",
            role: "user" as const,
            content:
              "/Users/test/workbench/carrent/apps/desktop/src/renderer/components/DesktopShell.tsx:171",
            timestamp: "09:00",
            type: "text" as const,
          },
        ],
      }),
    );

    expect(markup).toContain("whitespace-pre-wrap break-words");
  });

  it("renders file reference links as styled badges without the raw path", () => {
    const markup = renderToStaticMarkup(
      createElement(MessageTimeline, {
        messages: [
          {
            id: "msg-1",
            threadId: "thread-1",
            role: "user" as const,
            content:
              "相关代码在 [index.css (line 30)](/Users/test/workbench/carrent/apps/desktop/src/styles/index.css:30)。",
            timestamp: "09:00",
            type: "text" as const,
          },
        ],
      }),
    );

    expect(markup).toContain("index.css (line 30)");
    expect(markup).not.toContain("](/Users");
    expect(markup).toContain("text-skill-reference");
  });
});

describe("parseFileReferenceSegments", () => {
  it("extracts absolute file reference links", () => {
    expect(
      parseFileReferenceSegments(
        "相关代码在 [index.css (line 30)](/Users/test/index.css:30) 和 [DesktopShell.tsx (line 171)](/Users/test/DesktopShell.tsx:171)。",
      ),
    ).toEqual([
      { type: "text", content: "相关代码在 " },
      { type: "file", label: "index.css (line 30)", path: "/Users/test/index.css:30" },
      { type: "text", content: " 和 " },
      {
        type: "file",
        label: "DesktopShell.tsx (line 171)",
        path: "/Users/test/DesktopShell.tsx:171",
      },
      { type: "text", content: "。" },
    ]);
  });

  it("ignores non-absolute link targets", () => {
    expect(parseFileReferenceSegments("[docs](https://example.com)")).toEqual([
      { type: "text", content: "[docs](https://example.com)" },
    ]);
  });

  it("leaves Skill references for the Skill parser", () => {
    const reference = "[$pdf](/skills/pdf/SKILL.md)";
    expect(parseFileReferenceSegments(reference)).toEqual([{ type: "text", content: reference }]);
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
  it("presents Kimi thinking and message segments in normalized order", () => {
    const parts = [
      {
        type: "kimi_timeline" as const,
        item: {
          type: "message" as const,
          id: "message-2",
          order: 3,
          content: "Done.",
          isFinal: true,
        },
      },
      {
        type: "kimi_timeline" as const,
        item: {
          type: "thinking" as const,
          id: "thinking-1",
          order: 0,
          content: "Inspect files",
          status: "completed" as const,
        },
      },
      { type: "text" as const, content: "I found it.Done." },
      {
        type: "shell" as const,
        id: "shell-1",
        command: "pwd",
        output: "/tmp",
        status: "completed" as const,
      },
      {
        type: "kimi_timeline" as const,
        item: {
          type: "thinking" as const,
          id: "thinking-2",
          order: 2,
          content: "Verify",
          status: "running" as const,
        },
      },
      {
        type: "kimi_timeline" as const,
        item: {
          type: "message" as const,
          id: "message-1",
          order: 1,
          content: "I found it.",
          isFinal: false,
        },
      },
    ];

    expect(getAssistantMessagePresentation(parts, "completed")).toEqual({
      activityItems: [
        {
          type: "kimi-thinking",
          id: "thinking-1",
          content: "Inspect files",
          status: "completed",
        },
        { type: "commentary", id: "message-1", content: "I found it." },
        parts[3],
        {
          type: "kimi-thinking",
          id: "thinking-2",
          content: "Verify",
          status: "running",
        },
      ],
      answerText: "Done.",
      postAnswerActivityItems: [],
    });
  });

  it("uses explicit Kimi final markers even when later activity exists", () => {
    const finalMessage = {
      type: "kimi_timeline" as const,
      item: {
        type: "message" as const,
        id: "message-final",
        order: 1,
        content: "Final answer",
        isFinal: true,
      },
    };
    const tool = {
      type: "kimi_timeline" as const,
      item: {
        type: "tool" as const,
        id: "tool-late",
        order: 2,
        toolCallId: "tool-late",
        title: "Read",
        kind: "read",
        command: "",
        filePath: "src/a.ts",
        input: "",
        output: "done",
        error: "",
        status: "completed" as const,
      },
    };
    const intermediate = {
      type: "kimi_timeline" as const,
      item: {
        type: "message" as const,
        id: "message-intermediate",
        order: 0,
        content: "Checking first",
        isFinal: false,
      },
    };
    const lateThinking = {
      type: "kimi_timeline" as const,
      item: {
        type: "thinking" as const,
        id: "thinking-late",
        order: 3,
        content: "Check the result",
        status: "completed" as const,
      },
    };

    expect(
      getAssistantMessagePresentation([finalMessage, tool, lateThinking, intermediate], "completed"),
    ).toEqual({
      activityItems: [
        { type: "commentary", id: "message-intermediate", content: "Checking first" },
        {
          type: "kimi-thinking",
          id: "thinking-late",
          content: "Check the result",
          status: "completed",
        },
      ],
      answerText: "Final answer",
      postAnswerActivityItems: [
        {
          type: "kimi-tool",
          id: "tool-late",
          title: "Read",
          kind: "read",
          command: "",
          filePath: "src/a.ts",
          input: "",
          output: "done",
          error: "",
          status: "completed",
        },
      ],
    });
  });

  it("presents Kimi tool items in normalized order alongside thinking and message segments", () => {
    const parts = [
      {
        type: "kimi_timeline" as const,
        item: {
          type: "thinking" as const,
          id: "thinking-1",
          order: 0,
          content: "Inspect the project",
          status: "completed" as const,
        },
      },
      {
        type: "kimi_timeline" as const,
        item: {
          type: "tool" as const,
          id: "tool-item-1",
          order: 1,
          toolCallId: "tool-shell",
          title: "Bash",
          kind: "execute",
          command: "git status",
          filePath: "",
          input: "",
          output: "clean",
          error: "",
          status: "completed" as const,
        },
      },
      {
        type: "kimi_timeline" as const,
        item: {
          type: "tool" as const,
          id: "tool-item-2",
          order: 2,
          toolCallId: "tool-failed",
          title: "Read",
          kind: "read",
          command: "",
          filePath: "src/missing.ts",
          input: "",
          output: "",
          error: "no such file",
          status: "failed" as const,
        },
      },
      {
        type: "kimi_timeline" as const,
        item: {
          type: "message" as const,
          id: "message-1",
          order: 3,
          content: "Done.",
          isFinal: true,
        },
      },
    ];

    expect(getAssistantMessagePresentation(parts, "completed")).toEqual({
      activityItems: [
        {
          type: "kimi-thinking",
          id: "thinking-1",
          content: "Inspect the project",
          status: "completed",
        },
        {
          type: "kimi-tool",
          id: "tool-item-1",
          title: "Bash",
          kind: "execute",
          command: "git status",
          filePath: "",
          input: "",
          output: "clean",
          error: "",
          status: "completed",
        },
        {
          type: "kimi-tool",
          id: "tool-item-2",
          title: "Read",
          kind: "read",
          command: "",
          filePath: "src/missing.ts",
          input: "",
          output: "",
          error: "no such file",
          status: "failed",
        },
      ],
      answerText: "Done.",
      postAnswerActivityItems: [],
    });
  });

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
      postAnswerActivityItems: [],
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
      postAnswerActivityItems: [],
    });
  });

  it("treats a tool-free completed response as the final answer", () => {
    expect(
      getAssistantMessagePresentation([{ type: "text", content: "Direct answer" }], "completed"),
    ).toEqual({ activityItems: [], answerText: "Direct answer", postAnswerActivityItems: [] });
  });

  it("ignores Subagent Task parts without changing Thinking or final-answer order", () => {
    const parts = [
      {
        type: "reasoning" as const,
        id: "kimi-tool-0:tool_agent",
        content: "Launching coder agent: Implement persistence",
        status: "completed" as const,
      },
      {
        type: "subagent_task" as const,
        id: "0:tool_agent",
        runtimeId: "kimi" as const,
        source: "agent" as const,
        agentType: "coder",
        description: "Implement persistence",
        prompt: "delegated prompt",
        background: false,
        status: "completed" as const,
        summary: "delegated summary",
        startedAt: 1000,
        finishedAt: 2000,
      },
      { type: "text" as const, content: "The project is ready." },
    ];

    expect(getAssistantMessagePresentation(parts, "completed")).toEqual({
      activityItems: [parts[0]],
      answerText: "The project is ready.",
      postAnswerActivityItems: [],
    });
  });

  it("ignores error parts without changing activity or answer output", () => {
    const parts = [
      {
        type: "shell" as const,
        id: "shell-1",
        command: "pwd",
        output: "/tmp",
        status: "completed" as const,
      },
      { type: "text" as const, content: "Partial answer" },
      {
        type: "error" as const,
        id: "error-1",
        message: "Kimi Code declined the request (provider refusal).",
      },
    ];

    expect(getAssistantMessagePresentation(parts, "failed")).toEqual({
      activityItems: [parts[0]],
      answerText: "Partial answer",
      postAnswerActivityItems: [],
    });
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

describe("ErrorBlock", () => {
  it("renders the error message in a danger-styled card", () => {
    const markup = renderToStaticMarkup(
      createElement(ErrorBlock, {
        part: {
          type: "error",
          id: "error-1",
          message: "Kimi Code declined the request (provider refusal).",
        },
      }),
    );

    expect(markup).toContain("Kimi Code declined the request (provider refusal).");
    expect(markup).toContain("text-danger");
  });

  it("offers explicit Runtime Session removal and retry for resume failures", () => {
    const markup = renderToStaticMarkup(
      createElement(ErrorBlock, {
        part: {
          type: "error",
          id: "error-1",
          message: "Kimi Code could not resume the Runtime Session.",
          runtimeSessionRecovery: {
            runtimeId: "kimi",
            threadId: "thread-1",
            userMessageId: "message-1",
          },
        },
        onRemoveRuntimeSessionAndRetry: () => {},
      }),
    );

    expect(markup).toContain("Remove Runtime Session and retry");
  });
});
