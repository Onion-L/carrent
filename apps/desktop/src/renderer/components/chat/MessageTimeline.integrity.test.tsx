import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AttachmentMetadata } from "../../../shared/chat";
import type { Message } from "../../../shared/threadContent";
import { MessageTimeline, UserMessageAttachmentList } from "./MessageTimeline";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("historical attachment integrity", () => {
  it("marks each unreadable attachment unavailable without hiding the message content", async () => {
    Object.defineProperty(window, "carrent", {
      configurable: true,
      value: {
        attachments: {
          read: async () => {
            throw new Error("Attachment file is unavailable.");
          },
        },
      },
    });
    const attachments: AttachmentMetadata[] = [
      {
        id: "missing-image",
        kind: "image",
        name: "missing.png",
        mimeType: "image/png",
        size: 10,
        storageKey: "missing.png",
      },
      {
        id: "missing-file",
        kind: "file",
        name: "missing.ts",
        mimeType: "text/plain",
        size: 10,
        storageKey: "missing.ts",
      },
    ];

    await act(async () => {
      root.render(<UserMessageAttachmentList attachments={attachments} />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("missing.ts");
    expect(container.textContent?.match(/文件不可用/gu)).toHaveLength(2);
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("streaming Markdown output integrity", () => {
  it("renders headings, lists, links, emphasis, code and math after batched content updates", async () => {
    const initial = "# Answer\n\nFirst paragraph with **bold** text.";
    const full = [
      "# Answer",
      "",
      "First paragraph with **bold** and *italic* text plus [a link](https://example.com).",
      "",
      "- first item",
      "- second item",
      "",
      "```ts",
      "const answer: number = 42;",
      "```",
      "",
      String.raw`\[ \frac{a}{b} \]`,
    ].join("\n");
    const streaming: Message = {
      id: "assistant-markdown",
      role: "assistant",
      threadId: "thread-1",
      type: "text",
      timestamp: "09:00",
      createdAt: 1000,
      content: initial,
      runStatus: "running",
    };

    await act(async () => {
      root.render(<MessageTimeline messages={[streaming]} threadActions={[]} />);
    });
    expect(container.querySelector("ul")).toBe(null);

    await act(async () => {
      root.render(
        <MessageTimeline
          messages={[{ ...streaming, content: full, runStatus: "completed" }]}
          threadActions={[]}
        />,
      );
    });

    expect(container.querySelector("h1")?.textContent).toBe("Answer");
    expect(container.querySelector("strong")?.textContent).toBe("bold");
    expect(container.querySelector("em")?.textContent).toBe("italic");
    expect(container.querySelector("a")?.getAttribute("href")).toBe("https://example.com");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("pre code")?.textContent).toContain(
      "const answer: number = 42;",
    );
    expect(container.querySelector(".katex-display")).not.toBe(null);
  });
});

describe("Kimi message timeline", () => {
  it("renders ordinary text in ACP order while Thinking stays collapsed", async () => {
    const message: Message = {
      id: "assistant-1",
      role: "assistant",
      threadId: "thread-1",
      timestamp: "09:00",
      content: "",
      runStatus: "running",
      parts: [
        {
          type: "kimi_timeline",
          item: {
            type: "thinking",
            id: "thinking-1",
            order: 0,
            content: "hidden reasoning summary",
            status: "running",
          },
        },
        {
          type: "kimi_timeline",
          item: {
            type: "message",
            id: "message-1",
            order: 1,
            content: "I will inspect the files.",
            isFinal: false,
          },
        },
        {
          type: "kimi_timeline",
          item: {
            type: "message",
            id: "message-2",
            order: 2,
            content: "Inspection complete.",
            isFinal: true,
          },
        },
      ],
    };

    await act(async () => {
      root.render(<MessageTimeline messages={[message]} threadActions={[]} />);
    });

    expect(container.textContent).toContain("Thinking");
    expect(container.textContent).not.toContain("hidden reasoning summary");
    expect(container.textContent).toContain("I will inspect the files.");
    expect(container.textContent).toContain("Inspection complete.");
    expect(container.textContent!.indexOf("I will inspect the files.")).toBeLessThan(
      container.textContent!.indexOf("Inspection complete."),
    );
    expect(container.querySelector("[data-kimi-timeline] .border-l")).toBe(null);
  });

  it("renders a dedicated Subagent row that opens its task", async () => {
    let selectedTaskId: string | null = null;
    const message: Message = {
      id: "assistant-subagent",
      role: "assistant",
      threadId: "thread-1",
      timestamp: "09:00",
      content: "",
      runStatus: "running",
      parts: [
        {
          type: "kimi_timeline",
          item: {
            type: "tool",
            id: "tool-item-agent",
            order: 0,
            toolCallId: "tool-agent",
            title: "Agent",
            kind: "other",
            command: "",
            filePath: "",
            input: "",
            output: "",
            error: "",
            status: "running",
          },
        },
        {
          type: "subagent_task",
          id: "tool-agent",
          runtimeId: "kimi",
          source: "agent",
          agentType: "Explore",
          description: "Explore notification seams",
          background: false,
          status: "running",
          startedAt: 1_000,
        },
      ],
    };

    await act(async () => {
      root.render(
        <MessageTimeline
          messages={[message]}
          threadActions={[]}
          onSelectSubagent={(taskId) => {
            selectedTaskId = taskId;
          }}
        />,
      );
    });

    const subagentButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Explore notification seams"),
    );
    expect(subagentButton?.textContent).toContain("Subagent");
    expect(subagentButton?.textContent).toContain("Explore");
    expect(container.textContent).not.toContain("AgentExplore");

    await act(async () => subagentButton?.click());
    expect(selectedTaskId).toBe("tool-agent");
  });

  it("does not repeat Stopped after a cancelled Kimi timeline", async () => {
    const message: Message = {
      id: "assistant-cancelled",
      role: "assistant",
      threadId: "thread-1",
      timestamp: "09:00",
      content: "",
      runStatus: "cancelled",
      parts: [
        {
          type: "kimi_timeline",
          item: {
            type: "message",
            id: "message-1",
            order: 0,
            content: "Work was interrupted.",
            isFinal: false,
          },
        },
      ],
    };

    await act(async () => {
      root.render(<MessageTimeline messages={[message]} threadActions={[]} />);
    });

    expect(container.textContent).toContain("Cancelled");
    expect(container.textContent).not.toContain("Stopped");
  });
});
