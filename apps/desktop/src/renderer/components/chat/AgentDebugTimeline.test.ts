import { describe, expect, it } from "bun:test";

import type { AgentDebugRecord } from "../../../shared/agentDebug";
import {
  buildAgentDebugConversationRows,
  buildAgentDebugRawRows,
  toStructuredJson,
} from "./AgentDebugTimeline";

function record(sequence: number, type: string, raw: Record<string, unknown>): AgentDebugRecord {
  return { sequence, type, raw: { type, ...raw }, runId: "run-1", time: sequence };
}

describe("Agent Debug timeline", () => {
  it("maps Core context, messages, tools, approvals and completion", () => {
    const rows = buildAgentDebugConversationRows([
      record(1, "core.context", {
        systemPrompt: "You are Carrent.",
        model: { providerType: "anthropic", modelId: "claude-test" },
        messages: [],
        tools: [{ name: "read" }],
      }),
      record(2, "message_end", { message: { role: "user", content: "Read package.json" } }),
      record(3, "tool_execution_start", {
        toolCallId: "tool-1",
        toolName: "read",
        args: { path: "package.json" },
      }),
      record(4, "approval.requested", { request: { toolName: "bash", command: "bun test" } }),
      record(5, "tool_execution_end", {
        toolCallId: "tool-1",
        toolName: "read",
        result: { content: [{ type: "text", text: "{}" }] },
        isError: false,
      }),
      record(6, "run.completed", { text: "Done" }),
    ]);

    expect(rows.map((row) => row.badge)).toEqual([
      "SYSTEM",
      "LLM",
      "USER",
      "TOOL CALL",
      "APPROVAL",
      "TOOL RESULT",
      "ASSISTANT",
    ]);
    expect(rows.at(-1)).toMatchObject({ title: "Final response", final: true, output: "Done" });
  });

  it("keeps every Core record in Raw view", () => {
    const records = [record(1, "agent_start", {}), record(2, "message_update", { delta: "a" })];
    expect(buildAgentDebugRawRows(records).map((row) => row.title)).toEqual([
      "agent_start",
      "message_update",
    ]);
  });

  it("parses structured JSON strings and rejects plain text", () => {
    expect(toStructuredJson('{"name":"read"}')).toEqual({ ok: true, value: { name: "read" } });
    expect(toStructuredJson("plain text")).toEqual({ ok: false });
  });
});
