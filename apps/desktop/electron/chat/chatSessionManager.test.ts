import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { ChatRunEvent, ChatTurnRequest } from "../../src/shared/chat";
import { createChatSessionManager } from "./chatSessionManager";

function makeRequest(overrides: Partial<ChatTurnRequest> = {}): ChatTurnRequest {
  return {
    workspace: {
      kind: "project",
      projectId: "timbre",
      projectPath: "/Users/onion/workbench/timbre",
    },
    threadId: "thread-1",
    runtimeId: "codex",
    agent: {
      id: "architect",
      name: "Architect",
      responsibility: "You are an architect.",
    },
    runtimeMode: "approval-required",
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
      agentId: "architect",
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
    expect(failed?.error).toContain("Agent returned an error");
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
      agentId: "architect",
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
      agentId: "architect",
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

  it("does not reuse a claude session after switching agents", async () => {
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

    manager.start(
      "run-13",
      makeRequest({
        runtimeId: "claude-code",
        agent: {
          id: "reviewer",
          name: "Reviewer",
          responsibility: "You are a reviewer.",
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(spawnCalls).toHaveLength(2);
    expect(spawnCalls[1]).not.toContain("--resume");
    expect(spawnCalls[1]).not.toContain("sess-architect");
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
      key: "claude-code:project:/Users/onion/workbench/timbre:thread-1:architect",
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

    manager.start("run-sandbox-ro", makeRequest({ runtimeId: "codex", runtimeMode: "approval-required" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--sandbox");
    expect(capturedArgs).toContain("read-only");
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

    manager.start("run-sandbox-ww", makeRequest({ runtimeId: "codex", runtimeMode: "auto-accept-edits" }));

    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(capturedArgs).toContain("--sandbox");
    expect(capturedArgs).toContain("workspace-write");
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

    manager.start("run-sandbox-full", makeRequest({ runtimeId: "codex", runtimeMode: "full-access" }));

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

    manager.start("run-perm-auto", makeRequest({ runtimeId: "claude-code", runtimeMode: "auto-accept-edits" }));

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

    manager.start("run-perm-full", makeRequest({ runtimeId: "claude-code", runtimeMode: "full-access" }));

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
});
