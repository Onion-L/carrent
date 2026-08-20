import { describe, expect, it } from "bun:test";

import "../../test/registerHappyDom";

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  AgentActivityBlock,
  AgentActivityList,
  formatAgentActivityDuration,
  getInitialAgentActivityBlockExpanded,
  getBlockStatusMeta,
  getBlockTitle,
  inferAgentActivityStatus,
} from "./AgentActivityBlock";
import type { MessagePart } from "../../../shared/threadContent";
import type { AgentToolItem, AgentThinkingItem } from "./AgentActivityBlock";

type ReasoningPart = Extract<MessagePart, { type: "reasoning" }>;
type ShellPart = Extract<MessagePart, { type: "shell" }>;

function makeReasoning(overrides: Partial<ReasoningPart> & { id: string }): ReasoningPart {
  return {
    type: "reasoning",
    content: "Thinking",
    status: "completed",
    ...overrides,
  };
}

function makeShell(overrides: Partial<ShellPart> & { id: string }): ShellPart {
  return {
    type: "shell",
    command: "echo hello",
    output: "hello",
    status: "completed",
    ...overrides,
  };
}

function makeAgentTool(overrides: Partial<AgentToolItem> & { id: string }): AgentToolItem {
  return {
    type: "agent-tool",
    title: "Read",
    kind: "read",
    command: "",
    filePath: "src/a.ts",
    input: "",
    output: "",
    error: "",
    status: "completed",
    ...overrides,
  };
}

function makeAgentThinking(
  overrides: Partial<AgentThinkingItem> & { id: string },
): AgentThinkingItem {
  return {
    type: "agent-thinking",
    content: "Thinking",
    status: "running",
    ...overrides,
  };
}

describe("AgentActivityBlock expansion", () => {
  it("expands a Agent Thinking item on demand", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(AgentActivityList, {
          items: [
            {
              type: "agent-thinking",
              id: "thinking-1",
              content: "Inspect hidden details",
              status: "running",
            },
          ],
        }),
      );
    });
    const thinkingButton = container.querySelector("button")!;
    expect(thinkingButton.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Inspect hidden details");

    await act(async () => thinkingButton.click());

    expect(thinkingButton.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Inspect hidden details");
    expect(container.querySelector(".border-l")).toBe(null);
    await act(async () => root.unmount());
    container.remove();
  });

  it("expands a reasoning item on demand", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(AgentActivityList, {
          items: [makeReasoning({ id: "reasoning-1", content: "Inspect hidden details" })],
        }),
      );
    });

    const thinkingButton = container.querySelector("button")!;
    expect(thinkingButton.textContent).toContain("Thought");
    expect(thinkingButton.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("Inspect hidden details");

    await act(async () => thinkingButton.click());

    expect(thinkingButton.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("Inspect hidden details");
    await act(async () => root.unmount());
    container.remove();
  });

  it("starts expanded while thinking before the final answer starts", () => {
    expect(
      getInitialAgentActivityBlockExpanded({
        status: "running",
        hasFinalAnswerStarted: false,
      }),
    ).toBe(true);
  });

  it("starts collapsed after the final answer starts", () => {
    expect(
      getInitialAgentActivityBlockExpanded({
        status: "running",
        hasFinalAnswerStarted: true,
      }),
    ).toBe(false);
  });

  it("starts collapsed after thinking settles", () => {
    expect(
      getInitialAgentActivityBlockExpanded({
        status: "completed",
        hasFinalAnswerStarted: false,
      }),
    ).toBe(false);
  });

  it("renders completed activity as a ruled title row", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(AgentActivityBlock, {
          status: "completed",
          duration: "4m 8s",
          items: [makeReasoning({ id: "r1" })],
        }),
      );
    });

    const header = container.querySelector("button")!;
    expect(header.className).toContain("border-b border-border");
    expect(header.textContent).toBe("Completed 4m 8s");
    expect(header.querySelectorAll("svg")).toHaveLength(1);
    expect(header.getAttribute("aria-expanded")).toBe("false");

    await act(async () => root.unmount());
    container.remove();
  });
});

describe("AgentActivityBlock status", () => {
  it("infers running when any step is running", () => {
    expect(
      inferAgentActivityStatus([
        makeReasoning({ id: "r1", status: "running" }),
        makeShell({ id: "s1" }),
      ]),
    ).toBe("running");
  });

  it("infers failed when a shell step failed", () => {
    expect(
      inferAgentActivityStatus([
        makeReasoning({ id: "r1" }),
        makeShell({ id: "s1", status: "failed" }),
      ]),
    ).toBe("failed");
  });

  it("infers failed when a Agent tool step failed", () => {
    expect(
      inferAgentActivityStatus([
        makeAgentThinking({ id: "t1", status: "completed" }),
        makeAgentTool({ id: "tool-1", status: "failed", error: "boom" }),
      ]),
    ).toBe("failed");
  });

  it("infers running when a Agent tool step is pending", () => {
    expect(
      inferAgentActivityStatus([
        makeAgentThinking({ id: "t1", status: "completed" }),
        makeAgentTool({ id: "tool-1", status: "pending" }),
      ]),
    ).toBe("running");
  });

  it("infers completed when a Agent tool step is completed", () => {
    expect(
      inferAgentActivityStatus([
        makeAgentThinking({ id: "t1", status: "completed" }),
        makeAgentTool({ id: "tool-1", status: "completed" }),
      ]),
    ).toBe("completed");
  });

  it("infers cancelled when a Agent tool step is cancelled", () => {
    expect(inferAgentActivityStatus([makeAgentTool({ id: "tool-1", status: "cancelled" })])).toBe(
      "cancelled",
    );
  });

  it("uses simple user-facing status labels", () => {
    expect(getBlockStatusMeta([], "running").label).toBe("Processing");
    expect(getBlockStatusMeta([], "completed").label).toBe("Completed");
    expect(getBlockStatusMeta([], "failed").label).toBe("Failed");
    expect(getBlockStatusMeta([], "cancelled").label).toBe("Cancelled");
  });
});

describe("AgentActivityBlock title", () => {
  it("shows status and duration without a step count", () => {
    expect(getBlockTitle({ status: "running", duration: "12s" })).toBe("Processing · 12s");
    expect(getBlockTitle({ status: "completed", duration: "1m 24s" })).toBe("Completed · 1m 24s");
  });

  it("omits duration when no timing data is available", () => {
    expect(getBlockTitle({ status: "completed" })).toBe("Completed");
  });
});

describe("AgentActivityBlock duration formatting", () => {
  it("formats seconds", () => {
    expect(formatAgentActivityDuration(12_900)).toBe("12s");
  });

  it("formats minutes and seconds", () => {
    expect(formatAgentActivityDuration(68_000)).toBe("1m 08s");
  });

  it("formats hours, minutes, and seconds", () => {
    expect(formatAgentActivityDuration(7_392_000)).toBe("2h 03m 12s");
  });

  it("formats days, hours, minutes, and seconds", () => {
    expect(formatAgentActivityDuration(101_103_000)).toBe("1d 04h 05m 03s");
  });
});

describe("AgentActivityBlock Agent tool item", () => {
  async function renderItems(items: Parameters<typeof AgentActivityBlock>[0]["items"]) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    // A running block with no final answer starts expanded, so the tool item
    // is visible without first clicking the outer activity block header.
    await act(async () => {
      root.render(createElement(AgentActivityBlock, { status: "running", items }));
    });
    return {
      container,
      root,
      toolButton: () => container.querySelectorAll("button")[1],
      async cleanup() {
        await act(async () => root.unmount());
        container.remove();
      },
    };
  }

  it("renders a generic tool label and reveals output on demand", async () => {
    const { container, toolButton, cleanup } = await renderItems([
      makeAgentTool({
        id: "tool-read",
        title: "Read",
        kind: "read",
        filePath: "src/a.ts",
        output: "file contents",
        status: "completed",
      }),
    ]);

    expect(container.textContent).toContain("Read src/a.ts");
    expect(container.textContent).not.toContain("file contents");

    await act(async () => toolButton().click());
    expect(container.textContent).toContain("Output");
    expect(container.textContent).toContain("file contents");
    await cleanup();
  });

  it("renders a shell tool command with the $ prefix and reveals the error", async () => {
    const { container, toolButton, cleanup } = await renderItems([
      makeAgentTool({
        id: "tool-bash",
        title: "Bash",
        kind: "execute",
        command: "git status",
        filePath: "",
        output: "permission denied",
        error: "permission denied",
        status: "failed",
      }),
    ]);

    expect(container.textContent).toContain("$");
    expect(container.textContent).toContain("git status");
    expect(container.textContent).not.toContain("permission denied");

    await act(async () => toolButton().click());
    expect(container.textContent).toContain("permission denied");
    await cleanup();
  });

  it("reveals tool input when no output is available", async () => {
    const { container, toolButton, cleanup } = await renderItems([
      makeAgentTool({
        id: "tool-edit",
        title: "Edit",
        kind: "edit",
        filePath: "src/a.ts",
        input: '{"path":"src/a.ts","replacement":"updated"}',
        status: "completed",
      }),
    ]);

    expect(container.textContent).toContain("Edit src/a.ts");
    expect(container.textContent).not.toContain('"replacement":"updated"');

    await act(async () => toolButton().click());
    expect(container.textContent).toContain('"replacement":"updated"');
    await cleanup();
  });
});
