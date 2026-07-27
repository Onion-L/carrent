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

  it("interrupts pending Run interactions while preserving produced history", () => {
    const [result] = reconcileInterruptedRuns([
      makeMessage({
        runStatus: "running",
        content: "Partial answer",
        parts: [
          { type: "text", content: "Partial answer" },
          {
            type: "plan_review",
            id: "approval-1",
            permissionId: "permission-1",
            content: "Approve the plan",
            status: "pending",
            options: [],
          },
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
            runtimeId: "kimi",
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
        { type: "plan_review", status: "interrupted" },
        { type: "question", status: "interrupted" },
        { type: "subagent_task", status: "interrupted" },
      ],
    });
  });
});
