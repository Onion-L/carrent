import { describe, it, expect } from "bun:test";
import { createChatRunner } from "./chatRunner";
import type { ProcessRunner, ProcessRunnerResult } from "../runtime/processRunner";
import type { ChatTurnRequest } from "../../src/shared/chat";

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

function mockRunner(result: ProcessRunnerResult): ProcessRunner {
  return {
    run: () => Promise.resolve(result),
  };
}

describe("createChatRunner", () => {
  it("codex request uses current project path as cwd", async () => {
    let capturedCwd: string | undefined;
    const runner = mockRunner({
      ok: true,
      exitCode: 0,
      stdout: "Done",
      stderr: "",
      signal: null,
      timedOut: false,
    });
    const customRunner: ProcessRunner = {
      run: (command, args, options) => {
        capturedCwd = options?.cwd;
        return runner.run(command, args, options);
      },
    };

    const chatRunner = createChatRunner(customRunner);
    await chatRunner.run(makeRequest({ runtimeId: "codex" }));
    expect(capturedCwd).toBe("/Users/onion/workbench/timbre");
  });

  it("claude request uses current project path as cwd", async () => {
    let capturedCwd: string | undefined;
    const runner = mockRunner({
      ok: true,
      exitCode: 0,
      stdout: "Done",
      stderr: "",
      signal: null,
      timedOut: false,
    });
    const customRunner: ProcessRunner = {
      run: (command, args, options) => {
        capturedCwd = options?.cwd;
        return runner.run(command, args, options);
      },
    };

    const chatRunner = createChatRunner(customRunner);
    await chatRunner.run(makeRequest({ runtimeId: "claude-code" }));
    expect(capturedCwd).toBe("/Users/onion/workbench/timbre");
  });

  it("timeout becomes a readable error", async () => {
    const runner = mockRunner({
      ok: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      signal: "SIGTERM",
      timedOut: true,
    });

    const chatRunner = createChatRunner(runner);
    const result = await chatRunner.run(makeRequest());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("timed out");
  });

  it("empty stdout becomes a readable error", async () => {
    const runner = mockRunner({
      ok: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
      signal: null,
      timedOut: false,
    });

    const chatRunner = createChatRunner(runner);
    const result = await chatRunner.run(makeRequest());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("non-zero exit becomes a readable error", async () => {
    const runner = mockRunner({
      ok: false,
      exitCode: 1,
      stdout: "",
      stderr: "Something went wrong",
      signal: null,
      timedOut: false,
    });

    const chatRunner = createChatRunner(runner);
    const result = await chatRunner.run(makeRequest());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Something went wrong");
  });
});
