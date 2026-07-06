import { describe, expect, it } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
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
  it("includes RTK soft-enable instructions when requested", async () => {
    const parts = await buildKimiPromptParts(makeRequest({ rtkEnabled: true }));
    const text = parts[0]?.text;

    expect(parts[0]?.type).toBe("text");
    expect(typeof text === "string" && text.includes("RTK is enabled.")).toBe(true);
    expect(
      typeof text === "string" && text.includes("Always prefix shell commands with `rtk`."),
    ).toBe(true);
    expect(typeof text === "string" && text.includes("`rtk gain --history`")).toBe(true);
    expect(
      typeof text === "string" && text.includes("Do not run the unprefixed command first."),
    ).toBe(true);
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
});
