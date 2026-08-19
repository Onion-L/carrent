import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { readKimiDebugTrace } from "./kimiDebugTrace";

async function createWire(records: unknown[]) {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-debug-"));
  const sessionId = "session-debug-1";
  const sessionDir = path.join(homeDir, ".kimi-code", "sessions", "bucket", sessionId);
  const wirePath = path.join(sessionDir, "agents", "main", "wire.jsonl");
  await mkdir(path.dirname(wirePath), { recursive: true });
  await writeFile(
    path.join(homeDir, ".kimi-code", "session_index.jsonl"),
    `${JSON.stringify({ sessionId, sessionDir })}\n`,
  );
  await writeFile(wirePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return { homeDir, sessionId, wirePath };
}

describe("readKimiDebugTrace", () => {
  it("returns ordered raw Kimi wire records without normalizing conversation payloads", async () => {
    const fixture = await createWire([
      {
        type: "profile.bind",
        time: 1,
        systemPrompt: "You are Kimi.",
        activeToolNames: ["Bash"],
      },
      {
        type: "context.append_message",
        time: 2,
        message: { role: "user", content: [{ type: "text", text: "List files" }] },
      },
      {
        type: "context.append_loop_event",
        time: 3,
        event: {
          type: "tool.call",
          toolCallId: "tool-1",
          name: "Bash",
          args: { command: "ls -la" },
        },
      },
      {
        type: "context.append_loop_event",
        time: 4,
        event: {
          type: "tool.result",
          toolCallId: "tool-1",
          result: { output: "package.json\n" },
        },
      },
      {
        type: "context.append_loop_event",
        time: 5,
        event: {
          type: "content.part",
          part: { type: "text", text: "Found package.json" },
        },
      },
      {
        type: "context.append_loop_event",
        time: 6,
        event: { type: "step.end", finishReason: "stop", step: 2 },
      },
    ]);

    const trace = await readKimiDebugTrace({
      sessionId: fixture.sessionId,
      homeDir: fixture.homeDir,
    });

    expect(trace).toMatchObject({
      runtimeId: "kimi",
      sessionId: fixture.sessionId,
      source: "kimi-wire",
      sourcePath: fixture.wirePath,
      truncated: false,
      parseErrorCount: 0,
    });
    expect(typeof trace?.modifiedAt).toBe("number");
    expect(trace?.records.map(({ sequence, type, time }) => ({ sequence, type, time }))).toEqual([
      { sequence: 1, type: "profile.bind", time: 1 },
      { sequence: 2, type: "context.append_message", time: 2 },
      { sequence: 3, type: "context.append_loop_event", time: 3 },
      { sequence: 4, type: "context.append_loop_event", time: 4 },
      { sequence: 5, type: "context.append_loop_event", time: 5 },
      { sequence: 6, type: "context.append_loop_event", time: 6 },
    ]);
    expect(trace?.records[3]?.raw).toEqual({
      type: "context.append_loop_event",
      time: 4,
      event: {
        type: "tool.result",
        toolCallId: "tool-1",
        result: { output: "package.json\n" },
      },
    });
  });

  it("keeps parse failures visible as records", async () => {
    const fixture = await createWire([{ type: "metadata", time: 1 }]);
    await writeFile(fixture.wirePath, '{"type":"metadata","time":1}\nnot-json\n');

    const trace = await readKimiDebugTrace({
      sessionId: fixture.sessionId,
      homeDir: fixture.homeDir,
    });

    expect(trace?.parseErrorCount).toBe(1);
    expect(trace?.records[1]).toMatchObject({
      sequence: 2,
      type: "wire.parse_error",
      raw: { line: 2, value: "not-json" },
    });
  });

  it("returns null when the Runtime Session has no wire log", async () => {
    const homeDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-debug-missing-"));

    expect(await readKimiDebugTrace({ sessionId: "missing", homeDir })).toBeNull();
  });
});
