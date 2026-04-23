import { describe, expect, it } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RuntimeDescriptor } from "../../src/shared/runtimes";
import { detectRuntime } from "./runtimeDetector";

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

function stoppedPgrepResult() {
  return {
    ok: false,
    exitCode: 1,
    stdout: "",
    stderr: "",
  };
}

describe("detectRuntime", () => {
  it("returns detected runtime with version and configured state", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "runtime-detector-"));
    const configMarker = path.join(tempRoot, "codex-config");
    const commands = [
      {
        ok: true,
        exitCode: 0,
        stdout: "/usr/local/bin/codex\n",
        stderr: "",
      },
      {
        ok: true,
        exitCode: 0,
        stdout: "codex 0.1.0\n",
        stderr: "",
      },
      stoppedPgrepResult(),
    ];
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runtime = {
      ...createRuntimeDescriptor(),
      configMarkers: [configMarker],
    };

    await mkdir(configMarker, { recursive: true });

    try {
      const result = await detectRuntime(runtime, {
        run: async (command, args, options) => {
          calls.push({ command, args, cwd: options?.cwd });
          return commands.shift()!;
        },
      });

      expect(result.availability).toBe("detected");
      expect(result.status).toBe("stopped");
      expect(result.configuration).toBe("configured");
      expect(result.path).toBe("/usr/local/bin/codex");
      expect(result.version).toBe("codex 0.1.0");
      expect(result.lastError).toBeUndefined();
      expect(calls).toEqual([
        {
          command: "which",
          args: ["codex"],
          cwd: os.homedir(),
        },
        {
          command: "codex",
          args: ["--version"],
          cwd: os.homedir(),
        },
        {
          command: "pgrep",
          args: ["-x", "codex"],
          cwd: os.homedir(),
        },
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("uses where for command lookup on win32", async () => {
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const commands = [
      {
        ok: true,
        exitCode: 0,
        stdout: "C:\\Users\\onion\\AppData\\Local\\codex.exe\r\n",
        stderr: "",
      },
      {
        ok: true,
        exitCode: 0,
        stdout: "codex 0.1.0\r\n",
        stderr: "",
      },
      {
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
      },
    ];

    await detectRuntime(createRuntimeDescriptor(), {
      platform: "win32",
      run: async (command, args, options) => {
        calls.push({ command, args, cwd: options?.cwd });
        return commands.shift()!;
      },
      pathExists: async () => false,
    });

    expect(calls[0]).toEqual({
      command: "where",
      args: ["codex"],
      cwd: os.homedir(),
    });
    expect(calls[2]).toEqual({
      command: "tasklist",
      args: ["/FI", "IMAGENAME eq codex.exe", "/NH"],
      cwd: os.homedir(),
    });
  });

  it("returns unavailable when the command is missing", async () => {
    const result = await detectRuntime(createRuntimeDescriptor(), {
      run: async () => ({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
      }),
    });

    expect(result.availability).toBe("unavailable");
    expect(result.status).toBe("stopped");
    expect(result.configuration).toBe("unknown");
    expect(result.path).toBeUndefined();
    expect(result.version).toBeUndefined();
  });

  it("returns missing configuration when no config marker exists", async () => {
    const commands = [
      {
        ok: true,
        exitCode: 0,
        stdout: "/usr/local/bin/codex\n",
        stderr: "",
      },
      {
        ok: true,
        exitCode: 0,
        stdout: "codex 0.1.0\n",
        stderr: "",
      },
      stoppedPgrepResult(),
    ];

    const result = await detectRuntime(createRuntimeDescriptor(), {
      run: async () => commands.shift()!,
      pathExists: async () => false,
    });

    expect(result.availability).toBe("detected");
    expect(result.status).toBe("stopped");
    expect(result.configuration).toBe("missing");
    expect(result.version).toBe("codex 0.1.0");
  });

  it("resolves relative config markers under the user home directory", async () => {
    const checkedPaths: string[] = [];
    const runtime = {
      ...createRuntimeDescriptor(),
      configMarkers: ["relative-config", "/tmp/absolute-config"],
    };
    const commands = [
      {
        ok: true,
        exitCode: 0,
        stdout: "/usr/local/bin/codex\n",
        stderr: "",
      },
      {
        ok: true,
        exitCode: 0,
        stdout: "codex 0.1.0\n",
        stderr: "",
      },
      stoppedPgrepResult(),
    ];

    await detectRuntime(runtime, {
      run: async () => commands.shift()!,
      pathExists: async (targetPath) => {
        checkedPaths.push(targetPath);
        return false;
      },
    });

    expect(checkedPaths).toEqual([`${os.homedir()}/relative-config`, "/tmp/absolute-config"]);
  });

  it("keeps availability detected when version probing fails", async () => {
    const commands = [
      {
        ok: true,
        exitCode: 0,
        stdout: "/usr/local/bin/codex\n",
        stderr: "",
      },
      {
        ok: false,
        exitCode: 124,
        stdout: "",
        stderr:
          "version probe timed out with a very long stderr payload that should be trimmed for UI display",
      },
      stoppedPgrepResult(),
    ];

    const result = await detectRuntime(createRuntimeDescriptor(), {
      run: async () => commands.shift()!,
      pathExists: async () => true,
    });

    expect(result.availability).toBe("detected");
    expect(result.status).toBe("stopped");
    expect(result.configuration).toBe("configured");
    expect(result.version).toBeUndefined();
    expect(result.lastError).toBe(
      "version probe timed out with a very long stderr payload that should be trimmed for UI display",
    );
  });

  it("detects running status when pgrep finds the process", async () => {
    const commands = [
      {
        ok: true,
        exitCode: 0,
        stdout: "/usr/local/bin/codex\n",
        stderr: "",
      },
      {
        ok: true,
        exitCode: 0,
        stdout: "codex 0.1.0\n",
        stderr: "",
      },
      {
        ok: true,
        exitCode: 0,
        stdout: "12345\n",
        stderr: "",
      },
    ];

    const result = await detectRuntime(createRuntimeDescriptor(), {
      run: async () => commands.shift()!,
      pathExists: async () => true,
    });

    expect(result.availability).toBe("detected");
    expect(result.status).toBe("running");
    expect(result.pid).toBe(12345);
  });
});
