import { describe, expect, it } from "bun:test";
import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RuntimeDescriptor } from "../../src/shared/runtimes";
import { cleanupTempWorkspace, createTempWorkspace } from "./tempWorkspace";
import { runLocalCheck, runModelPing } from "./runtimeVerifier";

function createRuntimeDescriptor(): RuntimeDescriptor {
  return {
    id: "kimi",
    name: "Kimi Code",
    command: "kimi",
    versionArgs: ["--version"],
    configMarkers: ["~/.kimi-code", "~/.config/kimi-code"],
    supportsModelPing: false,
    detection: { localCheck: { mayUseTokens: false } },
    verification: {},
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
  it("runs Kimi version detection in a temporary directory", async () => {
    const tempWorkspacePath = path.join(os.tmpdir(), "runtime-verifier-local");
    const calls: Array<{ command: string; args: string[]; cwd?: string; timeoutMs?: number }> = [];
    const result = await runLocalCheck(createRuntimeDescriptor(), {
      createTempWorkspace: async () => tempWorkspacePath,
      cleanupTempWorkspace: async () => {},
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      run: async (command, args, options) => {
        calls.push({ command, args, cwd: options?.cwd, timeoutMs: options?.timeoutMs });
        return {
          ok: true,
          exitCode: 0,
          stdout: "kimi 1.0.0\n",
          stderr: "",
          signal: null,
          timedOut: false,
        };
      },
    });

    expect(result).toEqual({
      verification: "passed",
      lastVerifiedAt: "2026-04-23T00:00:00.000Z",
    });
    expect(calls).toEqual([
      { command: "kimi", args: ["--version"], cwd: tempWorkspacePath, timeoutMs: 5000 },
    ]);
  });

  it("returns a bounded failure summary and cleans up after a failed check", async () => {
    const cleaned: string[] = [];
    const result = await runLocalCheck(createRuntimeDescriptor(), {
      createTempWorkspace: async () => "/tmp/runtime-failure",
      cleanupTempWorkspace: async (workspacePath) => {
        cleaned.push(workspacePath);
      },
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      run: async () => ({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "x".repeat(400),
        signal: null,
        timedOut: false,
      }),
    });

    expect(result.verification).toBe("failed");
    expect(result.lastVerifiedAt).toBe("2026-04-23T00:00:00.000Z");
    expect(result.lastError).toHaveLength(240);
    expect(result.lastError?.endsWith("...")).toBe(true);
    expect(cleaned).toEqual(["/tmp/runtime-failure"]);
  });

  it("reports a timeout and still cleans up the temporary workspace", async () => {
    const cleaned: string[] = [];
    const result = await runLocalCheck(createRuntimeDescriptor(), {
      createTempWorkspace: async () => "/tmp/runtime-timeout",
      cleanupTempWorkspace: async (workspacePath) => {
        cleaned.push(workspacePath);
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
      lastError: "Local check failed. Timed out after 5000ms.",
    });
    expect(cleaned).toEqual(["/tmp/runtime-timeout"]);
  });
});

describe("runModelPing", () => {
  it("is unsupported for Kimi ACP", async () => {
    expect(await runModelPing()).toEqual({ verification: "unsupported" });
  });
});
