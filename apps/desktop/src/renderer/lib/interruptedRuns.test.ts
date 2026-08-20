import { describe, it, expect } from "bun:test";
import { reconcileInterruptedRuns } from "./interruptedRuns";
import type { Message } from "../../shared/threadContent";

type TextMessage = Extract<Message, { type?: "text" }>;

function makeMessage(overrides: Partial<TextMessage> = {}): TextMessage {
  return {
    id: "m1",
    role: "assistant",
    type: "text",
    content: "",
    timestamp: "10:00",
    threadId: "t1",
    ...overrides,
  };
}

describe("reconcileInterruptedRuns", () => {
  it("marks persisted running messages as cancelled", () => {
    const [result] = reconcileInterruptedRuns([
      makeMessage({
        runStatus: "running",
        parts: [
          { type: "reasoning", id: "r1", content: "thinking", status: "running" },
          { type: "shell", id: "s1", command: "ls", output: "", status: "running" },
          { type: "text", content: "partial" },
        ],
      }),
    ]) as TextMessage[];

    expect(result.runStatus).toBe("cancelled");
    expect(typeof result.runFinishedAt).toBe("number");
    expect(result.parts).toEqual([
      { type: "reasoning", id: "r1", content: "thinking", status: "cancelled" },
      { type: "shell", id: "s1", command: "ls", output: "", status: "cancelled" },
      { type: "text", content: "partial" },
    ]);
  });

  it("keeps an existing runFinishedAt", () => {
    const [result] = reconcileInterruptedRuns([
      makeMessage({ runStatus: "running", runFinishedAt: 123 }),
    ]);

    expect(result.runFinishedAt).toBe(123);
  });

  it("leaves finished messages untouched", () => {
    const message = makeMessage({
      runStatus: "completed",
      parts: [{ type: "reasoning", id: "r1", content: "done", status: "completed" }],
    });

    expect(reconcileInterruptedRuns([message])).toEqual([message]);
  });

  it("cancels running parts on terminal messages from stopped or failed runs", () => {
    const [cancelledResult, failedResult] = reconcileInterruptedRuns([
      makeMessage({
        runStatus: "cancelled",
        runFinishedAt: 100,
        parts: [
          { type: "reasoning", id: "r1", content: "thinking", status: "running" },
          { type: "shell", id: "s1", command: "ls", output: "", status: "completed" },
        ],
      }),
      makeMessage({
        id: "m2",
        runStatus: "failed",
        parts: [{ type: "shell", id: "s2", command: "pwd", output: "", status: "running" }],
      }),
    ]) as TextMessage[];

    expect(cancelledResult.runStatus).toBe("cancelled");
    expect(cancelledResult.runFinishedAt).toBe(100);
    expect(cancelledResult.parts).toEqual([
      { type: "reasoning", id: "r1", content: "thinking", status: "cancelled" },
      { type: "shell", id: "s1", command: "ls", output: "", status: "completed" },
    ]);
    expect(failedResult.parts).toEqual([
      { type: "shell", id: "s2", command: "pwd", output: "", status: "cancelled" },
    ]);
  });

  it("cancels persisted Agent Thinking and tools during hydration", () => {
    const [result] = reconcileInterruptedRuns([
      makeMessage({
        runStatus: "failed",
        parts: [
          {
            type: "agent_activity",
            item: {
              type: "thinking",
              id: "run-1-thinking-1",
              order: 0,
              content: "Inspect",
              status: "running",
            },
          },
          {
            type: "agent_activity",
            item: {
              type: "tool",
              id: "run-1-tool-1",
              order: 1,
              toolCallId: "tool-1",
              title: "Read",
              kind: "read",
              command: "",
              filePath: "src/a.ts",
              input: "",
              output: "partial output",
              error: "transport closed",
              status: "running",
            },
          },
          {
            type: "agent_activity",
            item: {
              type: "tool",
              id: "run-1-tool-2",
              order: 2,
              toolCallId: "tool-2",
              title: "Write",
              kind: "edit",
              command: "",
              filePath: "src/b.ts",
              input: "",
              output: "",
              error: "write failed",
              status: "failed",
            },
          },
        ],
      }),
    ]) as TextMessage[];

    expect(result.parts).toMatchObject([
      { item: { id: "run-1-thinking-1", order: 0, status: "cancelled" } },
      {
        item: {
          id: "run-1-tool-1",
          order: 1,
          output: "partial output",
          error: "transport closed",
          status: "cancelled",
        },
      },
      { item: { id: "run-1-tool-2", order: 2, error: "write failed", status: "failed" } },
    ]);
  });

  it("interrupts pending Run interactions while preserving produced history", () => {
    const [result] = reconcileInterruptedRuns([
      makeMessage({
        runStatus: "running",
        content: "Partial answer",
        parts: [
          { type: "text", content: "Partial answer" },
          {
            type: "question",
            id: "question-part-1",
            questionId: "question-1",
            status: "pending",
            questions: [{ header: "Scope", question: "Continue?" }],
          },
          {
            type: "subagent_task",
            id: "task-1",
            providerProfileId: "default",
            source: "agent",
            description: "Inspect the lifecycle",
            background: false,
            status: "running",
            startedAt: 100,
          },
        ],
      }),
    ]) as TextMessage[];

    expect(result).toMatchObject({
      runStatus: "cancelled",
      content: "Partial answer",
      parts: [
        { type: "text", content: "Partial answer" },
        { type: "question", status: "interrupted" },
        { type: "subagent_task", status: "interrupted" },
      ],
    });
  });
});
