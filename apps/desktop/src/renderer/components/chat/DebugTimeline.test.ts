import { describe, expect, it } from "bun:test";

import { buildDebugTurns } from "./DebugTimeline";
import type { Message } from "../../../shared/threadContent";

const base = { threadId: "thread-1", timestamp: "2026-08-14T00:00:00Z" };

describe("buildDebugTurns", () => {
  it("groups messages by user turn and maps parts to badge rows", () => {
    const messages: Message[] = [
      { ...base, id: "u1", role: "user", content: "hi" },
      {
        ...base,
        id: "a1",
        role: "assistant",
        content: "",
        parts: [
          { type: "text", content: "hello" },
          {
            type: "kimi_timeline",
            item: {
              type: "tool",
              id: "item-1",
              order: 0,
              toolCallId: "call-1",
              title: "bash",
              kind: "bash",
              command: "",
              filePath: "",
              input: '{"command":"ls"}',
              output: "ok",
              error: "",
              status: "completed",
            },
          },
        ],
      },
      { ...base, id: "u2", role: "user", content: "again" },
    ];

    const turns = buildDebugTurns(messages);

    expect(turns.map((turn) => turn.index)).toEqual([1, 2]);
    expect(turns[0]?.rows.map((row) => row.badge)).toEqual(["USER", "ASSISTANT", "TOOL"]);
    expect(turns[1]?.rows.map((row) => row.badge)).toEqual(["USER"]);
    expect(turns[0]?.rows[2]?.summary).toContain('bash {"command":"ls"}');
    expect(turns[0]?.rows[2]?.summary).toContain("→ ok");
  });

  it("renders local path contexts as CONTEXT rows", () => {
    const messages: Message[] = [
      {
        ...base,
        id: "u1",
        role: "user",
        content: "看看这个",
        localPathContexts: [{ path: "/tmp/demo.ts", basename: "demo.ts", kind: "file" }],
      },
    ];

    const turns = buildDebugTurns(messages);

    expect(turns[0]?.rows.map((row) => row.badge)).toEqual(["USER", "CONTEXT"]);
    expect(turns[0]?.rows[1]?.summary).toBe("file: /tmp/demo.ts");
  });

  it("accumulates assistant run duration per turn", () => {
    const messages: Message[] = [
      { ...base, id: "u1", role: "user", content: "hi" },
      {
        ...base,
        id: "a1",
        role: "assistant",
        content: "done",
        createdAt: 1000,
        runFinishedAt: 4000,
      },
    ];

    const turns = buildDebugTurns(messages);

    expect(turns[0]?.durationMs).toBe(3000);
  });

  it("marks failed tool calls as ERROR rows", () => {
    const messages: Message[] = [
      {
        ...base,
        id: "a1",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "shell",
            id: "shell-1",
            command: "exit 1",
            output: "",
            status: "failed",
            exitCode: 1,
          },
        ],
      },
    ];

    const turns = buildDebugTurns(messages);

    expect(turns[0]?.rows[0]?.badge).toBe("ERROR");
  });

  it("keeps the raw tool input and output untruncated in payload/result", () => {
    const longInput = JSON.stringify({ content: "x".repeat(500) });
    const messages: Message[] = [
      {
        ...base,
        id: "a1",
        role: "assistant",
        content: "",
        parts: [
          {
            type: "kimi_timeline",
            item: {
              type: "tool",
              id: "item-1",
              order: 0,
              toolCallId: "call-1",
              title: "write",
              kind: "write",
              command: "",
              filePath: "",
              input: longInput,
              output: "line1\nline2",
              error: "",
              status: "completed",
            },
          },
        ],
      },
    ];

    const row = buildDebugTurns(messages)[0]?.rows[0];

    const raw = row?.raw as { type: string; input: string } | undefined;

    expect(row?.summary.length).toBeLessThan(200);
    expect(row?.payload).toBe(longInput);
    expect(row?.result).toBe("line1\nline2");
    expect(raw?.type).toBe("tool");
    expect(raw?.input).toBe(longInput);
  });
});
