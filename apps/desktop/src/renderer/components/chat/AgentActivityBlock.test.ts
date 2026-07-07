import { describe, expect, it } from "bun:test";
import {
  formatAgentActivityDuration,
  getInitialAgentActivityBlockExpanded,
  getBlockStatusMeta,
  getBlockTitle,
  inferAgentActivityStatus,
} from "./AgentActivityBlock";
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

describe("AgentActivityBlock expansion", () => {
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

  it("uses simple user-facing status labels", () => {
    expect(getBlockStatusMeta([], "running").label).toBe("Thinking");
    expect(getBlockStatusMeta([], "completed").label).toBe("Completed");
    expect(getBlockStatusMeta([], "failed").label).toBe("Failed");
    expect(getBlockStatusMeta([], "cancelled").label).toBe("Cancelled");
  });
});

describe("AgentActivityBlock title", () => {
  it("shows status and duration without a step count", () => {
    expect(getBlockTitle({ status: "running", duration: "12s" })).toBe("Thinking · 12s");
    expect(getBlockTitle({ status: "completed", duration: "1m 24s" })).toBe(
      "Completed · 1m 24s",
    );
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
