import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import type { ChildProcess } from "node:child_process";
import os from "node:os";
import path from "node:path";
import type { ChatRunEvent, ChatTurnRequest } from "../../src/shared/chat";
import {
  createChatSessionManager as createProductionChatSessionManager,
  type ChatSessionManager,
} from "./chatSessionManager";
import type { KimiAcpTransport, KimiAcpTransportFactory } from "./kimiAcpChat";

type JsonMessage = Record<string, unknown>;

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    workspace: {
      kind: "project",
      projectId: "timbre",
      projectPath: "/Users/onion/workbench/timbre",
    },
    threadId: "thread-1",
    runtimeId: "codex",
    runtimeMode: "approval-required",
    transcript: [],
    message: "Hello",
    ...overrides,
  };
}

class FakeKimiAcpTransport implements KimiAcpTransport {
  readonly sent: JsonMessage[] = [];
  readonly messageListeners: Array<(message: JsonMessage) => void> = [];
  readonly errorListeners: Array<(error: Error) => void> = [];
  readonly closeListeners: Array<
    (details: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) => void
  > = [];
  closed = false;

  constructor(
    readonly cwd: string,
    private readonly onSend: (transport: FakeKimiAcpTransport, message: JsonMessage) => void,
  ) {}

  send(message: JsonMessage) {
    this.sent.push(message);
    this.onSend(this, message);
  }

  close() {
    this.closed = true;
  }

  onMessage(listener: (message: JsonMessage) => void) {
    this.messageListeners.push(listener);
  }

  onError(listener: (error: Error) => void) {
    this.errorListeners.push(listener);
  }

  onClose(
    listener: (details: {
      code: number | null;
      signal: NodeJS.Signals | null;
      stderr: string;
    }) => void,
  ) {
    this.closeListeners.push(listener);
  }

  emitMessage(message: JsonMessage) {
    this.messageListeners.forEach((listener) => listener(message));
  }

  emitClose(details: { code: number | null; signal: NodeJS.Signals | null; stderr: string }) {
    this.closeListeners.forEach((listener) => listener(details));
  }
}

function createFakeKimiAcpTransportFactory(
  onSend: (transport: FakeKimiAcpTransport, message: JsonMessage) => void,
) {
  const transports: FakeKimiAcpTransport[] = [];
  const factory: KimiAcpTransportFactory = ({ cwd }) => {
    const transport = new FakeKimiAcpTransport(cwd, onSend);
    transports.push(transport);
    return transport;
  };

  return { factory, transports };
}

function respondAcp(transport: FakeKimiAcpTransport, request: JsonMessage, result: unknown) {
  transport.emitMessage({ jsonrpc: "2.0", id: request.id, result });
}

function failAcp(transport: FakeKimiAcpTransport, request: JsonMessage, message: string) {
  transport.emitMessage({
    jsonrpc: "2.0",
    id: request.id,
    error: { code: -32000, message },
  });
}

function emitAcpUpdate(transport: FakeKimiAcpTransport, update: JsonMessage) {
  transport.emitMessage({
    jsonrpc: "2.0",
    method: "session/update",
    params: {
      sessionId: "session-1",
      update,
    },
  });
}

function waitForAsyncEvents() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

function createMockChildProcess(): MockChildProcess {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter() as MockChildProcess;
  child.stdout = stdout as unknown as MockChildProcess["stdout"];
  child.stderr = stderr as unknown as MockChildProcess["stderr"];
  child.kill = (signal?: NodeJS.Signals | number) => {
    child.killed = true;
    // Emit close asynchronously like real spawn
    setTimeout(() => {
      child.emit("close", null, signal ?? "SIGTERM");
    }, 0);
    return true;
  };
  child.killed = false;
  return child;
}

type MockChildProcess = ChildProcess & {
  stdout: NodeJS.ReadableStream & EventEmitter;
  stderr: NodeJS.ReadableStream & EventEmitter;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  killed: boolean;
};

function createChatSessionManager(
  options: Parameters<typeof createProductionChatSessionManager>[0],
): ChatSessionManager {
  return createProductionChatSessionManager({
    allowLegacyRuntimeCommands: true,
    ...options,
  });
}

describe("createChatSessionManager", () => {
  it("emits started, delta, and completed for a successful codex run", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-1", makeRequest());

    mockChild.stdout.emit(
      "data",
      Buffer.from(
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hello world"}}\n',
      ),
    );

    // Simulate process completion
    mockChild.emit("close", 0, null);

    // Wait for async event emission
    await new Promise((resolve) => setTimeout(resolve, 10));

    const started = emitted.find((e) => e.type === "started");
    expect(started).toBeDefined();
    expect(started).toMatchObject({
      type: "started",
      runId: "run-1",
      threadId: "thread-1",
    });

    const deltas = emitted.filter((e) => e.type === "delta");
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({
      type: "delta",
      runId: "run-1",
      text: "Hello world",
    });

    const completed = emitted.find((e) => e.type === "completed");
    expect(completed).toBeDefined();
    expect(completed).toMatchObject({
      type: "completed",
      runId: "run-1",
      text: "Hello world",
    });
  });

  it("starts CLI children with stdin ignored so providers do not wait for EOF", async () => {
    const mockChild = createMockChildProcess();
    let capturedStdio: unknown;

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, _args, options) => {
        capturedStdio = (options as { stdio?: unknown }).stdio;
        return mockChild;
      },
    });

    manager.start("run-stdin", makeRequest());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedStdio).toEqual(["ignore", "pipe", "pipe"]);
  });

  it("stop kills the active child and emits stopped", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-2", makeRequest());
    manager.stop("run-2");

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockChild.killed).toBe(true);
    const stopped = emitted.find((e) => e.type === "stopped");
    expect(stopped).toBeDefined();
    expect(stopped).toMatchObject({ type: "stopped", runId: "run-2" });
  });

  it("emits failed on non-zero exit", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-3", makeRequest());
    mockChild.stderr.emit("data", Buffer.from("Something went wrong"));
    mockChild.emit("close", 1, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const failed = emitted.find((e) => e.type === "failed");
    expect(failed).toBeDefined();
    expect(failed?.error).toContain("Something went wrong");
  });

  it("emits failed on spawn error", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-4", makeRequest());
    mockChild.emit("error", new Error("ENOENT"));

    await new Promise((resolve) => setTimeout(resolve, 10));

    const failed = emitted.find((e) => e.type === "failed");
    expect(failed).toBeDefined();
    expect(failed?.error).toContain("not found");
  });

  it("emits failed when project path is missing", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start(
      "run-5",
      makeRequest({
        workspace: { kind: "project", projectId: "timbre", projectPath: "" },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const failed = emitted.find((e) => e.type === "failed");
    expect(failed).toBeDefined();
    expect(failed?.error).toContain("Project path is missing");
  });

  it("starts Kimi ACP with stdio pipes by default", async () => {
    const mockChild = createMockChildProcess();
    const spawnCalls: Array<{ command: string; args: string[]; options: { stdio?: unknown } }> = [];

    const manager = createProductionChatSessionManager({
      emit: () => {},
      spawn: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return mockChild;
      },
    });

    manager.start("run-kimi", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]).toMatchObject({
      command: "kimi",
      args: ["acp"],
      options: {
        cwd: "/Users/onion/workbench/timbre",
        stdio: ["pipe", "pipe", "pipe"],
      },
    });
  });

  it("runs a successful Kimi ACP chat turn through Carrent events", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Thinking" },
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Hello" },
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: " from Kimi" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-success", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    const transport = transports[0];
    expect(transport?.cwd).toBe("/Users/onion/workbench/timbre");
    expect(
      transport?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(transport).toBeDefined();
    expect((transport!.sent[1].params as { cwd?: string }).cwd).toBe(
      "/Users/onion/workbench/timbre",
    );

    expect(emitted.map((event) => event.type)).toEqual([
      "started",
      "reasoning",
      "delta",
      "delta",
      "reasoning",
      "completed",
    ]);
    expect(emitted.filter((event) => event.type === "delta").map((event) => event.text)).toEqual([
      "Hello",
      " from Kimi",
    ]);
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      requestKey: undefined,
      text: "Hello from Kimi",
    });
  });

  it("includes requestKey on Kimi ACP run events", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start(
      "run-kimi-request-key",
      makeRequest({ runtimeId: "kimi", requestKey: "request-kimi-1" }),
    );
    await waitForAsyncEvents();

    expect(emitted.map((event) => event.requestKey)).toEqual([
      "request-kimi-1",
      "request-kimi-1",
      "request-kimi-1",
    ]);
  });

  it("passes a selected Kimi model through ACP before prompting", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, {
          sessionId: "session-1",
          configOptions: [
            {
              type: "select",
              id: "model",
              category: "model",
              currentValue: "kimi-code/kimi-for-coding",
              options: [
                { value: "kimi-code/kimi-for-coding", name: "K2.7 Code High Speed" },
                { value: "kimi-code/kimi-for-coding-deep", name: "K2.7 Code Deep" },
              ],
            },
          ],
        });
        return;
      }

      if (message.method === "session/set_config_option") {
        respondAcp(transport, message, {
          configOptions: [
            {
              id: "model",
              currentValue: "kimi-code/kimi-for-coding-deep",
              options: [
                { value: "kimi-code/kimi-for-coding", name: "K2.7 Code High Speed" },
                { value: "kimi-code/kimi-for-coding-deep", name: "K2.7 Code Deep" },
              ],
            },
          ],
        });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Model configured" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start(
      "run-kimi-model",
      makeRequest({
        runtimeId: "kimi",
        runtimeModelId: "kimi-code/kimi-for-coding-deep",
      }),
    );
    await waitForAsyncEvents();

    expect(
      transports[0]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/new", "session/set_config_option", "session/prompt"]);
    expect(transports[0]?.sent[2]).toMatchObject({
      method: "session/set_config_option",
      params: {
        sessionId: "session-1",
        configId: "model",
        value: "kimi-code/kimi-for-coding-deep",
      },
    });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Model configured",
    });
  });

  it("passes selected Kimi model and auto mode through ACP before prompting", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, {
          sessionId: "session-1",
          configOptions: [
            {
              type: "select",
              id: "model",
              category: "model",
              currentValue: "kimi-code/kimi-for-coding",
              options: [
                { value: "kimi-code/kimi-for-coding", name: "K2.7 Code High Speed" },
                { value: "kimi-code/kimi-for-coding-deep", name: "K2.7 Code Deep" },
              ],
            },
            {
              type: "select",
              id: "mode",
              category: "mode",
              currentValue: "default",
              options: [
                { value: "default", name: "Default" },
                { value: "auto", name: "Auto" },
                { value: "yolo", name: "YOLO" },
              ],
            },
          ],
        });
        return;
      }

      if (message.method === "session/set_config_option") {
        respondAcp(transport, message, { configOptions: [] });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Configured" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start(
      "run-kimi-model-auto",
      makeRequest({
        runtimeId: "kimi",
        runtimeModelId: "kimi-code/kimi-for-coding-deep",
        runtimeMode: "auto-accept-edits",
      }),
    );
    await waitForAsyncEvents();

    expect(
      transports[0]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual([
      "initialize",
      "session/new",
      "session/set_config_option",
      "session/set_config_option",
      "session/prompt",
    ]);
    expect(transports[0]?.sent[2]).toMatchObject({
      method: "session/set_config_option",
      params: {
        sessionId: "session-1",
        configId: "model",
        value: "kimi-code/kimi-for-coding-deep",
      },
    });
    expect(transports[0]?.sent[3]).toMatchObject({
      method: "session/set_config_option",
      params: {
        sessionId: "session-1",
        configId: "mode",
        value: "auto",
      },
    });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Configured",
    });
  });

  it("fails clearly when a selected Kimi model is not supported by ACP options", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, {
          sessionId: "session-1",
          configOptions: [
            {
              type: "select",
              id: "model",
              category: "model",
              currentValue: "kimi-code/kimi-for-coding",
              options: [{ value: "kimi-code/kimi-for-coding", name: "K2.7 Code High Speed" }],
            },
          ],
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start(
      "run-kimi-unsupported-model",
      makeRequest({
        runtimeId: "kimi",
        runtimeModelId: "not-a-kimi-model",
      }),
    );
    await waitForAsyncEvents();

    expect(
      transports[0]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/new"]);
    expect(emitted.find((event) => event.type === "failed")).toMatchObject({
      type: "failed",
      runId: "run-kimi-unsupported-model",
      error:
        'Kimi Code does not list selected model "not-a-kimi-model". Clear it or choose a Kimi-supported model.',
    });
  });

  it("maps full-access runtime mode to Kimi ACP yolo mode before prompting", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, {
          sessionId: "session-1",
          configOptions: [
            {
              type: "select",
              id: "mode",
              category: "mode",
              currentValue: "default",
              options: [
                { value: "default", name: "Default" },
                { value: "auto", name: "Auto" },
                { value: "yolo", name: "YOLO" },
              ],
            },
          ],
        });
        return;
      }

      if (message.method === "session/set_config_option") {
        respondAcp(transport, message, {
          configOptions: [
            {
              id: "mode",
              currentValue: "yolo",
              options: [
                { value: "default", name: "Default" },
                { value: "auto", name: "Auto" },
                { value: "yolo", name: "YOLO" },
              ],
            },
          ],
        });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Mode configured" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start(
      "run-kimi-mode",
      makeRequest({
        runtimeId: "kimi",
        runtimeMode: "full-access",
      }),
    );
    await waitForAsyncEvents();

    expect(
      transports[0]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/new", "session/set_config_option", "session/prompt"]);
    expect(transports[0]?.sent[2]).toMatchObject({
      method: "session/set_config_option",
      params: {
        sessionId: "session-1",
        configId: "mode",
        value: "yolo",
      },
    });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Mode configured",
    });
  });

  it("fails clearly when Kimi ACP cannot configure a non-default runtime mode", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1", configOptions: [] });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start(
      "run-kimi-mode-unsupported",
      makeRequest({
        runtimeId: "kimi",
        runtimeMode: "auto-accept-edits",
      }),
    );
    await waitForAsyncEvents();

    expect(
      transports[0]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/new"]);
    expect(emitted.find((event) => event.type === "failed")).toMatchObject({
      type: "failed",
      runId: "run-kimi-mode-unsupported",
      error:
        "Kimi Code did not expose a mode configuration option. Use Approval required or update Kimi Code.",
    });
  });

  it("returns a useful failed event when Kimi ACP startup fails", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        failAcp(transport, message, "login required");
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-fail", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(emitted).toEqual([
      {
        type: "failed",
        runId: "run-kimi-fail",
        error: "login required",
      },
    ]);
  });

  it("returns a useful failed event when Kimi ACP transport creation fails", async () => {
    const emitted: ChatRunEvent[] = [];

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("spawn failed");
      },
      kimiAcpTransportFactory: () => {
        throw new Error("transport unavailable");
      },
    });

    manager.start("run-kimi-transport-fail", makeRequest({ runtimeId: "kimi" }));

    expect(emitted).toEqual([
      {
        type: "failed",
        runId: "run-kimi-transport-fail",
        error: "transport unavailable",
      },
    ]);
  });

  it("returns a useful failed event when Kimi ACP prompt fails", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        failAcp(transport, message, "prompt failed");
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-prompt-fail", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(emitted).toEqual([
      {
        type: "started",
        runId: "run-kimi-prompt-fail",
        threadId: "thread-1",
      },
      {
        type: "failed",
        runId: "run-kimi-prompt-fail",
        error: "prompt failed",
      },
    ]);
  });

  it("answers Kimi ACP fs/read_text_file requests from the project workspace", async () => {
    const emitted: ChatRunEvent[] = [];
    const workspacePath = process.cwd();
    const packagePath = path.join(workspacePath, "package.json");
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          transport.emitMessage({
            jsonrpc: "2.0",
            id: "agent-read-1",
            method: "fs/read_text_file",
            params: {
              sessionId: "session-1",
              path: packagePath,
            },
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Read complete" },
          });
          setTimeout(() => respondAcp(transport, message, { stopReason: "end_turn" }), 5);
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start(
      "run-kimi-read",
      makeRequest({
        runtimeId: "kimi",
        workspace: {
          kind: "project",
          projectId: "carrent",
          projectPath: workspacePath,
        },
      }),
    );
    await waitForAsyncEvents();

    const readResponse = transports[0]?.sent.find((message) => message.id === "agent-read-1");
    expect(readResponse).toBeDefined();
    expect((readResponse!.result as { content?: string }).content).toContain('"name": "carrent"');
    expect(emitted.find((event) => event.type === "reasoning")).toMatchObject({
      type: "reasoning",
      reasoning: {
        id: `kimi-fs-read-${packagePath}`,
        content: "Read package.json",
        status: "completed",
      },
    });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Read complete",
    });
  });

  it("refuses Kimi ACP fs/read_text_file requests that escape through workspace symlinks", async () => {
    const workspacePath = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-workspace-"));
    const outsidePath = await mkdtemp(path.join(os.tmpdir(), "carrent-kimi-outside-"));
    await writeFile(path.join(outsidePath, "secret.txt"), "secret", "utf8");
    await symlink(
      path.join(outsidePath, "secret.txt"),
      path.join(workspacePath, "linked-secret.txt"),
    );

    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          transport.emitMessage({
            jsonrpc: "2.0",
            id: "agent-read-symlink",
            method: "fs/read_text_file",
            params: {
              sessionId: "session-1",
              path: path.join(workspacePath, "linked-secret.txt"),
            },
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Still safe" },
          });
          setTimeout(() => respondAcp(transport, message, { stopReason: "end_turn" }), 5);
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start(
      "run-kimi-read-symlink",
      makeRequest({
        runtimeId: "kimi",
        workspace: {
          kind: "project",
          projectId: "tmp",
          projectPath: workspacePath,
        },
      }),
    );
    await waitForAsyncEvents();

    const readResponse = transports[0]?.sent.find((message) => message.id === "agent-read-symlink");
    const readError = readResponse?.error as { code?: number; message?: string } | undefined;
    expect(readError?.code).toBe(-32000);
    expect(readError?.message).toContain("Refusing to read outside workspace");
    expect((readResponse?.result as { content?: string } | undefined)?.content).toBeUndefined();
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Still safe",
    });
  });

  it("normalizes Kimi ACP shell activity into shell events with bounded output", async () => {
    const emitted: ChatRunEvent[] = [];
    const longOutput = "x".repeat(13_000);
    const { factory } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "tool_call",
            toolCallId: "tool-shell-1",
            title: "Bash",
            kind: "execute",
            status: "pending",
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-shell-1",
            title: "Running: pwd",
            kind: "execute",
            status: "in_progress",
            rawInput: { command: "pwd", cwd: "/Users/onion/workbench/carrent" },
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-shell-1",
            status: "completed",
            rawOutput: longOutput,
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-shell", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    const shellEvents = emitted.filter((event) => event.type === "shell");
    expect(shellEvents).toHaveLength(3);
    expect(shellEvents[0].shell).toMatchObject({
      id: "tool-shell-1",
      command: "Bash",
      output: "",
      status: "running",
    });
    expect(shellEvents[1].shell).toMatchObject({
      command: "pwd",
      status: "running",
    });
    expect(shellEvents[2].shell.command).toBe("pwd");
    expect(shellEvents[2].shell.status).toBe("completed");
    expect(shellEvents[2].shell.output.length).toBeLessThan(longOutput.length);
    expect(shellEvents[2].shell.output).toContain("[output truncated]");
  });

  it("preserves Kimi thinking around shell activity", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Inspect first" },
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "tool_call",
            toolCallId: "tool-shell-1",
            title: "Bash",
            kind: "execute",
            status: "pending",
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-shell-1",
            title: "Running: pwd",
            kind: "execute",
            status: "completed",
            rawInput: { command: "pwd" },
            rawOutput: "/tmp",
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "Verify result" },
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-thinking-shell", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    const activity = emitted
      .filter((event) => event.type === "reasoning" || event.type === "shell")
      .map((event) =>
        event.type === "reasoning"
          ? `${event.reasoning.id}:${event.reasoning.status}:${event.reasoning.content}`
          : `${event.shell.id}:${event.shell.status}:${event.shell.command}`,
      );

    expect(activity).toEqual([
      "kimi-thinking-1:running:Inspect first",
      "kimi-thinking-1:completed:Inspect first",
      "tool-shell-1:running:Bash",
      "tool-shell-1:completed:pwd",
      "kimi-thinking-2:running:Verify result",
      "kimi-thinking-2:completed:Verify result",
    ]);
  });

  it("normalizes Kimi ACP file activity into reasoning events", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "tool_call",
            toolCallId: "tool-read-1",
            title: "Read",
            kind: "read",
            status: "pending",
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-read-1",
            title: "Reading package.json",
            kind: "read",
            status: "completed",
            rawInput: { path: "package.json" },
            rawOutput: "file contents",
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-file", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    const fileReasoningEvents = emitted.filter(
      (event): event is Extract<ChatRunEvent, { type: "reasoning" }> =>
        event.type === "reasoning" && event.reasoning.id === "kimi-tool-tool-read-1",
    );
    expect(fileReasoningEvents.map((event) => event.reasoning)).toEqual([
      {
        id: "kimi-tool-tool-read-1",
        content: "Read",
        status: "running",
      },
      {
        id: "kimi-tool-tool-read-1",
        content: "Read package.json",
        status: "completed",
      },
    ]);
  });

  it("handles unknown Kimi ACP activity without crashing the run", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "unknown_update",
            unexpected: true,
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "tool_call",
            toolCallId: "tool-unknown-1",
            title: "Mystery",
            kind: "telemetry",
            status: "in_progress",
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Still fine" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-unknown", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Still fine",
    });
    expect(emitted.find((event) => event.type === "reasoning")).toMatchObject({
      type: "reasoning",
      reasoning: {
        id: "kimi-tool-tool-unknown-1",
        content: "Mystery",
        status: "running",
      },
    });
  });

  it("settles failed Kimi ACP file activity instead of leaving it running", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "tool_call_update",
            toolCallId: "tool-read-failed",
            title: "Reading missing.txt",
            kind: "read",
            status: "failed",
            rawInput: { path: "missing.txt" },
          });
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-file-failed", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(emitted.find((event) => event.type === "reasoning")).toMatchObject({
      type: "reasoning",
      reasoning: {
        id: "kimi-tool-tool-read-failed",
        content: "Read missing.txt",
        status: "completed",
      },
    });
  });

  it("cancels an in-flight Kimi ACP run and emits stopped", async () => {
    const emitted: ChatRunEvent[] = [];
    let promptRequest: JsonMessage | null = null;
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        return;
      }

      if (message.method === "session/cancel") {
        queueMicrotask(() => {
          if (promptRequest) {
            respondAcp(transport, promptRequest, { stopReason: "cancelled" });
          }
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-stop", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();
    manager.stop("run-kimi-stop");
    await waitForAsyncEvents();

    expect(
      transports[0]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/new", "session/prompt", "session/cancel"]);
    expect(emitted.find((event) => event.type === "stopped")).toMatchObject({
      type: "stopped",
      runId: "run-kimi-stop",
    });
    expect(transports[0]?.closed).toBe(true);
  });

  it("treats Kimi ACP process close after stop as stopped", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-stop-close", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();
    manager.stop("run-kimi-stop-close");
    transports[0]?.emitClose({ code: null, signal: "SIGTERM", stderr: "" });
    await waitForAsyncEvents();

    expect(emitted.some((event) => event.type === "failed")).toBe(false);
    expect(emitted.find((event) => event.type === "stopped")).toMatchObject({
      type: "stopped",
      runId: "run-kimi-stop-close",
    });
  });

  it("surfaces Kimi ACP permission requests and sends the selected approval option", async () => {
    const emitted: ChatRunEvent[] = [];
    let promptRequest: JsonMessage | null = null;
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        queueMicrotask(() => {
          transport.emitMessage({
            jsonrpc: "2.0",
            id: "agent-permission-1",
            method: "session/request_permission",
            params: {
              sessionId: "session-1",
              options: [
                {
                  optionId: "approve_always",
                  name: "Approve for this session",
                  kind: "allow_always",
                },
                { optionId: "approve_once", name: "Approve once", kind: "allow_once" },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
              toolCall: {
                toolCallId: "tool-shell-1",
                title: "Bash",
                content: [
                  {
                    type: "content",
                    content: {
                      type: "text",
                      text: "Requesting approval to Running: pwd",
                    },
                  },
                ],
              },
            },
          });
        });
        return;
      }

      if (message.id === "agent-permission-1" && "result" in message) {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Allowed" },
          });
          if (promptRequest) {
            respondAcp(transport, promptRequest, { stopReason: "end_turn" });
          }
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-permission", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    const permissionRequested = emitted.find(
      (event): event is Extract<ChatRunEvent, { type: "permission-requested" }> =>
        event.type === "permission-requested",
    );
    expect(permissionRequested).toMatchObject({
      type: "permission-requested",
      runId: "run-kimi-permission",
      permission: {
        provider: "kimi",
        action: "shell",
        command: "pwd",
        threadId: "thread-1",
      },
    });

    manager.respondToPermission({
      runId: "run-kimi-permission",
      permissionId: permissionRequested!.permission.id,
      decision: "approved",
    });
    await waitForAsyncEvents();

    const permissionResponse = transports[0]?.sent.find(
      (message) => message.id === "agent-permission-1" && "result" in message,
    );
    expect(permissionResponse?.result).toEqual({
      outcome: {
        outcome: "selected",
        optionId: "approve_once",
      },
    });
    expect(emitted.find((event) => event.type === "permission-resolved")).toMatchObject({
      type: "permission-resolved",
      runId: "run-kimi-permission",
      permissionId: permissionRequested!.permission.id,
      decision: "approved",
    });
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Allowed",
    });
  });

  it("keeps Kimi ACP permission ids unique across concurrent runs", async () => {
    const emitted: ChatRunEvent[] = [];
    const promptByTransport = new Map<FakeKimiAcpTransport, JsonMessage>();
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        const turn = transports.indexOf(transport) + 1;
        respondAcp(transport, message, { sessionId: `session-${turn}` });
        return;
      }

      if (message.method === "session/prompt") {
        promptByTransport.set(transport, message);
        queueMicrotask(() => {
          transport.emitMessage({
            jsonrpc: "2.0",
            id: "agent-permission-1",
            method: "session/request_permission",
            params: {
              sessionId: "session-1",
              options: [
                { optionId: "approve_once", name: "Approve once", kind: "allow_once" },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
              toolCall: {
                toolCallId: "tool-shell-1",
                title: "Bash",
                content: [
                  {
                    type: "content",
                    content: {
                      type: "text",
                      text: "Requesting approval to Running: pwd",
                    },
                  },
                ],
              },
            },
          });
        });
        return;
      }

      if (message.id === "agent-permission-1" && "result" in message) {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Allowed" },
          });
          const promptRequest = promptByTransport.get(transport);
          if (promptRequest) {
            respondAcp(transport, promptRequest, { stopReason: "end_turn" });
          }
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start(
      "run-kimi-permission-a",
      makeRequest({ runtimeId: "kimi", threadId: "thread-a" }),
    );
    manager.start(
      "run-kimi-permission-b",
      makeRequest({ runtimeId: "kimi", threadId: "thread-b" }),
    );
    await waitForAsyncEvents();

    const permissions = emitted.filter(
      (event): event is Extract<ChatRunEvent, { type: "permission-requested" }> =>
        event.type === "permission-requested",
    );
    expect(permissions).toHaveLength(2);
    expect(new Set(permissions.map((event) => event.permission.id)).size).toBe(2);
    expect(permissions.map((event) => event.permission.id)).toEqual([
      "kimi-permission-run-kimi-permission-a-agent-permission-1",
      "kimi-permission-run-kimi-permission-b-agent-permission-1",
    ]);

    for (const event of permissions) {
      manager.respondToPermission({
        runId: event.runId,
        permissionId: event.permission.id,
        decision: "approved",
      });
    }
    await waitForAsyncEvents();

    expect(emitted.filter((event) => event.type === "completed")).toHaveLength(2);
  });

  it("fails safely instead of surfacing unsupported Kimi ACP permission options", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          transport.emitMessage({
            jsonrpc: "2.0",
            id: "agent-permission-unsupported",
            method: "session/request_permission",
            params: {
              sessionId: "session-1",
              options: [{ optionId: "inspect", name: "Inspect", kind: "inspect" }],
              toolCall: {
                toolCallId: "tool-shell-unsupported",
                title: "Bash",
                content: [
                  {
                    type: "content",
                    content: {
                      type: "text",
                      text: "Requesting approval to Running: pwd",
                    },
                  },
                ],
              },
            },
          });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-unsupported-permission", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(emitted.some((event) => event.type === "permission-requested")).toBe(false);
    expect(
      transports[0]?.sent.find((message) => message.id === "agent-permission-unsupported")?.result,
    ).toEqual({ outcome: { outcome: "cancelled" } });
    const failed = emitted.find((event) => event.type === "failed");
    expect(failed).toMatchObject({
      type: "failed",
      runId: "run-kimi-unsupported-permission",
    });
    expect(failed?.error).toContain("approve/deny");
    expect(transports[0]?.closed).toBe(true);
  });

  it("does not treat session-wide Kimi ACP approval as a one-time approval", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-1" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          transport.emitMessage({
            jsonrpc: "2.0",
            id: "agent-permission-wide",
            method: "session/request_permission",
            params: {
              sessionId: "session-1",
              options: [
                {
                  optionId: "approve_always",
                  name: "Approve for this session",
                  kind: "allow_always",
                },
                { optionId: "reject", name: "Reject", kind: "reject_once" },
              ],
              toolCall: {
                toolCallId: "tool-shell-wide",
                title: "Bash",
                content: [
                  {
                    type: "content",
                    content: {
                      type: "text",
                      text: "Requesting approval to Running: pwd",
                    },
                  },
                ],
              },
            },
          });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-wide-permission", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(emitted.some((event) => event.type === "permission-requested")).toBe(false);
    expect(
      transports[0]?.sent.find((message) => message.id === "agent-permission-wide")?.result,
    ).toEqual({ outcome: { outcome: "cancelled" } });
    expect(emitted.find((event) => event.type === "failed")).toMatchObject({
      type: "failed",
      runId: "run-kimi-wide-permission",
    });
  });

  it("resumes the previous Kimi ACP session for the same thread", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "kimi-session-1" });
        return;
      }

      if (message.method === "session/resume") {
        respondAcp(transport, message, { configOptions: [] });
        return;
      }

      if (message.method === "session/prompt") {
        const turn = transports.indexOf(transport) + 1;
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `Turn ${turn}` },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-session-1", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();
    manager.start("run-kimi-session-2", makeRequest({ runtimeId: "kimi", message: "Follow up" }));
    await waitForAsyncEvents();

    const secondTransport = transports[1];
    expect(secondTransport).toBeDefined();
    expect(
      transports[0]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(
      transports[1]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/resume", "session/prompt"]);
    const resumeRequest = secondTransport!.sent[1];
    const resumedPrompt = secondTransport!.sent[2];
    expect(resumeRequest).toBeDefined();
    expect(resumedPrompt).toBeDefined();
    expect((resumeRequest!.params as { sessionId?: string }).sessionId).toBe("kimi-session-1");
    expect((resumedPrompt!.params as { sessionId?: string }).sessionId).toBe("kimi-session-1");
    expect(emitted.filter((event) => event.type === "failed")).toHaveLength(0);
  });

  it("falls back to a new Kimi ACP session when persisted resume fails", async () => {
    const emitted: ChatRunEvent[] = [];
    const sessionKey = "kimi:project:/Users/onion/workbench/timbre:thread-1";
    const persistedSessions = new Map([[sessionKey, "stale-session"]]);
    const deletedSessions: Array<{ key: string; sessionId?: string }> = [];
    const sessionSets: Array<{ key: string; sessionId: string }> = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/resume") {
        failAcp(transport, message, "Session not found");
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "fresh-session" });
        return;
      }

      if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Recovered" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
      providerSessions: {
        get: (key) => persistedSessions.get(key),
        set: (key, sessionId) => {
          sessionSets.push({ key, sessionId });
          persistedSessions.set(key, sessionId);
        },
        delete: (key, sessionId) => {
          deletedSessions.push({ key, sessionId });
          if (!sessionId || persistedSessions.get(key) === sessionId) {
            persistedSessions.delete(key);
          }
        },
      },
    });

    manager.start("run-kimi-stale-resume", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(
      transports[0]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/resume", "session/new", "session/prompt"]);
    expect(transports[0]?.sent[1]).toMatchObject({
      method: "session/resume",
      params: { sessionId: "stale-session" },
    });
    expect(transports[0]?.sent[3]).toMatchObject({
      method: "session/prompt",
      params: { sessionId: "fresh-session" },
    });
    expect(deletedSessions).toEqual([{ key: sessionKey, sessionId: "stale-session" }]);
    expect(sessionSets).toEqual([{ key: sessionKey, sessionId: "fresh-session" }]);
    expect(persistedSessions.get(sessionKey)).toBe("fresh-session");
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Recovered",
    });
  });

  it("deletes the old persisted session and starts a fresh one for replacement runs", async () => {
    const emitted: ChatRunEvent[] = [];
    const sessionKey = "kimi:project:/Users/onion/workbench/timbre:thread-1";
    const persistedSessions = new Map([[sessionKey, "old-session"]]);
    const deletedSessions: Array<{ key: string; sessionId?: string }> = [];
    const sessionSets: Array<{ key: string; sessionId: string }> = [];
    let promptRequest: JsonMessage | null = null;
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "new-session" });
        return;
      }

      if (message.method === "session/prompt") {
        promptRequest = message;
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Replaced" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
      providerSessions: {
        get: (key) => persistedSessions.get(key),
        set: (key, sessionId) => {
          sessionSets.push({ key, sessionId });
          persistedSessions.set(key, sessionId);
        },
        delete: (key, sessionId) => {
          deletedSessions.push({ key, sessionId });
          if (!sessionId || persistedSessions.get(key) === sessionId) {
            persistedSessions.delete(key);
          }
        },
      },
    });

    manager.start(
      "run-kimi-replace",
      makeRequest({
        runtimeId: "kimi",
        historyMode: "replace",
        message: "Edited message",
        transcript: [
          { role: "user" as const, content: "Before edit" },
          { role: "assistant" as const, content: "Answer" },
        ],
      }),
    );
    await waitForAsyncEvents();

    expect(
      transports[0]?.sent
        .filter((message) => typeof message.method === "string")
        .map((message) => message.method),
    ).toEqual(["initialize", "session/new", "session/prompt"]);
    expect(deletedSessions).toEqual([{ key: sessionKey, sessionId: "old-session" }]);
    expect(sessionSets).toEqual([{ key: sessionKey, sessionId: "new-session" }]);
    expect(persistedSessions.get(sessionKey)).toBe("new-session");
    const prompt = (promptRequest!.params as { prompt: Array<{ text: string }> }).prompt;
    const text = prompt[0].text;
    expect(text).toContain("user: Before edit");
    expect(text).toContain("assistant: Answer");
    expect(text).toContain("user: Edited message");
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Replaced",
    });
  });

  it("stops a replacement run while the old session is still being deleted", async () => {
    const emitted: ChatRunEvent[] = [];
    let resolveDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    const { factory, transports } = createFakeKimiAcpTransportFactory(() => {});
    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
      providerSessions: {
        get: () => "old-session",
        set: () => {},
        delete: async () => {
          await deleteGate;
        },
      },
    });

    manager.start(
      "run-kimi-replace-stop",
      makeRequest({
        runtimeId: "kimi",
        historyMode: "replace",
        message: "Edited message",
      }),
    );
    manager.stop("run-kimi-replace-stop");
    resolveDelete();
    await waitForAsyncEvents();

    expect(transports).toHaveLength(0);
    expect(emitted.find((event) => event.type === "stopped")).toEqual({
      type: "stopped",
      runId: "run-kimi-replace-stop",
      requestKey: undefined,
    });
  });

  it("does not reuse a Kimi ACP session across different threads", async () => {
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        const turn = transports.indexOf(transport) + 1;
        respondAcp(transport, message, { sessionId: `kimi-session-${turn}` });
        return;
      }

      if (message.method === "session/resume") {
        respondAcp(transport, message, { configOptions: [] });
        return;
      }

      if (message.method === "session/prompt") {
        const turn = transports.indexOf(transport) + 1;
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `Turn ${turn}` },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: () => {},
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
    });

    manager.start("run-kimi-thread-a-1", makeRequest({ runtimeId: "kimi", threadId: "thread-a" }));
    await waitForAsyncEvents();
    manager.start("run-kimi-thread-b", makeRequest({ runtimeId: "kimi", threadId: "thread-b" }));
    await waitForAsyncEvents();
    manager.start("run-kimi-thread-a-2", makeRequest({ runtimeId: "kimi", threadId: "thread-a" }));
    await waitForAsyncEvents();

    const resumedTransport = transports[2];
    expect(resumedTransport).toBeDefined();
    expect(transports[0]?.sent[1]?.method).toBe("session/new");
    expect(transports[1]?.sent[1]?.method).toBe("session/new");
    expect(resumedTransport!.sent[1]?.method).toBe("session/resume");
    const resumedSessionRequest = resumedTransport!.sent[1];
    expect(resumedSessionRequest).toBeDefined();
    expect((resumedSessionRequest!.params as { sessionId?: string }).sessionId).toBe(
      "kimi-session-1",
    );
  });

  it("does not persist a Kimi ACP session from a failed run", async () => {
    const sessionSets: Array<{ key: string; sessionId: string }> = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        const turn = transports.indexOf(transport) + 1;
        respondAcp(transport, message, { sessionId: `kimi-session-${turn}` });
        return;
      }

      if (message.method === "session/prompt") {
        const turn = transports.indexOf(transport) + 1;
        if (turn === 1) {
          failAcp(transport, message, "prompt failed");
          return;
        }

        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Recovered" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: () => {},
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
      providerSessions: {
        get: () => undefined,
        set: (key, sessionId) => {
          sessionSets.push({ key, sessionId });
        },
      },
    });

    manager.start("run-kimi-failed-session", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();
    manager.start("run-kimi-after-failed-session", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(transports[0]?.sent[1]?.method).toBe("session/new");
    expect(transports[1]?.sent[1]?.method).toBe("session/new");
    expect(sessionSets).toEqual([
      {
        key: "kimi:project:/Users/onion/workbench/timbre:thread-1",
        sessionId: "kimi-session-2",
      },
    ]);
  });

  it("does not fail or cache a Kimi ACP run when session persistence throws", async () => {
    const emitted: ChatRunEvent[] = [];
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        const turn = transports.indexOf(transport) + 1;
        respondAcp(transport, message, { sessionId: `kimi-session-${turn}` });
        return;
      }

      if (message.method === "session/resume") {
        respondAcp(transport, message, { configOptions: [] });
        return;
      }

      if (message.method === "session/prompt") {
        const turn = transports.indexOf(transport) + 1;
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `Turn ${turn}` },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
      providerSessions: {
        get: () => undefined,
        set: () => {
          throw new Error("store unavailable");
        },
      },
    });

    manager.start("run-kimi-persist-throws-1", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();
    manager.start("run-kimi-persist-throws-2", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();

    expect(emitted.filter((event) => event.type === "failed")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "completed")).toHaveLength(2);
    expect(transports[0]?.sent[1]?.method).toBe("session/new");
    expect(transports[1]?.sent[1]?.method).toBe("session/new");
  });

  it("emits Kimi ACP completion after async session persistence settles", async () => {
    const emitted: ChatRunEvent[] = [];
    let resolvePersistence!: () => void;
    const persistenceSettled = new Promise<void>((resolve) => {
      resolvePersistence = resolve;
    });
    const { factory, transports } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
        return;
      }

      if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "session-async" });
        return;
      }

      if (message.method === "session/resume") {
        respondAcp(transport, message, { configOptions: [] });
        return;
      }

      if (message.method === "session/prompt") {
        const turn = transports.indexOf(transport) + 1;
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `Turn ${turn}` },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });

    const manager = createProductionChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
      providerSessions: {
        get: () => undefined,
        set: async () => {
          await persistenceSettled;
        },
      },
    });

    manager.start("run-kimi-async-persist-1", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();
    expect(emitted.some((event) => event.type === "completed")).toBe(false);

    resolvePersistence();
    await waitForAsyncEvents();
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Turn 1",
    });

    manager.start("run-kimi-async-persist-2", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();
    const resumeRequest = transports[1]?.sent[1];
    expect(resumeRequest?.method).toBe("session/resume");
    expect((resumeRequest!.params as { sessionId?: string }).sessionId).toBe("session-async");
  });

  it("checks Kimi session status without starting Carrent Bridge", async () => {
    let bridgeCalls = 0;
    const transport = new FakeKimiAcpTransport(
      "/Users/onion/workbench/timbre",
      (fakeTransport, message) => {
        if (message.method === "initialize") {
          queueMicrotask(() => respondAcp(fakeTransport, message, { protocolVersion: 1 }));
          return;
        }

        if (message.method === "session/resume") {
          queueMicrotask(() => respondAcp(fakeTransport, message, { sessionId: "session-status" }));
          return;
        }

        if (message.method === "session/prompt") {
          queueMicrotask(() => {
            emitAcpUpdate(fakeTransport, {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: "Session status:\n- Model: kimi-code/kimi-for-coding\n- Thinking: on\n- Permission: manual\n- Plan mode: off\n- Context: 21,169 / 262,144 (8.1%)",
              },
            });
            respondAcp(fakeTransport, message, { stopReason: "end_turn" });
          });
        }
      },
    );

    const manager = createProductionChatSessionManager({
      emit: () => {},
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: () => transport,
      carrentBridgeFactory: async () => {
        bridgeCalls += 1;
        throw new Error("Bridge should not start for status checks.");
      },
      providerSessions: {
        get: () => "session-status",
        set: () => {},
      },
    });

    expect(await manager.getStatus(makeRequest({ runtimeId: "kimi" }))).toEqual({
      model: "kimi-code/kimi-for-coding",
      used: 21169,
      total: 262144,
      percentage: 8.1,
    });
    expect(bridgeCalls).toBe(0);
    expect(transport.sent.map((message) => message.method)).toEqual([
      "initialize",
      "session/resume",
      "session/prompt",
    ]);
    expect((transport.sent[1]!.params as { mcpServers?: unknown[] }).mcpServers).toEqual([]);
  });

  it("emits a clear failure for legacy runtimes without spawning", async () => {
    let spawnCalled = false;
    const emitted: ChatRunEvent[] = [];

    const manager = createProductionChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => {
        spawnCalled = true;
        return createMockChildProcess();
      },
    });

    manager.start("run-legacy", makeRequest({ runtimeId: "codex" }));

    const failed = emitted.find((e) => e.type === "failed");
    expect(failed).toBeDefined();
    expect(failed?.error).toContain("unavailable in Carrent V1");
    expect(spawnCalled).toBe(false);
  });

  it("accepts projectless chat requests", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];
    const spawnCalls: Array<{
      command: string;
      args: string[];
      options: { cwd: string };
    }> = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: (command, args, options) => {
        spawnCalls.push({ command, args, options: options as { cwd: string } });
        return mockChild;
      },
    });

    manager.start("run-chat", makeRequest({ workspace: { kind: "chat" } }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(emitted.some((event) => event.type === "failed")).toBe(false);
    expect(spawnCalls[0]?.options.cwd).toContain("carrent-chat");
  });

  it("separates provider session keys for project and chat scopes", async () => {
    const project = makeRequest({
      workspace: {
        kind: "project",
        projectId: "carrent",
        projectPath: "/Users/onion/workbench/carrent",
      },
    });
    const chat = makeRequest({ workspace: { kind: "chat" } });

    const emitted: ChatRunEvent[] = [];
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const children = [firstChild, secondChild];
    const sessionSets: Array<{ key: string; sessionId: string }> = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => {
        const child = children.shift();
        if (!child) {
          throw new Error("missing mock child");
        }
        return child;
      },
      providerSessions: {
        get: () => undefined,
        set: (key, sessionId) => {
          sessionSets.push({ key, sessionId });
        },
      },
    });

    manager.start("run-proj", { ...project, runtimeId: "claude-code" });
    firstChild.stdout.emit(
      "data",
      Buffer.from(
        [
          '{"type":"system","subtype":"init","session_id":"sess-proj"}',
          '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hi"}}}',
        ].join("\n") + "\n",
      ),
    );
    firstChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    manager.start("run-chat2", { ...chat, runtimeId: "claude-code" });
    secondChild.stdout.emit(
      "data",
      Buffer.from(
        [
          '{"type":"system","subtype":"init","session_id":"sess-chat"}',
          '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hello"}}}',
        ].join("\n") + "\n",
      ),
    );
    secondChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sessionSets).toHaveLength(2);
    expect(sessionSets[0].key).not.toBe(sessionSets[1].key);
  });

  it("normalizes non-zero exit with stderr", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-6", makeRequest());
    mockChild.stderr.emit("data", Buffer.from("Out of credits"));
    mockChild.emit("close", 1, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const failed = emitted.find((e) => e.type === "failed");
    expect(failed).toBeDefined();
    expect(failed?.error).toContain("Runtime returned an error");
    expect(failed?.error).toContain("Out of credits");
  });

  it("emits thread-upserted before started for a draft-first message", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start(
      "run-7",
      makeRequest({
        threadId: "thread-promoted",
        draftRef: {
          draftId: "draft-1",
          projectId: "project-1",
          title: "New Draft Thread",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(emitted[0]).toMatchObject({
      type: "thread-upserted",
      runId: "run-7",
      draftId: "draft-1",
      projectId: "project-1",
      thread: {
        id: "thread-promoted",
        title: "New Draft Thread",
      },
    });
    expect(emitted[1]).toMatchObject({
      type: "started",
      runId: "run-7",
      threadId: "thread-promoted",
    });
  });

  it("emits promoted draft threads with the request runtime mode", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start(
      "run-draft-mode",
      makeRequest({
        runtimeMode: "auto-accept-edits",
        draftRef: {
          draftId: "draft-1",
          projectId: "p1",
          title: "Draft title",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const upserted = emitted.find((event) => event.type === "thread-upserted");
    expect(upserted?.thread.runtimeMode).toBe("auto-accept-edits");
  });

  it("emits promoted draft threads with the request runtime", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start(
      "run-draft-runtime",
      makeRequest({
        runtimeId: "claude-code",
        draftRef: {
          draftId: "draft-1",
          projectId: "p1",
          title: "Draft title",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const upserted = emitted.find((event) => event.type === "thread-upserted");
    expect(upserted?.thread.runtimeId).toBe("claude-code");
  });

  it("emits promoted draft threads with the request runtime model", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start(
      "run-draft-model",
      makeRequest({
        runtimeId: "pi",
        runtimeModelId: "deepseek/deepseek-v4-flash",
        draftRef: {
          draftId: "draft-1",
          projectId: "p1",
          title: "Draft title",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const upserted = emitted.find((event) => event.type === "thread-upserted");
    expect(upserted?.thread.runtimeModelId).toBe("deepseek/deepseek-v4-flash");
  });

  it("does not emit thread-upserted for a normal real-thread message", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-8", makeRequest());

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(emitted.some((event) => event.type === "thread-upserted")).toBe(false);
    expect(emitted[0]).toMatchObject({
      type: "started",
      runId: "run-8",
      threadId: "thread-1",
    });
  });

  it("emits claude text deltas before completed", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-stream-order", makeRequest({ runtimeId: "claude-code" }));
    mockChild.stdout.emit(
      "data",
      Buffer.from(
        [
          '{"type":"system","subtype":"init","session_id":"sess-stream-order"}',
          '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hel"}}}',
          '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"lo"}}}',
        ].join("\n") + "\n",
      ),
    );
    mockChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const eventTypes = emitted.map((event) => event.type);
    expect(eventTypes.indexOf("delta")).toBeGreaterThan(-1);
    expect(eventTypes.indexOf("completed")).toBeGreaterThan(-1);
    expect(eventTypes.indexOf("delta")).toBeLessThan(eventTypes.indexOf("completed"));
  });

  it("emits claude thinking deltas as reasoning events", async () => {
    const emitted: ChatRunEvent[] = [];
    const child = createMockChildProcess();
    const manager = createChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => child,
    });

    manager.start("run-claude-thinking", makeRequest({ runtimeId: "claude-code" }));

    child.stdout?.emit(
      "data",
      Buffer.from(
        [
          '{"type":"system","subtype":"init","session_id":"sess-thinking"}',
          '{"type":"stream_event","event":{"delta":{"type":"thinking_delta","thinking":"Need to inspect"}}}',
          '{"type":"stream_event","event":{"delta":{"type":"thinking_delta","thinking":" files"}}}',
          '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Done"}}}',
        ].join("\n") + "\n",
      ),
    );
    child.emit("close", 0, null);

    expect(emitted.filter((event) => event.type === "reasoning")).toEqual([
      {
        type: "reasoning",
        runId: "run-claude-thinking",
        reasoning: {
          id: "claude-thinking",
          content: "Need to inspect",
          status: "running",
        },
      },
      {
        type: "reasoning",
        runId: "run-claude-thinking",
        reasoning: {
          id: "claude-thinking",
          content: "Need to inspect files",
          status: "running",
        },
      },
      {
        type: "reasoning",
        runId: "run-claude-thinking",
        reasoning: {
          id: "claude-thinking",
          content: "Need to inspect files",
          status: "completed",
        },
      },
    ]);
  });

  it("emits codex reasoning items as reasoning events", async () => {
    const emitted: ChatRunEvent[] = [];
    const child = createMockChildProcess();
    const manager = createChatSessionManager({
      emit: (event) => emitted.push(event),
      spawn: () => child,
    });

    manager.start("run-codex-reasoning", makeRequest());

    child.stdout?.emit(
      "data",
      Buffer.from(
        [
          '{"type":"item.completed","item":{"id":"rs_1","type":"reasoning","summary":[{"type":"summary_text","text":"Need to inspect files"}]}}',
          '{"type":"item.completed","item":{"id":"msg_1","type":"agent_message","text":"Done"}}',
        ].join("\n") + "\n",
      ),
    );
    child.emit("close", 0, null);

    expect(emitted.filter((event) => event.type === "reasoning")).toEqual([
      {
        type: "reasoning",
        runId: "run-codex-reasoning",
        reasoning: {
          id: "rs_1",
          content: "Need to inspect files",
          status: "completed",
        },
      },
    ]);
  });

  it("emits codex command executions as shell events", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-codex-shell", makeRequest());
    mockChild.stdout.emit(
      "data",
      Buffer.from(
        [
          '{"type":"item.started","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"","exit_code":null,"status":"in_progress"}}',
          '{"type":"item.completed","item":{"id":"item_0","type":"command_execution","command":"/bin/zsh -lc pwd","aggregated_output":"/Users/onion/workbench/carrent\\n","exit_code":0,"status":"completed"}}',
          '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Done"}}',
        ].join("\n") + "\n",
      ),
    );
    mockChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(emitted.filter((event) => event.type === "delta")).toHaveLength(1);
    expect(emitted.filter((event) => event.type === "shell")).toEqual([
      {
        type: "shell",
        runId: "run-codex-shell",
        shell: {
          id: "item_0",
          command: "/bin/zsh -lc pwd",
          output: "",
          status: "running",
          exitCode: null,
        },
      },
      {
        type: "shell",
        runId: "run-codex-shell",
        shell: {
          id: "item_0",
          command: "/bin/zsh -lc pwd",
          output: "/Users/onion/workbench/carrent\n",
          status: "completed",
          exitCode: 0,
        },
      },
    ]);
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Done",
    });
  });

  it("emits claude Bash tool use and result as shell events", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-claude-shell", makeRequest({ runtimeId: "claude-code" }));
    mockChild.stdout.emit(
      "data",
      Buffer.from(
        [
          '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_1","name":"Bash","input":{"command":"pwd"}}]},"session_id":"sess-shell"}',
          '{"type":"user","message":{"content":[{"tool_use_id":"call_1","type":"tool_result","content":"/Users/onion/workbench/carrent","is_error":false}]},"tool_use_result":{"stdout":"/Users/onion/workbench/carrent","stderr":"","interrupted":false}}',
          '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Done"}}}',
        ].join("\n") + "\n",
      ),
    );
    mockChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(emitted.filter((event) => event.type === "shell")).toEqual([
      {
        type: "shell",
        runId: "run-claude-shell",
        shell: {
          id: "call_1",
          command: "pwd",
          output: "",
          status: "running",
        },
      },
      {
        type: "shell",
        runId: "run-claude-shell",
        shell: {
          id: "call_1",
          command: "pwd",
          output: "/Users/onion/workbench/carrent",
          status: "completed",
        },
      },
    ]);
  });

  it("emits permission-failed when Claude emits permission denial tool_result", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-perm-denial", makeRequest({ runtimeId: "claude-code" }));
    mockChild.stdout.emit(
      "data",
      Buffer.from(
        [
          '{"type":"assistant","message":{"content":[{"type":"tool_use","id":"call_1","name":"Edit","input":{"file_path":"/tmp/demo.txt"}}]},"session_id":"sess-perm"}',
          '{"type":"user","message":{"content":[{"tool_use_id":"call_1","type":"tool_result","content":"Claude requested permissions to write to /tmp/demo.txt, but you haven\'t granted it yet.","is_error":true}]}}',
        ].join("\n") + "\n",
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    const permissionFailed = emitted.find((e) => e.type === "permission-failed");
    expect(permissionFailed).toBeDefined();
    expect(permissionFailed?.runId).toBe("run-perm-denial");
    expect(permissionFailed?.error).toContain("not support");
  });

  it("terminates the Claude child after a permission denial without emitting follow-up events", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-perm-terminal", makeRequest({ runtimeId: "claude-code" }));
    mockChild.stdout.emit(
      "data",
      Buffer.from(
        '{"type":"user","message":{"content":[{"tool_use_id":"call_1","type":"tool_result","content":"Claude requested permissions to write to /tmp/demo.txt, but you haven\'t granted it yet.","is_error":true}]}}\n',
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(mockChild.killed).toBe(true);
    expect(emitted.filter((e) => e.type === "permission-failed")).toHaveLength(1);
    expect(emitted.some((e) => e.type === "failed" || e.type === "stopped")).toBe(false);
  });

  it("parses claude stream-json into text deltas and final text", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-9", makeRequest({ runtimeId: "claude-code" }));

    mockChild.stdout.emit(
      "data",
      Buffer.from(
        '{"type":"system","subtype":"init","session_id":"sess-1"}\n{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hel',
      ),
    );
    mockChild.stdout.emit(
      "data",
      Buffer.from(
        'lo"}}}\n{"type":"stream_event","event":{"delta":{"type":"text_delta","text":" world"}}}\n',
      ),
    );
    mockChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    const deltas = emitted.filter((e) => e.type === "delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ type: "delta", text: "Hello" });
    expect(deltas[1]).toMatchObject({ type: "delta", text: " world" });

    const completed = emitted.find((e) => e.type === "completed");
    expect(completed).toMatchObject({
      type: "completed",
      runId: "run-9",
      text: "Hello world",
    });
  });

  it("passes verbose when using claude stream-json output", async () => {
    const mockChild = createMockChildProcess();
    let capturedArgs: string[] = [];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        capturedArgs = args;
        return mockChild;
      },
    });

    manager.start("run-claude-verbose", makeRequest({ runtimeId: "claude-code" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--output-format");
    expect(capturedArgs).toContain("stream-json");
    expect(capturedArgs).toContain("--verbose");
  });

  it("resumes the previous claude session for the same thread", async () => {
    const emitted: ChatRunEvent[] = [];
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const spawnCalls: Array<{
      command: string;
      args: string[];
      cwd: string;
    }> = [];
    const children = [firstChild, secondChild];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: (command, args, options) => {
        spawnCalls.push({
          command,
          args,
          cwd: options.cwd,
        });
        const child = children.shift();
        if (!child) {
          throw new Error("missing mock child");
        }
        return child;
      },
    });

    manager.start("run-10", makeRequest({ runtimeId: "claude-code" }));
    firstChild.stdout.emit(
      "data",
      Buffer.from('{"type":"system","subtype":"init","session_id":"sess-abc"}\n'),
    );
    firstChild.stdout.emit(
      "data",
      Buffer.from('{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hi"}}}\n'),
    );
    firstChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    manager.start(
      "run-11",
      makeRequest({
        runtimeId: "claude-code",
        message: "Follow up",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0]?.command).toBe("claude");
    expect(spawnCalls[0]?.args).toContain("--output-format");
    expect(spawnCalls[0]?.args).toContain("stream-json");
    expect(spawnCalls[1]?.args).toContain("--resume");
    expect(spawnCalls[1]?.args).toContain("sess-abc");
    expect(emitted.some((event) => event.type === "failed")).toBe(false);
  });

  it("reuses a claude session for the same runtime, scope, and thread", async () => {
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const spawnCalls: string[][] = [];
    const children = [firstChild, secondChild];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        spawnCalls.push(args);
        const child = children.shift();
        if (!child) {
          throw new Error("missing mock child");
        }
        return child;
      },
    });

    manager.start("run-12", makeRequest({ runtimeId: "claude-code" }));
    firstChild.stdout.emit(
      "data",
      Buffer.from('{"type":"system","subtype":"init","session_id":"sess-architect"}\n'),
    );
    firstChild.stdout.emit(
      "data",
      Buffer.from('{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hi"}}}\n'),
    );
    firstChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    manager.start("run-13", makeRequest({ runtimeId: "claude-code" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[1]).toContain("--resume");
    expect(spawnCalls[1]).toContain("sess-architect");
  });

  it("does not remember a claude session from a failed run", async () => {
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const spawnCalls: string[][] = [];
    const children = [firstChild, secondChild];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        spawnCalls.push(args);
        const child = children.shift();
        if (!child) {
          throw new Error("missing mock child");
        }
        return child;
      },
    });

    manager.start("run-14", makeRequest({ runtimeId: "claude-code" }));
    firstChild.stdout.emit(
      "data",
      Buffer.from('{"type":"system","subtype":"init","session_id":"sess-failed"}\n'),
    );
    firstChild.stderr.emit("data", Buffer.from("No credits"));
    firstChild.emit("close", 1, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    manager.start("run-15", makeRequest({ runtimeId: "claude-code" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[1]).not.toContain("--resume");
    expect(spawnCalls[1]).not.toContain("sess-failed");
  });

  it("retries claude with transcript when resume fails", async () => {
    const firstChild = createMockChildProcess();
    const resumedChild = createMockChildProcess();
    const retryChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];
    const spawnCalls: string[][] = [];
    const children = [firstChild, resumedChild, retryChild];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: (_command, args) => {
        spawnCalls.push(args);
        const child = children.shift();
        if (!child) {
          throw new Error("missing mock child");
        }
        return child;
      },
    });

    manager.start("run-16", makeRequest({ runtimeId: "claude-code" }));
    firstChild.stdout.emit(
      "data",
      Buffer.from('{"type":"system","subtype":"init","session_id":"sess-old"}\n'),
    );
    firstChild.stdout.emit(
      "data",
      Buffer.from('{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hi"}}}\n'),
    );
    firstChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    manager.start(
      "run-17",
      makeRequest({
        runtimeId: "claude-code",
        transcript: [{ role: "user", content: "Earlier question" }],
        message: "Follow up",
      }),
    );
    resumedChild.stderr.emit("data", Buffer.from("Could not resume session"));
    resumedChild.emit("close", 1, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    retryChild.stdout.emit(
      "data",
      Buffer.from('{"type":"system","subtype":"init","session_id":"sess-new"}\n'),
    );
    retryChild.stdout.emit(
      "data",
      Buffer.from(
        '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Recovered"}}}\n',
      ),
    );
    retryChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(spawnCalls).toHaveLength(3);
    expect(spawnCalls[1]).toContain("--resume");
    expect(spawnCalls[1]).toContain("sess-old");
    expect(spawnCalls[1].join("\n")).not.toContain("Earlier question");
    expect(spawnCalls[2]).not.toContain("--resume");
    expect(spawnCalls[2].join("\n")).toContain("Earlier question");
    expect(emitted.find((event) => event.type === "failed")).toBeUndefined();
    expect(emitted.filter((event) => event.type === "completed").at(-1)).toMatchObject({
      type: "completed",
      text: "Recovered",
    });
  });

  it("uses claude final assistant text when partial deltas are absent", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-18", makeRequest({ runtimeId: "claude-code" }));
    mockChild.stdout.emit(
      "data",
      Buffer.from(
        [
          '{"type":"system","subtype":"init","session_id":"sess-final"}',
          '{"type":"assistant","message":{"content":[{"type":"text","text":"Final answer"}]}}',
        ].join("\n") + "\n",
      ),
    );
    mockChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(emitted.filter((event) => event.type === "delta")).toHaveLength(0);
    expect(emitted.find((event) => event.type === "completed")).toMatchObject({
      type: "completed",
      text: "Final answer",
    });
  });

  it("calls provider session set when claude returns a session_id", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];
    const sessionSets: Array<{ key: string; sessionId: string }> = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
      providerSessions: {
        get: () => undefined,
        set: (key, sessionId) => {
          sessionSets.push({ key, sessionId });
        },
      },
    });

    manager.start("run-session-persist", makeRequest({ runtimeId: "claude-code" }));
    mockChild.stdout.emit(
      "data",
      Buffer.from(
        [
          '{"type":"system","subtype":"init","session_id":"sess-persist-1"}',
          '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hi"}}}',
        ].join("\n") + "\n",
      ),
    );
    mockChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sessionSets).toHaveLength(1);
    expect(sessionSets[0]).toEqual({
      key: "claude-code:project:/Users/onion/workbench/timbre:thread-1",
      sessionId: "sess-persist-1",
    });
  });

  it("uses persisted session id for claude resume on next request", async () => {
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const spawnCalls: string[][] = [];
    const children = [firstChild, secondChild];
    const persistedSessions = new Map<string, string>();

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        spawnCalls.push(args);
        const child = children.shift();
        if (!child) {
          throw new Error("missing mock child");
        }
        return child;
      },
      providerSessions: {
        get: (key) => persistedSessions.get(key),
        set: (key, sessionId) => {
          persistedSessions.set(key, sessionId);
        },
      },
    });

    manager.start("run-first", makeRequest({ runtimeId: "claude-code" }));
    firstChild.stdout.emit(
      "data",
      Buffer.from('{"type":"system","subtype":"init","session_id":"sess-resume"}\n'),
    );
    firstChild.stdout.emit(
      "data",
      Buffer.from('{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Hi"}}}\n'),
    );
    firstChild.emit("close", 0, null);

    await new Promise((resolve) => setTimeout(resolve, 10));

    manager.start("run-second", makeRequest({ runtimeId: "claude-code" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[0]).not.toContain("--resume");
    expect(spawnCalls[1]).toContain("--resume");
    expect(spawnCalls[1]).toContain("sess-resume");
  });

  it("passes read-only sandbox for approval-required codex runs", async () => {
    const mockChild = createMockChildProcess();
    let capturedArgs: string[] = [];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        capturedArgs = args;
        return mockChild;
      },
    });

    manager.start(
      "run-sandbox-ro",
      makeRequest({ runtimeId: "codex", runtimeMode: "approval-required" }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--sandbox");
    expect(capturedArgs).toContain("read-only");
    expect(capturedArgs).toContain("-c");
    expect(capturedArgs).toContain('approval_policy="on-request"');
    expect(capturedArgs).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("passes workspace-write sandbox for auto-accept codex runs", async () => {
    const mockChild = createMockChildProcess();
    let capturedArgs: string[] = [];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        capturedArgs = args;
        return mockChild;
      },
    });

    manager.start(
      "run-sandbox-ww",
      makeRequest({ runtimeId: "codex", runtimeMode: "auto-accept-edits" }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--sandbox");
    expect(capturedArgs).toContain("workspace-write");
    expect(capturedArgs).toContain("-c");
    expect(capturedArgs).toContain('approval_policy="on-request"');
  });

  it("passes dangerous bypass only for full-access codex runs", async () => {
    const mockChild = createMockChildProcess();
    let capturedArgs: string[] = [];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        capturedArgs = args;
        return mockChild;
      },
    });

    manager.start(
      "run-sandbox-full",
      makeRequest({ runtimeId: "codex", runtimeMode: "full-access" }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("passes claude permission mode for non-full-access runs", async () => {
    const mockChild = createMockChildProcess();
    let capturedArgs: string[] = [];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        capturedArgs = args;
        return mockChild;
      },
    });

    manager.start(
      "run-perm-auto",
      makeRequest({ runtimeId: "claude-code", runtimeMode: "auto-accept-edits" }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--permission-mode");
    expect(capturedArgs).toContain("acceptEdits");
  });

  it("passes claude dangerous skip only for full-access runs", async () => {
    const mockChild = createMockChildProcess();
    let capturedArgs: string[] = [];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        capturedArgs = args;
        return mockChild;
      },
    });

    manager.start(
      "run-perm-full",
      makeRequest({ runtimeId: "claude-code", runtimeMode: "full-access" }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--dangerously-skip-permissions");
  });

  it("does not run codex without an explicit sandbox mode", async () => {
    const mockChild = createMockChildProcess();
    let capturedArgs: string[] = [];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        capturedArgs = args;
        return mockChild;
      },
    });

    manager.start("run-safety-default", makeRequest({ runtimeId: "codex" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--sandbox");
    expect(capturedArgs).toContain("-c");
    expect(capturedArgs).toContain('approval_policy="on-request"');
  });

  it("does not run claude without an explicit permission mode unless full access is selected", async () => {
    const mockChild = createMockChildProcess();
    let capturedArgs: string[] = [];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (_command, args) => {
        capturedArgs = args;
        return mockChild;
      },
    });

    manager.start("run-safety-claude", makeRequest({ runtimeId: "claude-code" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--permission-mode");
    expect(capturedArgs).not.toContain("--dangerously-skip-permissions");
  });

  it("passes selected pi model to spawned pi sessions", async () => {
    const mockChild = createMockChildProcess();
    let capturedCommand = "";
    let capturedArgs: string[] = [];

    const manager = createChatSessionManager({
      emit: () => {},
      spawn: (command, args) => {
        capturedCommand = command;
        capturedArgs = args;
        return mockChild;
      },
    });

    manager.start(
      "run-pi-model",
      makeRequest({
        runtimeId: "pi",
        runtimeModelId: "deepseek/deepseek-v4-flash",
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedCommand).toBe("pi");
    expect(capturedArgs.slice(0, 3)).toEqual(["--model", "deepseek/deepseek-v4-flash", "-p"]);
  });

  it("emits permission-failed for unknown permission responses", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-perm-unknown", makeRequest());
    await new Promise((resolve) => setTimeout(resolve, 10));

    manager.respondToPermission({
      runId: "run-perm-unknown",
      permissionId: "perm-missing",
      decision: "approved",
    });

    const failed = emitted.find((e) => e.type === "permission-failed");
    expect(failed).toBeDefined();
    expect(failed).toMatchObject({
      type: "permission-failed",
      runId: "run-perm-unknown",
      permissionId: "perm-missing",
    });
    // Since no provider supports interactive approval in current CLI modes,
    // all permission responses emit the unsupported message
    expect(failed?.error).toContain("not support");
  });

  it("emits permission-failed for unknown runId", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-other", makeRequest());
    await new Promise((resolve) => setTimeout(resolve, 10));

    manager.respondToPermission({
      runId: "run-nonexistent",
      permissionId: "perm-1",
      decision: "denied",
    });

    const failed = emitted.find((e) => e.type === "permission-failed");
    expect(failed).toBeDefined();
    // No session found = "not found" message
    expect(failed?.error).toContain("not found");
  });

  it("cleans up pending permissions when a run is stopped", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-stop-cleanup", makeRequest());
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Stop the run - any pending permissions should be cleaned up
    manager.stop("run-stop-cleanup");
    await new Promise((resolve) => setTimeout(resolve, 10));

    // After stopping, responding to a permission should fail because session is gone
    manager.respondToPermission({
      runId: "run-stop-cleanup",
      permissionId: "perm-any",
      decision: "approved",
    });

    const failed = emitted.find((e) => e.type === "permission-failed");
    expect(failed).toBeDefined();
    // Session is gone after stop, so "not found"
    expect(failed?.error).toContain("not found");
  });

  it("deletes sessions and attachments while stopping only runs owned by the thread", async () => {
    const deletedProviderThreads: string[][] = [];
    const deletedAttachments: string[][] = [];
    const firstChild = createMockChildProcess();
    const secondChild = createMockChildProcess();
    const children = [firstChild, secondChild];
    const providerSessions = new Map([
      ["kimi:project:/tmp/project:thread-1", "kimi-session"],
      ["claude-code:chat:thread-1", "claude-session"],
      ["kimi:chat:thread-2", "unrelated-session"],
    ]);
    const manager = createChatSessionManager({
      emit: () => {},
      spawn: () => children.shift()!,
      providerSessions: {
        get: (key) => providerSessions.get(key),
        set: (key, sessionId) => {
          providerSessions.set(key, sessionId);
        },
        deleteThreads: (threadIds) => {
          deletedProviderThreads.push(threadIds);
          for (const key of providerSessions.keys()) {
            if (threadIds.some((threadId) => key.endsWith(`:${threadId}`))) {
              providerSessions.delete(key);
            }
          }
        },
      },
      attachmentStore: {
        storeAttachment: async () => {
          throw new Error("not used");
        },
        readAttachment: async () => new Uint8Array(),
        resolvePath: (key) => `/tmp/attachments/${key}`,
        deleteAttachments: async (keys) => {
          deletedAttachments.push(keys);
        },
      },
    });

    manager.start("run-owned", makeRequest({ threadId: "thread-1" }));
    manager.start("run-unrelated", makeRequest({ threadId: "thread-2" }));
    await manager.deleteThreadData({
      threadIds: ["thread-1"],
      attachmentStorageKeys: ["attachment.png"],
    });

    expect(firstChild.killed).toBe(true);
    expect(secondChild.killed).toBe(false);
    expect(deletedProviderThreads).toEqual([["thread-1"]]);
    expect(providerSessions.has("kimi:project:/tmp/project:thread-1")).toBe(false);
    expect(providerSessions.has("claude-code:chat:thread-1")).toBe(false);
    expect(providerSessions.get("kimi:chat:thread-2")).toBe("unrelated-session");
    expect(deletedAttachments).toEqual([["attachment.png"]]);
  });

  it("does not persist a Claude session after its thread is deleted", async () => {
    const child = createMockChildProcess();
    const persisted: Array<{ key: string; sessionId: string }> = [];
    const manager = createChatSessionManager({
      emit: () => {},
      spawn: () => child,
      providerSessions: {
        get: () => undefined,
        set: (key, sessionId) => {
          persisted.push({ key, sessionId });
        },
        deleteThreads: () => {},
      },
    });

    manager.start("run-late-claude", makeRequest({ runtimeId: "claude-code" }));
    child.stdout.emit(
      "data",
      Buffer.from(
        [
          '{"type":"system","subtype":"init","session_id":"late-session"}',
          '{"type":"stream_event","event":{"delta":{"type":"text_delta","text":"Late"}}}',
        ].join("\n") + "\n",
      ),
    );
    await manager.deleteThreadData({ threadIds: ["thread-1"], attachmentStorageKeys: [] });
    await waitForAsyncEvents();

    expect(persisted).toHaveLength(0);
  });

  it("removes a Kimi session whose save completes after thread deletion", async () => {
    let resolveSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      resolveSave = resolve;
    });
    let saveStarted = false;
    const persisted = new Map<string, string>();
    const deletedProviderThreads: string[][] = [];
    const { factory } = createFakeKimiAcpTransportFactory((transport, message) => {
      if (message.method === "initialize") {
        respondAcp(transport, message, { protocolVersion: 1 });
      } else if (message.method === "session/new") {
        respondAcp(transport, message, { sessionId: "late-kimi-session" });
      } else if (message.method === "session/prompt") {
        queueMicrotask(() => {
          emitAcpUpdate(transport, {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Late" },
          });
          respondAcp(transport, message, { stopReason: "end_turn" });
        });
      }
    });
    const manager = createProductionChatSessionManager({
      emit: () => {},
      spawn: () => {
        throw new Error("Kimi ACP should use the transport factory");
      },
      kimiAcpTransportFactory: factory,
      providerSessions: {
        get: (key) => persisted.get(key),
        set: async (key, sessionId) => {
          saveStarted = true;
          await saveGate;
          persisted.set(key, sessionId);
        },
        deleteThreads: (threadIds) => {
          deletedProviderThreads.push(threadIds);
          for (const key of persisted.keys()) {
            if (threadIds.some((threadId) => key.endsWith(`:${threadId}`))) {
              persisted.delete(key);
            }
          }
        },
      },
    });

    manager.start("run-late-kimi", makeRequest({ runtimeId: "kimi" }));
    await waitForAsyncEvents();
    expect(saveStarted).toBe(true);

    await manager.deleteThreadData({ threadIds: ["thread-1"], attachmentStorageKeys: [] });
    resolveSave();
    await waitForAsyncEvents();

    expect(persisted.size).toBe(0);
    expect(deletedProviderThreads).toEqual([["thread-1"], ["thread-1"]]);
  });
});
