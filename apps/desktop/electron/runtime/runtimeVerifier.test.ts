import { describe, expect, it } from "bun:test";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RuntimeDescriptor } from "../../src/shared/runtimes";
import { cleanupTempWorkspace, createTempWorkspace } from "./tempWorkspace";
import { runLocalCheck, runModelPing } from "./runtimeVerifier";

function createRuntimeDescriptor(): RuntimeDescriptor {
  return {
    id: "codex",
    name: "Codex",
    command: "codex",
    versionArgs: ["--version"],
    configMarkers: ["~/.codex", "~/.config/codex"],
    supportsModelPing: true,
    detection: {
      localCheck: {
        mayUseTokens: false,
      },
    },
    verification: {
      modelPing: {
        prompt: "Reply with exactly OK.",
        mayUseTokens: true,
      },
    },
  };
}

function createClaudeRuntimeDescriptor(): RuntimeDescriptor {
  return {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    configMarkers: ["~/.claude"],
    supportsModelPing: true,
    detection: {
      localCheck: {
        mayUseTokens: false,
      },
    },
    verification: {
      modelPing: {
        prompt: "Reply with exactly OK.",
        mayUseTokens: true,
      },
    },
  };
}

function createSuccessResult(stdout: string) {
  return {
    ok: true,
    exitCode: 0,
    stdout,
    stderr: "",
    signal: null,
    timedOut: false,
  };
}

function createFailureResult(stderr: string) {
  return {
    ok: false,
    exitCode: 1,
    stdout: "",
    stderr,
    signal: null,
    timedOut: false,
  };
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

describe("tempWorkspace", () => {
  it("creates temp workspaces under the system temp directory", async () => {
    const workspacePath = await createTempWorkspace();

    try {
      expect(workspacePath.startsWith(os.tmpdir())).toBe(true);
      expect(workspacePath === process.cwd()).toBe(false);
      expect(await pathExists(workspacePath)).toBe(true);
    } finally {
      await cleanupTempWorkspace(workspacePath);
    }

    expect(await pathExists(workspacePath)).toBe(false);
  });
});

describe("runLocalCheck", () => {
  it("runs in a temp dir with the version args and no prompt", async () => {
    const tempWorkspacePath = path.join(os.tmpdir(), "runtime-verifier-local");
    const calls: Array<{
      command: string;
      args: string[];
      cwd?: string;
      timeoutMs?: number;
    }> = [];

    const result = await runLocalCheck(createRuntimeDescriptor(), {
      createTempWorkspace: async () => tempWorkspacePath,
      cleanupTempWorkspace: async () => {},
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      run: async (command, args, options) => {
        calls.push({
          command,
          args,
          cwd: options?.cwd,
          timeoutMs: options?.timeoutMs,
        });
        return createSuccessResult("codex 0.1.0\n");
      },
    });

    expect(result).toEqual({
      verification: "passed",
      lastVerifiedAt: "2026-04-23T00:00:00.000Z",
    });
    expect(calls).toEqual([
      {
        command: "codex",
        args: ["--version"],
        cwd: tempWorkspacePath,
        timeoutMs: 5000,
      },
    ]);
    expect(calls[0]?.args.join(" ").includes("Reply with exactly OK.")).toBe(false);
    expect(calls[0]?.cwd === process.cwd()).toBe(false);
  });

  it("trims failed local check summaries for the renderer", async () => {
    const result = await runLocalCheck(createRuntimeDescriptor(), {
      createTempWorkspace: async () => path.join(os.tmpdir(), "runtime-failure"),
      cleanupTempWorkspace: async () => {},
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      run: async () => createFailureResult("x".repeat(400)),
    });

    expect(result.verification).toBe("failed");
    expect(result.lastVerifiedAt).toBe("2026-04-23T00:00:00.000Z");
    expect(result.lastError).toHaveLength(240);
    expect(result.lastError?.slice(-3)).toBe("...");
  });
});

describe("runModelPing", () => {
  it("runs in a temp dir with the exact ping prompt", async () => {
    const tempWorkspacePath = path.join(os.tmpdir(), "runtime-verifier-ping");
    const outputFilePath = path.join(tempWorkspacePath, "model-ping.txt");
    const calls: Array<{
      command: string;
      args: string[];
      cwd?: string;
      timeoutMs?: number;
    }> = [];
    const cleanedPaths: string[] = [];
    const readPaths: string[] = [];

    const result = await runModelPing(createRuntimeDescriptor(), {
      createTempWorkspace: async () => tempWorkspacePath,
      cleanupTempWorkspace: async (workspacePath) => {
        cleanedPaths.push(workspacePath);
      },
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      readFile: async (filePath) => {
        readPaths.push(filePath);
        return "OK\n";
      },
      run: async (command, args, options) => {
        calls.push({
          command,
          args,
          cwd: options?.cwd,
          timeoutMs: options?.timeoutMs,
        });
        return createSuccessResult("");
      },
    });

    expect(result).toEqual({
      verification: "passed",
      lastVerifiedAt: "2026-04-23T00:00:00.000Z",
    });
    expect(calls).toEqual([
      {
        command: "codex",
        args: [
          "exec",
          "--skip-git-repo-check",
          "--ephemeral",
          "--output-last-message",
          outputFilePath,
          "Reply with only OK",
        ],
        cwd: tempWorkspacePath,
        timeoutMs: 60000,
      },
    ]);
    expect(readPaths).toEqual([outputFilePath]);
    expect(cleanedPaths).toEqual([tempWorkspacePath]);
    expect(calls[0]?.cwd === process.cwd()).toBe(false);
  });

  it("uses the fixed prompt even if the descriptor prompt changes", async () => {
    const calls: Array<{ args: string[] }> = [];
    const runtime: RuntimeDescriptor = {
      id: "codex",
      name: "Codex",
      command: "codex",
      versionArgs: ["--version"],
      configMarkers: ["~/.codex", "~/.config/codex"],
      supportsModelPing: true,
      detection: {
        localCheck: {
          mayUseTokens: false,
        },
      },
      verification: {
        modelPing: {
          prompt: "Reply with exactly NO.",
          mayUseTokens: true,
        },
      },
    };

    await runModelPing(runtime, {
      createTempWorkspace: async () => path.join(os.tmpdir(), "runtime-fixed-prompt"),
      cleanupTempWorkspace: async () => {},
      readFile: async () => "OK\n",
      run: async (_command, args) => {
        calls.push({ args });
        return createSuccessResult("");
      },
    });

    expect(calls).toEqual([
      {
        args: [
          "exec",
          "--skip-git-repo-check",
          "--ephemeral",
          "--output-last-message",
          path.join(os.tmpdir(), "runtime-fixed-prompt", "model-ping.txt"),
          "Reply with only OK",
        ],
      },
    ]);
  });

  it("accepts a minimal OK response with trailing punctuation", async () => {
    const result = await runModelPing(createClaudeRuntimeDescriptor(), {
      createTempWorkspace: async () => path.join(os.tmpdir(), "runtime-ok-period"),
      cleanupTempWorkspace: async () => {},
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      run: async () => createSuccessResult("OK.\n"),
    });

    expect(result).toEqual({
      verification: "passed",
      lastVerifiedAt: "2026-04-23T00:00:00.000Z",
    });
  });

  it("runs claude-code model ping in print mode and reads from stdout", async () => {
    const tempWorkspacePath = path.join(os.tmpdir(), "runtime-verifier-claude-ping");
    const calls: Array<{
      command: string;
      args: string[];
      cwd?: string;
      timeoutMs?: number;
    }> = [];

    const result = await runModelPing(createClaudeRuntimeDescriptor(), {
      createTempWorkspace: async () => tempWorkspacePath,
      cleanupTempWorkspace: async () => {},
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      readFile: async () => {
        throw new Error("should not read from file for claude-code");
      },
      run: async (command, args, options) => {
        calls.push({
          command,
          args,
          cwd: options?.cwd,
          timeoutMs: options?.timeoutMs,
        });
        return createSuccessResult("OK\n");
      },
    });

    expect(result).toEqual({
      verification: "passed",
      lastVerifiedAt: "2026-04-23T00:00:00.000Z",
    });
    expect(calls).toEqual([
      {
        command: "claude",
        args: ["--print", "Reply with only OK"],
        cwd: tempWorkspacePath,
        timeoutMs: 60000,
      },
    ]);
  });

  it("returns unsupported without invoking the CLI when ping is not supported", async () => {
    let runCalls = 0;
    const runtime = {
      ...createClaudeRuntimeDescriptor(),
      supportsModelPing: false,
      verification: {},
    } as RuntimeDescriptor;

    const result = await runModelPing(runtime, {
      createTempWorkspace: async () => {
        throw new Error("should not create a temp workspace");
      },
      run: async () => {
        runCalls += 1;
        return createSuccessResult("");
      },
    });

    expect(result).toEqual({
      verification: "unsupported",
    });
    expect(runCalls).toBe(0);
  });

  it("returns unsupported without invoking the CLI when ping config is missing", async () => {
    let runCalls = 0;
    const runtime = {
      ...createRuntimeDescriptor(),
      verification: {},
    } as unknown as RuntimeDescriptor;

    const result = await runModelPing(runtime, {
      createTempWorkspace: async () => {
        throw new Error("should not create a temp workspace");
      },
      run: async () => {
        runCalls += 1;
        return createSuccessResult("");
      },
    });

    expect(result).toEqual({
      verification: "unsupported",
    });
    expect(runCalls).toBe(0);
  });

  it("returns unsupported without creating a temp workspace for unknown ping runtimes", async () => {
    let runCalls = 0;
    const runtime = {
      ...createRuntimeDescriptor(),
      id: "unknown-runtime",
    } as unknown as RuntimeDescriptor;

    const result = await runModelPing(runtime, {
      createTempWorkspace: async () => {
        throw new Error("should not create a temp workspace");
      },
      run: async () => {
        runCalls += 1;
        return createSuccessResult("");
      },
    });

    expect(result).toEqual({
      verification: "unsupported",
    });
    expect(runCalls).toBe(0);
  });

  it("returns a timeout summary when model ping exceeds the limit", async () => {
    const cleanedPaths: string[] = [];

    const result = await runModelPing(createRuntimeDescriptor(), {
      createTempWorkspace: async () => path.join(os.tmpdir(), "runtime-timeout"),
      cleanupTempWorkspace: async (workspacePath) => {
        cleanedPaths.push(workspacePath);
      },
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      run: async () => ({
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        signal: "SIGTERM",
        timedOut: true,
      }),
    });

    expect(result).toEqual({
      verification: "failed",
      lastVerifiedAt: "2026-04-23T00:00:00.000Z",
      lastError: "Model ping failed. Timed out after 60000ms.",
    });
    expect(cleanedPaths).toEqual([path.join(os.tmpdir(), "runtime-timeout")]);
  });
});
