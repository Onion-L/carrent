import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { ChatRunEvent, ChatTurnRequest } from "../../src/shared/chat";
import type { CarrentBridgeFactory, CarrentBridgeHandle } from "../bridge/carrentBridge";
import {
  buildKimiPromptParts,
  getKimiSessionStatus,
  startKimiAcpChatRun,
  type KimiAcpTransport,
} from "./kimiAcpChat";

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
    planMode: false,
    transcript: [],
    message: "Hello",
    ...overrides,
  };
}

function respondAcp(
  transport: FakeKimiAcpTransport,
  request: Record<string, unknown>,
  result: unknown,
) {
  transport.emitMessage({ jsonrpc: "2.0", id: request.id, result });
}

function waitForAsyncEvents() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createFakeCarrentBridgeFactory() {
  const handles: Array<CarrentBridgeHandle & { closed: boolean }> = [];
  const factory: CarrentBridgeFactory = async ({ runId }) => {
    const handle: CarrentBridgeHandle & { closed: boolean } = {
      closed: false,
      mcpServer: {
        id: "carrent_bridge",
        name: "carrent_bridge",
        type: "http",
        url: `http://127.0.0.1/${runId}/mcp?token=test`,
        headers: [],
      },
      async close() {
        handle.closed = true;
      },
    };
    handles.push(handle);
    return handle;
  };

  return { factory, handles };
}

class FakeKimiAcpTransport implements KimiAcpTransport {
  readonly sent: Array<Record<string, unknown>> = [];
  private readonly messageListeners: Array<(message: Record<string, unknown>) => void> = [];

  constructor(
    private readonly onSend: (
      transport: FakeKimiAcpTransport,
      message: Record<string, unknown>,
    ) => void,
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
  it("does not inject RTK instructions into Kimi prompts", async () => {
    const parts = await buildKimiPromptParts(makeRequest({ message: "Check git status" }));

    expect(parts).toEqual([{ type: "text", text: "Check git status" }]);
  });

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
            kind: "image" as const,
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

  it("includes bounded transcript text for fresh sessions", async () => {
    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "Follow up",
        transcript: [
          { role: "user" as const, content: "First" },
          { role: "assistant" as const, content: "First answer" },
        ],
      }),
      { includeTranscript: true },
    );

    expect(parts).toHaveLength(1);
    const text = (parts[0] as { text: string }).text;
    expect(text).toContain("Recent conversation:");
    expect(text).toContain("user: First");
    expect(text).toContain("assistant: First answer");
    expect(text).toContain("user: Follow up");
  });

  it("does not duplicate local image paths in text when including transcript", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-image-transcript-"));
    const imagePath = path.join(dir, "a1.png");
    await writeFile(imagePath, Buffer.from("image bytes"));

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "   ",
        transcript: [{ role: "user" as const, content: "Earlier" }],
        attachments: [
          {
            id: "a1",
            kind: "image" as const,
            name: "screen.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a1.png",
            localPath: imagePath,
          },
        ],
      }),
      { includeTranscript: true },
    );

    expect(parts).toHaveLength(2);
    const text = (parts[0] as { text: string }).text;
    expect(text).toContain("user: Earlier");
    expect(text).not.toContain("Attached images:");
    expect(text).not.toContain(imagePath);
    expect(parts[1]).toEqual({
      type: "image",
      data: Buffer.from("image bytes").toString("base64"),
      mimeType: "image/png",
      uri: `file://${imagePath}`,
    });
  });

  it("emits one text part followed by image and resource-link parts in selection order", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-mixed-parts-"));
    const filePath = path.join(dir, "a1.ts");
    const imagePath = path.join(dir, "a2.png");
    await writeFile(filePath, "const x = 1;\n");
    await writeFile(imagePath, Buffer.from("image bytes"));

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "Check these",
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "main.ts",
            mimeType: "text/plain",
            size: 512,
            storageKey: "a1.ts",
            localPath: filePath,
          },
          {
            id: "a2",
            kind: "image" as const,
            name: "screen.png",
            mimeType: "image/png",
            size: 1024,
            storageKey: "a2.png",
            localPath: imagePath,
          },
        ],
      }),
    );

    expect(parts).toEqual([
      { type: "text", text: "Check these" },
      {
        type: "resource_link",
        uri: `file://${filePath}`,
        name: "main.ts",
        mimeType: "text/plain",
        size: 512,
      },
      {
        type: "image",
        data: Buffer.from("image bytes").toString("base64"),
        mimeType: "image/png",
        uri: `file://${imagePath}`,
      },
    ]);
  });

  it("uses the generic default prompt for file-only requests", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-file-default-"));
    const filePath = path.join(dir, "a1.md");
    await writeFile(filePath, "# notes\n");

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "   ",
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "notes.md",
            mimeType: "text/plain",
            size: 8,
            storageKey: "a1.md",
            localPath: filePath,
          },
        ],
      }),
    );

    expect(parts).toHaveLength(2);
    expect(parts[0]).toEqual({
      type: "text",
      text: "Inspect the attached files and summarize the relevant contents.",
    });
    expect(parts[1]).toMatchObject({ type: "resource_link", name: "notes.md" });
  });

  it("appends file resource links without duplicating paths in transcript text", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-file-transcript-"));
    const filePath = path.join(dir, "a1.ts");
    await writeFile(filePath, "const x = 1;\n");

    const parts = await buildKimiPromptParts(
      makeRequest({
        message: "   ",
        transcript: [{ role: "user" as const, content: "Earlier" }],
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "main.ts",
            mimeType: "text/plain",
            size: 512,
            storageKey: "a1.ts",
            localPath: filePath,
          },
        ],
      }),
      { includeTranscript: true },
    );

    expect(parts).toHaveLength(2);
    const text = (parts[0] as { text: string }).text;
    expect(text).toContain("user: Earlier");
    expect(text).not.toContain("Attached files:");
    expect(text).not.toContain(filePath);
    expect(parts[1]).toEqual({
      type: "resource_link",
      uri: `file://${filePath}`,
      name: "main.ts",
      mimeType: "text/plain",
      size: 512,
    });
  });
});

describe("startKimiAcpChatRun", () => {
  it("returns parsed session status from a /status prompt", async () => {
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
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
              content: {
                type: "text",
                text: "Session status:\n- Model: kimi-code/kimi-for-coding\n- Thinking: on\n- Permission: manual\n- Plan mode: off\n- Context: 21,169 / 262,144 (8.1%)",
              },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    const status = await getKimiSessionStatus({
      sessionId: "session-1",
      cwd: "/Users/onion/workbench/carrent",
      transportFactory: () => transport,
    });

    expect(status).toEqual({
      model: "kimi-code/kimi-for-coding",
      used: 21169,
      total: 262144,
      percentage: 8.1,
    });
  });

  it("returns null when status text does not contain context usage", async () => {
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
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
              content: { type: "text", text: "No usage data here." },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    const status = await getKimiSessionStatus({
      sessionId: "session-1",
      cwd: "/Users/onion/workbench/carrent",
      transportFactory: () => transport,
    });

    expect(status).toBe(null);
  });

  it("does not install a Carrent-side runtime timeout for session/prompt", async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timeoutDelays: unknown[] = [];

    globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const timer = { handler, timeout, args };
      timeoutDelays.push(timeout);
      return timer as unknown as ReturnType<typeof setTimeout>;
    }) as unknown as typeof setTimeout;
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

      for (let i = 0; i < 25; i += 1) {
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

  it("passes Carrent Bridge to new Kimi ACP sessions and closes it on completion", async () => {
    const emitted: ChatRunEvent[] = [];
    const bridge = createFakeCarrentBridgeFactory();
    let sessionNewParams: unknown = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        sessionNewParams = message.params;
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
      runId: "run-kimi-bridge-new",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: bridge.factory,
    });

    await waitForAsyncEvents();

    expect(sessionNewParams).toMatchObject({
      mcpServers: [bridge.handles[0]!.mcpServer],
    });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Done",
    });
    expect(bridge.handles[0]?.closed).toBe(true);
  });

  it("opens Kimi ACP sessions without MCP servers when Local MCP Server is off", async () => {
    const emitted: ChatRunEvent[] = [];
    let sessionNewParams: unknown = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        sessionNewParams = message.params;
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
              content: { type: "text", text: "No skills needed" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-no-local-mcp",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: async () => null,
    });

    await waitForAsyncEvents();

    expect(sessionNewParams).toMatchObject({ mcpServers: [] });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "No skills needed",
    });
  });

  it("passes Carrent Bridge to resumed Kimi ACP sessions", async () => {
    const bridge = createFakeCarrentBridgeFactory();
    let sessionResumeParams: unknown = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        sessionResumeParams = message.params;
        respondAcp(fakeTransport, message, { sessionId: "session-previous" });
        return;
      }

      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-previous",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Resumed" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    const emitted: ChatRunEvent[] = [];
    startKimiAcpChatRun({
      runId: "run-kimi-bridge-resume",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: bridge.factory,
      resumeSessionId: "session-previous",
    });

    await waitForAsyncEvents();

    expect(sessionResumeParams).toMatchObject({
      sessionId: "session-previous",
      mcpServers: [bridge.handles[0]!.mcpServer],
    });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Resumed",
    });
  });

  it("closes Carrent Bridge when a Kimi ACP prompt fails", async () => {
    const emitted: ChatRunEvent[] = [];
    const bridge = createFakeCarrentBridgeFactory();
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
          id: message.id,
          error: { code: -32000, message: "prompt failed" },
        });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-bridge-prompt-fail",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: bridge.factory,
    });

    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "failed")).toMatchObject({
      type: "failed",
      error: "prompt failed",
    });
    expect(bridge.handles[0]?.closed).toBe(true);
  });

  it("closes Carrent Bridge when a Kimi ACP run is stopped", async () => {
    const emitted: ChatRunEvent[] = [];
    const bridge = createFakeCarrentBridgeFactory();
    let promptRequest: Record<string, unknown> | null = null;
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
        promptRequest = message;
        return;
      }

      if (message.method === "session/cancel" && promptRequest) {
        respondAcp(fakeTransport, promptRequest, { stopReason: "cancelled" });
      }
    });

    const handle = startKimiAcpChatRun({
      runId: "run-kimi-bridge-stop",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: bridge.factory,
    });

    await waitForAsyncEvents();
    handle.stop();
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "stopped")).toMatchObject({
      type: "stopped",
      runId: "run-kimi-bridge-stop",
    });
    expect(bridge.handles[0]?.closed).toBe(true);
  });

  it("closes Carrent Bridge if stop happens before bridge startup settles", async () => {
    const emitted: ChatRunEvent[] = [];
    let resolveBridge!: (handle: CarrentBridgeHandle & { closed: boolean }) => void;
    const bridgeStarted = new Promise<CarrentBridgeHandle & { closed: boolean }>((resolve) => {
      resolveBridge = resolve;
    });
    const bridgeHandle: CarrentBridgeHandle & { closed: boolean } = {
      closed: false,
      mcpServer: {
        id: "carrent_bridge",
        name: "carrent_bridge",
        type: "http",
        url: "http://127.0.0.1/pending/mcp?token=test",
        headers: [],
      },
      async close() {
        bridgeHandle.closed = true;
      },
    };
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
      }
    });

    const handle = startKimiAcpChatRun({
      runId: "run-kimi-bridge-pending-stop",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: async () => bridgeStarted,
    });

    await waitForAsyncEvents();
    handle.stop();
    resolveBridge(bridgeHandle);
    await waitForAsyncEvents();

    expect(emitted).toEqual([
      {
        type: "stopped",
        runId: "run-kimi-bridge-pending-stop",
      },
    ]);
    expect(bridgeHandle.closed).toBe(true);
    expect(transport.sent.map((message) => message.method)).toEqual(["initialize"]);
  });

  it("fails clearly when Carrent Bridge startup fails before opening a session", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-bridge-start-fail",
      request: makeRequest({ runtimeId: "kimi" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      bridgeFactory: async () => {
        throw new Error("bridge failed");
      },
    });

    await waitForAsyncEvents();

    expect(transport.sent.map((message) => message.method)).toEqual(["initialize"]);
    expect(emitted).toEqual([
      {
        type: "failed",
        runId: "run-kimi-bridge-start-fail",
        error: "bridge failed",
      },
    ]);
  });

  it("omits transcript when resuming an existing Kimi ACP session", async () => {
    const emitted: ChatRunEvent[] = [];
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        respondAcp(fakeTransport, message, { configOptions: [] });
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-resumed",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Resumed" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-resume-no-transcript",
      request: makeRequest({
        runtimeId: "kimi",
        message: "Follow up",
        transcript: [{ role: "user" as const, content: "Earlier" }],
      }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      resumeSessionId: "session-resumed",
    });

    await waitForAsyncEvents();

    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "session/resume",
      "session/prompt",
    ]);
    const prompt = (promptRequest!.params as { prompt: Array<{ text: string }> }).prompt;
    expect(prompt).toHaveLength(1);
    expect(prompt[0].text).toBe("Follow up");
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Resumed",
    });
  });

  it("replays bounded transcript after a failed resume creates a fresh session", async () => {
    const emitted: ChatRunEvent[] = [];
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32000, message: "Session not found" },
        });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "fresh-session" });
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "fresh-session",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Recovered" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-failed-resume-transcript",
      request: makeRequest({
        runtimeId: "kimi",
        message: "Follow up",
        transcript: [
          { role: "user" as const, content: "First" },
          { role: "assistant" as const, content: "First answer" },
        ],
      }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      resumeSessionId: "stale-session",
    });

    await waitForAsyncEvents();

    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "session/resume",
      "session/new",
      "session/prompt",
    ]);
    const prompt = (promptRequest!.params as { prompt: Array<{ text: string }> }).prompt;
    expect(prompt).toHaveLength(1);
    const text = prompt[0].text;
    expect(text).toContain("Recent conversation:");
    expect(text).toContain("user: First");
    expect(text).toContain("assistant: First answer");
    expect(text).toContain("user: Follow up");
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Recovered",
    });
  });

  it("shows a native Plan Review and returns control to the conversation", async () => {
    const emitted: ChatRunEvent[] = [];
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, {
          sessionId: "session-plan",
          configOptions: [
            {
              id: "mode",
              currentValue: "default",
              options: [
                { value: "default", name: "Default" },
                { value: "plan", name: "Plan" },
              ],
            },
          ],
        });
        return;
      }

      if (message.method === "session/set_config_option") {
        respondAcp(fakeTransport, message, {});
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-plan",
            update: {
              sessionUpdate: "config_option_update",
              configOptions: [{ id: "mode", currentValue: "plan", options: [] }],
            },
          },
        });
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        queueMicrotask(() => {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            id: "permission-plan",
            method: "session/request_permission",
            params: {
              sessionId: "session-plan",
              options: [
                { optionId: "plan_opt_0", name: "Approach A", kind: "allow_once" },
                { optionId: "plan_opt_1", name: "Approach B", kind: "allow_once" },
                { optionId: "plan_revise", name: "Revise", kind: "reject_once" },
                {
                  optionId: "plan_reject_and_exit",
                  name: "Reject and Exit",
                  kind: "reject_once",
                },
              ],
              toolCall: {
                toolCallId: "tool-exit-plan",
                title: "ExitPlanMode",
                content: [
                  {
                    type: "content",
                    content: { type: "text", text: "Requesting approval to exit Plan mode" },
                  },
                  {
                    type: "content",
                    content: {
                      type: "text",
                      text: "Plan saved to: /Users/test/.kimi-code/plan.md\n\n# Plan\n\n- Implement it",
                    },
                  },
                ],
              },
            },
          });
        });
        return;
      }

      if (message.id === "permission-plan" && "result" in message) {
        queueMicrotask(() => {
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-plan",
              update: {
                sessionUpdate: "tool_call_update",
                toolCallId: "tool-exit-plan",
                title: "ExitPlanMode",
                status: "completed",
                rawOutput: "Plan mode deactivated. All tools are now available.",
              },
            },
          });
          fakeTransport.emitMessage({
            jsonrpc: "2.0",
            method: "session/update",
            params: {
              sessionId: "session-plan",
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "text", text: "The plan was rejected." },
              },
            },
          });
          if (promptRequest) {
            respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
          }
        });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-plan-review",
      request: makeRequest({ planMode: true, message: "Implement the feature" }),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(
      transport.sent.find((message) => message.method === "session/set_config_option"),
    ).toMatchObject({
      params: { sessionId: "session-plan", configId: "mode", value: "plan" },
    });
    const permission = emitted.find(
      (event): event is Extract<ChatRunEvent, { type: "permission-requested" }> =>
        event.type === "permission-requested",
    )!;
    expect(permission.permission.planReview).toEqual({ content: "# Plan\n\n- Implement it" });
    expect(permission.permission.options.map((option) => option.optionId)).toEqual([
      "plan_opt_0",
      "plan_opt_1",
      "plan_revise",
      "plan_reject_and_exit",
    ]);

    expect(transport.sent.find((message) => message.id === "permission-plan")?.result).toEqual({
      outcome: { outcome: "selected", optionId: "plan_reject_and_exit" },
    });
    expect(emitted.find((event) => event.type === "permission-resolved")).toMatchObject({
      type: "permission-resolved",
      optionId: "plan_reject_and_exit",
      optionName: "Reject and Exit",
      optionKind: "reject_once",
    });
    expect(
      emitted.filter((event) => event.type === "plan-mode-changed").map((event) => event.enabled),
    ).toEqual([true, false]);
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "",
    });
    expect(emitted.some((event) => event.type === "delta")).toBe(false);
  });

  it("syncs Kimi-initiated EnterPlanMode tool results", async () => {
    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-enter-plan" });
        return;
      }
      if (message.method === "session/prompt") {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-enter-plan",
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tool-enter-plan",
              title: "EnterPlanMode",
              status: "completed",
              rawOutput: "Plan mode is now active. Focus on planning.",
            },
          },
        });
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId: "session-enter-plan",
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Planning" },
            },
          },
        });
        respondAcp(fakeTransport, message, { stopReason: "end_turn" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-enter-plan",
      request: makeRequest(),
      cwd: "/Users/onion/workbench/carrent",
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "plan-mode-changed")).toMatchObject({
      type: "plan-mode-changed",
      enabled: true,
    });
  });

  it("reads and writes only the current session Plan file", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-plan-project-"));
    const sessionsRoot = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-sessions-"));
    const sessionId = "session-files";
    const planPath = path.join(
      sessionsRoot,
      "workspace-key",
      sessionId,
      "agents",
      "main",
      "plans",
      "feature.md",
    );
    await mkdir(path.dirname(planPath), { recursive: true });
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId });
        return;
      }
      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-plan",
          method: "fs/write_text_file",
          params: { sessionId, path: planPath, content: "# Plan\n\n- Step" },
        });
        return;
      }
      if (message.id === "write-plan" && "result" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-plan",
          method: "fs/read_text_file",
          params: { sessionId, path: planPath },
        });
        return;
      }
      if (message.id === "read-plan" && "result" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Plan saved" },
            },
          },
        });
        if (promptRequest) {
          respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
        }
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-plan-files",
      request: makeRequest({
        workspace: { kind: "project", projectId: "p1", projectPath: projectDir },
      }),
      cwd: projectDir,
      emit: () => {},
      transportFactory: () => transport,
      kimiSessionsRoot: sessionsRoot,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      (transport.sent[0].params as { clientCapabilities?: unknown }).clientCapabilities,
    ).toMatchObject({ fs: { readTextFile: true, writeTextFile: true } });
    expect(await readFile(planPath, "utf8")).toBe("# Plan\n\n- Step");
    expect(transport.sent.find((message) => message.id === "read-plan")?.result).toEqual({
      content: "# Plan\n\n- Step",
    });
  });

  it("rejects other-session and symlinked Plan file writes", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-plan-project-"));
    const sessionsRoot = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-sessions-"));
    const sessionId = "session-current";
    const otherPlanPath = path.join(
      sessionsRoot,
      "workspace-key",
      "session-other",
      "agents",
      "main",
      "plans",
      "other.md",
    );
    const currentPlanPath = path.join(
      sessionsRoot,
      "workspace-key",
      sessionId,
      "agents",
      "main",
      "plans",
      "current.md",
    );
    const outsidePath = path.join(projectDir, "outside.md");
    await mkdir(path.dirname(currentPlanPath), { recursive: true });
    await writeFile(outsidePath, "unchanged");
    await symlink(outsidePath, currentPlanPath);
    let promptRequest: Record<string, unknown> | null = null;
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId });
        return;
      }
      if (message.method === "session/prompt") {
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-other-session",
          method: "fs/write_text_file",
          params: { sessionId, path: otherPlanPath, content: "blocked" },
        });
        return;
      }
      if (message.id === "write-other-session" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-symlink",
          method: "fs/write_text_file",
          params: { sessionId, path: currentPlanPath, content: "blocked" },
        });
        return;
      }
      if (message.id === "write-symlink" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Blocked" },
            },
          },
        });
        if (promptRequest) {
          respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
        }
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-plan-file-boundary",
      request: makeRequest({
        workspace: { kind: "project", projectId: "p1", projectPath: projectDir },
      }),
      cwd: projectDir,
      emit: () => {},
      transportFactory: () => transport,
      kimiSessionsRoot: sessionsRoot,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(
      transport.sent.find((message) => message.id === "write-other-session")?.error,
    ).toMatchObject({
      code: -32000,
    });
    expect(transport.sent.find((message) => message.id === "write-symlink")?.error).toMatchObject({
      code: -32000,
    });
    expect(await readFile(outsidePath, "utf8")).toBe("unchanged");
  });

  it("reads only the exact current File Attachment and names it in Agent Activity", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-attach-project-"));
    const attachmentsDir = path.join(projectDir, ".carrent", "attachments");
    await mkdir(attachmentsDir, { recursive: true });
    const configPath = path.join(attachmentsDir, "config.json");
    const siblingPath = path.join(attachmentsDir, "sibling.txt");
    const outsidePath = path.join(projectDir, "outside.txt");
    const symlinkPath = path.join(attachmentsDir, "link.txt");
    await writeFile(configPath, '{"ok":true}');
    await writeFile(siblingPath, "sibling");
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, symlinkPath);

    const emitted: ChatRunEvent[] = [];
    let promptRequest: Record<string, unknown> | null = null;
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
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-config",
          method: "fs/read_text_file",
          params: { sessionId: "session-1", path: configPath },
        });
        return;
      }
      if (message.id === "read-config" && "result" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-sibling",
          method: "fs/read_text_file",
          params: { sessionId: "session-1", path: siblingPath },
        });
        return;
      }
      if (message.id === "read-sibling" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-config",
          method: "fs/write_text_file",
          params: { sessionId: "session-1", path: configPath, content: "hacked" },
        });
        return;
      }
      if (message.id === "write-config" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-symlink",
          method: "fs/read_text_file",
          params: { sessionId: "session-1", path: symlinkPath },
        });
        return;
      }
      if (message.id === "read-symlink" && "error" in message) {
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
        if (promptRequest) {
          respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
        }
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-attachment-boundary",
      request: makeRequest({
        workspace: { kind: "project", projectId: "p1", projectPath: projectDir },
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "config.json",
            mimeType: "text/plain",
            size: 12,
            storageKey: "a1.json",
            localPath: configPath,
          },
        ],
      }),
      cwd: projectDir,
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
      attachmentStoreRoot: attachmentsDir,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(transport.sent.find((message) => message.id === "read-config")?.result).toEqual({
      content: '{"ok":true}',
    });
    expect(transport.sent.find((message) => message.id === "read-sibling")?.error).toMatchObject({
      code: -32000,
    });
    expect(transport.sent.find((message) => message.id === "write-config")?.error).toMatchObject({
      code: -32000,
    });
    expect(transport.sent.find((message) => message.id === "read-symlink")?.error).toMatchObject({
      code: -32000,
    });
    expect(await readFile(configPath, "utf8")).toBe('{"ok":true}');

    const readEvent = emitted.find(
      (event) => event.type === "reasoning" && event.reasoning.content.startsWith("Read "),
    );
    expect(readEvent && readEvent.type === "reasoning" && readEvent.reasoning.content).toBe(
      "Read config.json",
    );
    expect(JSON.stringify(emitted)).not.toContain(attachmentsDir);

    const prompt = (promptRequest as Record<string, unknown> | null)?.params as {
      prompt?: Array<Record<string, unknown>>;
    };
    expect(prompt.prompt?.[1]).toEqual({
      type: "resource_link",
      uri: `file://${configPath}`,
      name: "config.json",
      mimeType: "text/plain",
      size: 12,
    });
  });

  it("protects remembered attachment paths when the current request has no attachments", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-attach-history-"));
    const attachmentsDir = path.join(projectDir, ".carrent", "attachments");
    const oldAttachmentPath = path.join(attachmentsDir, "old.txt");
    await mkdir(attachmentsDir, { recursive: true });
    await writeFile(oldAttachmentPath, "history snapshot");

    let promptRequest: Record<string, unknown> | null = null;
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
        promptRequest = message;
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "read-old-attachment",
          method: "fs/read_text_file",
          params: { sessionId: "session-1", path: oldAttachmentPath },
        });
        return;
      }
      if (message.id === "read-old-attachment" && "error" in message) {
        fakeTransport.emitMessage({
          jsonrpc: "2.0",
          id: "write-old-attachment",
          method: "fs/write_text_file",
          params: { sessionId: "session-1", path: oldAttachmentPath, content: "changed" },
        });
        return;
      }
      if (message.id === "write-old-attachment" && "error" in message) {
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
        if (promptRequest) {
          respondAcp(fakeTransport, promptRequest, { stopReason: "end_turn" });
        }
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-attachment-history-boundary",
      request: makeRequest({
        workspace: { kind: "project", projectId: "p1", projectPath: projectDir },
        attachments: [],
      }),
      cwd: projectDir,
      emit: () => {},
      transportFactory: () => transport,
      attachmentStoreRoot: attachmentsDir,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(transport.sent.find((message) => message.id === "read-old-attachment")?.error).toMatchObject({
      code: -32000,
    });
    expect(transport.sent.find((message) => message.id === "write-old-attachment")?.error).toMatchObject({
      code: -32000,
    });
    expect(await readFile(oldAttachmentPath, "utf8")).toBe("history snapshot");
  });

  it("fails the run when a stored File Attachment is missing", async () => {
    const projectDir = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-missing-project-"));
    const missingPath = path.join(projectDir, "gone.txt");

    const emitted: ChatRunEvent[] = [];
    const transport = new FakeKimiAcpTransport((fakeTransport, message) => {
      if (message.method === "initialize") {
        respondAcp(fakeTransport, message, { protocolVersion: 1 });
        return;
      }
      if (message.method === "session/new") {
        respondAcp(fakeTransport, message, { sessionId: "session-1" });
      }
    });

    startKimiAcpChatRun({
      runId: "run-kimi-attachment-missing",
      request: makeRequest({
        workspace: { kind: "project", projectId: "p1", projectPath: projectDir },
        attachments: [
          {
            id: "a1",
            kind: "file" as const,
            name: "gone.txt",
            mimeType: "text/plain",
            size: 10,
            storageKey: "a1.txt",
            localPath: missingPath,
          },
        ],
      }),
      cwd: projectDir,
      emit: (event) => emitted.push(event),
      transportFactory: () => transport,
    });
    await waitForAsyncEvents();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const failed = emitted.find((event) => event.type === "failed");
    expect(failed && failed.type === "failed" && failed.error).toContain(
      "Attachment is unavailable: gone.txt",
    );
    expect(transport.sent.map((message) => message.method)).not.toContain("session/prompt");
  });
});
