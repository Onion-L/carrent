import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { ChatRunEvent, ChatTurnRequest } from "../../src/shared/chat";
import { createChatSessionManager } from "./chatSessionManager";

function makeRequest(
  overrides: Partial<ChatTurnRequest> = {},
): ChatTurnRequest {
  return {
    projectPath: "/Users/onion/workbench/timbre",
    threadId: "thread-1",
    runtimeId: "codex",
    agent: {
      id: "architect",
      name: "Architect",
      responsibility: "You are an architect.",
    },
    transcript: [],
    message: "Hello",
    ...overrides,
  };
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

describe("createChatSessionManager", () => {
  it("emits started, delta, and completed for a successful run", async () => {
    const mockChild = createMockChildProcess();
    const emitted: ChatRunEvent[] = [];

    const manager = createChatSessionManager({
      emit: (evt) => emitted.push(evt),
      spawn: () => mockChild,
    });

    manager.start("run-1", makeRequest());

    // Simulate stdout chunks
    mockChild.stdout.emit("data", Buffer.from("Hello"));
    mockChild.stdout.emit("data", Buffer.from(" world"));

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
      agentId: "architect",
    });

    const deltas = emitted.filter((e) => e.type === "delta");
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ type: "delta", runId: "run-1", text: "Hello" });
    expect(deltas[1]).toMatchObject({ type: "delta", runId: "run-1", text: " world" });

    const completed = emitted.find((e) => e.type === "completed");
    expect(completed).toBeDefined();
    expect(completed).toMatchObject({
      type: "completed",
      runId: "run-1",
      text: "Hello world",
    });
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

    manager.start("run-5", makeRequest({ projectPath: "" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    const failed = emitted.find((e) => e.type === "failed");
    expect(failed).toBeDefined();
    expect(failed?.error).toContain("Project path is missing");
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
    expect(failed?.error).toContain("Agent returned an error");
    expect(failed?.error).toContain("Out of credits");
  });
});
