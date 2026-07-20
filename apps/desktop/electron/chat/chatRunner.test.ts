import { describe, it, expect } from "bun:test";
import {
  createChatRunner as createProductionChatRunner,
  getRuntimeCommand as getProductionRuntimeCommand,
} from "./chatRunner";
import type { ProcessRunner, ProcessRunnerResult } from "../runtime/processRunner";
import type { ChatTurnRequest } from "../../src/shared/chat";
import type { RuntimeId } from "../../src/shared/runtimes";
import type { RuntimeMode } from "../../src/shared/runtimeMode";

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
    planMode: false,
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

function createChatRunner(processRunner: ProcessRunner) {
  return createProductionChatRunner(processRunner, { allowLegacyRuntimeCommands: true });
}

function getRuntimeCommand(
  runtimeId: RuntimeId,
  prompt: string,
  runtimeMode?: RuntimeMode,
  runtimeModelId?: string,
): ReturnType<typeof getProductionRuntimeCommand> {
  return getProductionRuntimeCommand(runtimeId, prompt, runtimeMode, runtimeModelId, {
    allowLegacyRuntimeCommands: true,
  });
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

  it("returns a clear error when Kimi is sent to the legacy command runner", async () => {
    let called = false;
    const runner: ProcessRunner = {
      run: () => {
        called = true;
        throw new Error("should not run");
      },
    };

    const chatRunner = createChatRunner(runner);
    const result = await chatRunner.run(makeRequest({ runtimeId: "kimi" }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ACP");
    expect(called).toBe(false);
  });

  it("rejects legacy runtimes by default before invoking the process runner", async () => {
    let called = false;
    const runner: ProcessRunner = {
      run: () => {
        called = true;
        throw new Error("should not run");
      },
    };

    const chatRunner = createProductionChatRunner(runner);
    const result = await chatRunner.run(makeRequest({ runtimeId: "codex" }));

    expect(result.ok).toBe(false);
    expect(result.error).toContain("unavailable in Carrent V1");
    expect(called).toBe(false);
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

    it("passes selected pi model to pi", () => {
      expect(
        getRuntimeCommand("pi", "Hello", "approval-required", "deepseek/deepseek-v4-flash"),
      ).toEqual({
        command: "pi",
        args: ["--model", "deepseek/deepseek-v4-flash", "-p", "Hello"],
      });
    });

    it("omits pi model flag when no model is selected", () => {
      expect(getRuntimeCommand("pi", "Hello", "approval-required")).toEqual({
        command: "pi",
        args: ["-p", "Hello"],
      });
    });

    it("does not map Kimi to the legacy command runner", () => {
      let error = "";
      try {
        getProductionRuntimeCommand("kimi", "Hello", "approval-required");
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      expect(error).toContain("ACP");
    });

    it("does not map legacy runtimes by default", () => {
      let error = "";
      try {
        getProductionRuntimeCommand("codex", "Hello", "approval-required");
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      expect(error).toContain("unavailable in Carrent V1");
    });
  });
});
