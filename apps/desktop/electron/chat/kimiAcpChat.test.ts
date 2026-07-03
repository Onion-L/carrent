import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ChatRunEvent, ChatTurnRequest } from "../../src/shared/chat";
import { buildKimiPromptParts, startKimiAcpChatRun, type KimiAcpTransport } from "./kimiAcpChat";

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    workspace: {
      kind: "project",
      projectId: "carrent",
      projectPath: "/Users/onion/workbench/carrent",
    },
    threadId: "thread-1",
    runtimeId: "kimi",
    runtimeMode: "approval-required",
    transcript: [],
    message: "Hello",
    ...overrides,
  };
}

function respondAcp(transport: FakeKimiAcpTransport, request: Record<string, unknown>, result: unknown) {
  transport.emitMessage({ jsonrpc: "2.0", id: request.id, result });
}

class FakeKimiAcpTransport implements KimiAcpTransport {
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly messageListeners: Array<(message: Record<string, unknown>) => void> = [];

  constructor(
    private readonly onSend: (transport: FakeKimiAcpTransport, message: Record<string, unknown>) => void,
  ) {}

  send(message: Record<string, unknown>) {
    this.sent.push(message);
    this.onSend(this, message);
  }

  close() {}

  onMessage(listener: (message: Record<string, unknown>) => void) {
    this.messageListeners.push(listener);
  }

  onError() {}

  onClose() {}

  emitMessage(message: Record<string, unknown>) {
    this.messageListeners.forEach((listener) => listener(message));
  }
}

describe("buildKimiPromptParts", () => {
  it("uses ACP image blocks for image-only messages", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-image-"));
    const imagePath = path.join(dir, "a1.png");
    await writeFile(imagePath, Buffer.from("image bytes"));

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "   ",
        attachments: [
          {
            id: "a1",
            name: "screen.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a1.png",
            localPath: imagePath,
          },
        ],
      }),
    );

    expect(parts).toEqual([
      { type: "text", text: "Inspect the attached images and describe what you see." },
      {
        type: "image",
        data: Buffer.from("image bytes").toString("base64"),
        mimeType: "image/png",
        uri: `file://${imagePath}`,
      },
    ]);
  });
});

describe("startKimiAcpChatRun", () => {
  it("does not install a Carrent-side runtime timeout for session/prompt", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timeoutDelays: unknown[] = [];

    globalThis.setTimeout = (((
      handler: TimerHandler,
      timeout?: number,
      ...args: unknown[]
    ) => {
      const timer = { handler, timeout, args };
      timeoutDelays.push(timeout);
      return timer as unknown as ReturnType<typeof setTimeout>;
    }) as unknown) as typeof setTimeout;
    globalThis.clearTimeout = (() => {}) as typeof clearTimeout;

    try {
      const emitted: ChatRunEvent[] = [];
      const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
        if (message.method === "initialize") {
          respondAcp(fakeTransport, message, { protocolVersion: 1 });
          return;
        }

        if (message.method === "session/new") {
          respondAcp(fakeTransport, message, { sessionId: "session-1" });
          return;
        }

        if (message.method === "session/prompt") {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-1",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "Done" },
              },
            },
          });
          respondAcp(fakeTransport, message, { stopReason: "end_turn" });
        }
      });

      startKimiAcpChatRun({
        runId: "run-kimi-no-prompt-timeout",
        request: makeRequest({ runtimeId: "kimi" }),
        cwd: "/Users/onion/workbench/carrent",
        emit: (event) => emitted.push(event),
        transportFactory: () => transport,
        requestTimeoutMs: 7,
      });

      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }

      expect(timeoutDelays).toEqual([7, 7]);
      expect(transport.sent.map((message) => message.method)).toEqual([
        "initialize",
        "session/new",
        "session/prompt",
      ]);
      expect(emitted.find((event) => event.type === "completed")).toMatchObject({
        text: "Done",
      });
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });
});
