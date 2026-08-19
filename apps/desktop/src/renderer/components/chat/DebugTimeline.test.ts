import { describe, expect, it } from "bun:test";

import {
  addPersistedConversationRows,
  buildDebugConversationRows,
  buildDebugRawRows,
  type DebugRow,
} from "./DebugTimeline";
import type { RuntimeDebugRecord } from "../../../shared/runtimeDebug";
import type { Message } from "../../../shared/threadContent";

function record(sequence: number, type: string, raw: Record<string, unknown>): RuntimeDebugRecord {
  return { sequence, type, raw: { type, ...raw } };
}

describe("Runtime Debug conversation", () => {
  it("maps system, human, AI, tool input/output and final response in wire order", () => {
    const rows = buildDebugConversationRows([
      record(1, "profile.bind", {
        systemPrompt: "You are Kimi.",
        modelAlias: "kimi-code/k3",
      }),
      record(2, "context.append_message", {
        message: {
          role: "user",
          origin: { kind: "user" },
          content: [{ type: "text", text: "List files" }],
        },
      }),
      record(3, "llm.request", {
        turnStep: "0.1",
        model: "k3",
        messageCount: 2,
      }),
      record(4, "context.append_loop_event", {
        event: {
          type: "content.part",
          step: 1,
          part: { type: "think", think: "I should inspect the project." },
        },
      }),
      record(5, "context.append_loop_event", {
        event: {
          type: "tool.call",
          step: 1,
          toolCallId: "tool-1",
          name: "Bash",
          args: { command: "ls -la" },
        },
      }),
      record(6, "context.append_loop_event", {
        event: {
          type: "tool.result",
          toolCallId: "tool-1",
          result: { output: "package.json\n", isError: false },
        },
      }),
      record(7, "context.append_loop_event", {
        event: {
          type: "content.part",
          step: 2,
          part: { type: "text", text: "The project contains package.json." },
        },
      }),
      record(8, "context.append_loop_event", {
        event: { type: "step.end", step: 2, finishReason: "end_turn" },
      }),
    ]);

    expect(rows.map(({ badge }) => badge)).toEqual([
      "SYSTEM",
      "USER",
      "LLM",
      "THOUGHT",
      "TOOL CALL",
      "TOOL RESULT",
      "ASSISTANT",
      "STEP",
    ]);
    expect(rows.find((row) => row.badge === "SYSTEM")?.input).toBe("You are Kimi.");
    expect(rows.find((row) => row.badge === "USER")?.input).toBe("List files");
    expect(rows.find((row) => row.badge === "TOOL CALL")?.input).toEqual({
      command: "ls -la",
    });
    expect(rows.find((row) => row.badge === "TOOL RESULT")?.output).toEqual({
      output: "package.json\n",
      isError: false,
    });
    expect(rows.find((row) => row.badge === "TOOL RESULT")?.title).toBe("Bash result");
    expect(rows.find((row) => row.badge === "LLM")?.input).toEqual({
      turnStep: "0.1",
      model: "k3",
      messageCount: 2,
    });
    expect(rows.find((row) => row.badge === "ASSISTANT")).toMatchObject({
      title: "Final response",
      output: "The project contains package.json.",
      final: true,
    });
  });

  it("distinguishes runtime injections from human messages", () => {
    const rows = buildDebugConversationRows([
      record(1, "context.append_message", {
        message: {
          role: "user",
          origin: { kind: "injection", variant: "permission_mode" },
          content: [{ type: "text", text: "Approval mode active" }],
        },
      }),
    ]);

    expect(rows[0]).toMatchObject({
      badge: "CONTEXT",
      title: "permission_mode",
      input: "Approval mode active",
    });
  });

  it("keeps explicit system and tool context messages in their own roles", () => {
    const rows = buildDebugConversationRows([
      record(1, "context.append_message", {
        message: { role: "system", content: "System override" },
      }),
      record(2, "context.append_message", {
        message: { role: "tool", name: "Bash", content: "command output" },
      }),
    ]);

    expect(rows[0]).toMatchObject({
      badge: "SYSTEM",
      title: "System message",
      input: "System override",
    });
    expect(rows[1]).toMatchObject({
      badge: "TOOL RESULT",
      title: "Bash message",
      output: "command output",
    });
  });

  it("keeps failed tool results visibly failed", () => {
    const rows = buildDebugConversationRows([
      record(1, "context.append_loop_event", {
        event: {
          type: "tool.result",
          toolCallId: "tool-1",
          result: { output: "command not found", isError: true },
        },
      }),
    ]);

    expect(rows[0]).toMatchObject({ badge: "ERROR", title: "Tool failed" });
  });

  it("inherits tool result metadata from the matching call", () => {
    const rows = buildDebugConversationRows([
      record(1, "context.append_loop_event", {
        event: {
          type: "tool.call",
          toolCallId: "tool-1",
          name: "Bash",
          step: 2,
          turnId: "turn-1",
          args: { command: "pwd" },
        },
      }),
      record(2, "context.append_loop_event", {
        event: {
          type: "tool.result",
          toolCallId: "tool-1",
          result: { output: "/tmp" },
        },
      }),
    ]);

    expect(rows[1]).toMatchObject({
      title: "Bash result",
      step: 2,
      turnId: "turn-1",
    });
  });

  it("shows the full LLM tool snapshot as request input", () => {
    const tools = [{ name: "Bash", description: "Run a command" }];
    const rows = buildDebugConversationRows([
      record(1, "llm.tools_snapshot", { tools, toolsHash: "hash-1" }),
    ]);

    expect(rows[0]).toMatchObject({
      badge: "LLM",
      title: "Tool definitions",
      summary: "1 tool",
      input: { tools, toolsHash: "hash-1" },
    });
  });

  it("supplements a final persisted assistant message missing from the wire", () => {
    const wireRows = buildDebugConversationRows([
      record(1, "context.append_message", {
        message: { role: "user", content: "List files\n\nRuntime context" },
      }),
      record(2, "context.append_loop_event", {
        event: {
          type: "content.part",
          step: 1,
          part: { type: "text", text: "I will inspect it." },
        },
      }),
    ]);
    const messages = [
      {
        id: "user-1",
        role: "user",
        threadId: "thread-1",
        timestamp: "09:00",
        content: "List files",
      },
      {
        id: "assistant-1",
        role: "assistant",
        threadId: "thread-1",
        timestamp: "09:01",
        content: "The project contains package.json.",
        runStatus: "completed",
      },
    ] as Message[];

    const rows = addPersistedConversationRows(wireRows, messages);

    expect(rows.filter((row) => row.badge === "USER")).toHaveLength(1);
    expect(rows.at(-1)).toMatchObject({
      id: "message:assistant-1",
      badge: "ASSISTANT",
      title: "Final response",
      output: "The project contains package.json.",
      final: true,
      raw: { source: "carrent-message" },
    });
  });
});

describe("Runtime Debug raw events", () => {
  it("keeps every wire record and its full raw payload", () => {
    const records = [
      record(1, "metadata", { protocol_version: 1 }),
      record(2, "llm.tools_snapshot", { tools: [{ name: "Bash", description: "full" }] }),
      record(3, "usage.record", { usage: { inputTokens: 10, outputTokens: 5 } }),
    ];

    const rows = buildDebugRawRows(records);

    expect(rows).toHaveLength(3);
    expect(rows.map((row: DebugRow) => row.title)).toEqual([
      "metadata",
      "llm.tools_snapshot",
      "usage.record",
    ]);
    expect(rows[1]?.raw).toEqual(records[1]?.raw);
  });
});
