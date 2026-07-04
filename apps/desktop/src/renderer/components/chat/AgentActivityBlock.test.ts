import { describe, expect, it } from "bun:test";
import { getInitialAgentActivityBlockExpanded, getBlockStatusMeta } from "./AgentActivityBlock";
import type { MessagePart } from "../../mock/uiShellData";

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

describe("AgentActivityBlock", () => {
  it("is collapsed by default", () => {
    expect(getInitialAgentActivityBlockExpanded()).toBe(false);
  });
});

describe("AgentActivityBlock status labels", () => {
  it("shows completed steps label", () => {
    const status = getBlockStatusMeta([makeReasoning({ id: "r1" }), makeShell({ id: "s1" })]);
    expect(status.label).toBe("2 steps");
  });

  it("shows running label when any step is running", () => {
    const status = getBlockStatusMeta([
      makeReasoning({ id: "r1", status: "running" }),
      makeShell({ id: "s1", status: "completed" }),
    ]);
    expect(status.label).toBe("Running 2 steps");
  });

  it("shows failed label when any shell failed", () => {
    const status = getBlockStatusMeta([
      makeReasoning({ id: "r1" }),
      makeShell({ id: "s1", status: "failed" }),
      makeShell({ id: "s2", status: "running" }),
    ]);
    expect(status.label).toBe("3 steps failed");
  });

  it("counts reasoning and shell steps together", () => {
    const status = getBlockStatusMeta([
      makeReasoning({ id: "r1" }),
      makeReasoning({ id: "r2" }),
      makeShell({ id: "s1" }),
      makeShell({ id: "s2" }),
    ]);
    expect(status.label).toBe("4 steps");
  });
});
