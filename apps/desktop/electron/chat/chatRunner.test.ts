import { describe, it, expect } from "bun:test";
import { createChatRunner, getRuntimeCommand } from "./chatRunner";
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

  describe("getRuntimeCommand", () => {
    it("maps approval-required to codex read-only sandbox", () => {
      const { args } = getRuntimeCommand("codex", "prompt", "approval-required");
      expect(args).toContain("--sandbox");
      expect(args).toContain("read-only");
      expect(args).toContain("-c");
      expect(args).toContain('approval_policy="on-request"');
    });

    it("maps auto-accept-edits to codex workspace-write sandbox", () => {
      const { args } = getRuntimeCommand("codex", "prompt", "auto-accept-edits");
      expect(args).toContain("--sandbox");
      expect(args).toContain("workspace-write");
      expect(args).toContain("-c");
      expect(args).toContain('approval_policy="on-request"');
    });

    it("maps full-access to codex dangerous bypass", () => {
      const { args } = getRuntimeCommand("codex", "prompt", "full-access");
      expect(args).toContain("--dangerously-bypass-approvals-and-sandbox");
    });

    it("maps approval-required to claude default permission mode", () => {
      const { args } = getRuntimeCommand("claude-code", "prompt", "approval-required");
      expect(args).toContain("--permission-mode");
      expect(args).toContain("default");
    });

    it("maps auto-accept-edits to claude acceptEdits permission mode", () => {
      const { args } = getRuntimeCommand("claude-code", "prompt", "auto-accept-edits");
      expect(args).toContain("--permission-mode");
      expect(args).toContain("acceptEdits");
    });

    it("maps full-access to claude dangerous skip", () => {
      const { args } = getRuntimeCommand("claude-code", "prompt", "full-access");
      expect(args).toContain("--dangerously-skip-permissions");
    });

    it("defaults codex to sandbox mode", () => {
      const { args } = getRuntimeCommand("codex", "prompt");
      expect(args).toContain("--sandbox");
      expect(args).toContain("read-only");
      expect(args).toContain("-c");
      expect(args).toContain('approval_policy="on-request"');
    });

    it("defaults claude to permission mode", () => {
      const { args } = getRuntimeCommand("claude-code", "prompt");
      expect(args).toContain("--permission-mode");
      expect(args).toContain("default");
    });
  });
});
