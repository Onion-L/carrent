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

function createKimiRuntimeDescriptor(): RuntimeDescriptor {
  return {
    id: "kimi",
    name: "Kimi Code",
    command: "kimi",
    versionArgs: ["--version"],
    configMarkers: ["~/.kimi-code", "~/.config/kimi-code"],
    supportsModelPing: false,
    detection: {
      localCheck: {
        mayUseTokens: false,
      },
    },
    verification: {},
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
      expect(result.enabled).toBe(true);
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
    expect(calls).toHaveLength(2);
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
    expect(result.enabled).toBe(false);
    expect(result.status).toBe("stopped");
    expect(result.configuration).toBe("unknown");
    expect(result.path).toBeUndefined();
    expect(result.version).toBeUndefined();
    expect(result.lastError).toBe(
      'Runtime command not found: codex. Install Codex and make "codex" available in PATH.',
    );
  });

  it("detects Kimi Code with version and configured state", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "kimi-runtime-detector-"));
    const configMarker = path.join(tempRoot, "kimi-code");
    const commands = [
      {
        ok: true,
        exitCode: 0,
        stdout: "/Users/onion/.kimi-code/bin/kimi\n",
        stderr: "",
      },
      {
        ok: true,
        exitCode: 0,
        stdout: "0.19.2\n",
        stderr: "",
      },
    ];
    const calls: Array<{ command: string; args: string[]; cwd?: string }> = [];
    const runtime = {
      ...createKimiRuntimeDescriptor(),
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

      expect(result.id).toBe("kimi");
      expect(result.name).toBe("Kimi Code");
      expect(result.command).toBe("kimi");
      expect(result.availability).toBe("detected");
      expect(result.enabled).toBe(true);
      expect(result.configuration).toBe("configured");
      expect(result.path).toBe("/Users/onion/.kimi-code/bin/kimi");
      expect(result.version).toBe("0.19.2");
      expect(result.supportsModelPing).toBe(false);
      expect(calls).toEqual([
        {
          command: "which",
          args: ["kimi"],
          cwd: os.homedir(),
        },
        {
          command: "kimi",
          args: ["--version"],
          cwd: os.homedir(),
        },
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("returns actionable unavailable state when Kimi Code is missing", async () => {
    const result = await detectRuntime(createKimiRuntimeDescriptor(), {
      run: async () => ({
        ok: false,
        exitCode: 1,
        stdout: "",
        stderr: "",
      }),
    });

    expect(result).toMatchObject({
      id: "kimi",
      availability: "unavailable",
      enabled: false,
      configuration: "unknown",
      lastError:
        'Runtime command not found: kimi. Install Kimi Code and make "kimi" available in PATH.',
    });
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

  it("does not inspect host process state during CLI detection", async () => {
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
    ];
    const calls: string[] = [];

    const result = await detectRuntime(createRuntimeDescriptor(), {
      run: async (command) => {
        calls.push(command);
        return commands.shift()!;
      },
      pathExists: async () => true,
    });

    expect(result.availability).toBe("detected");
    expect(result.status).toBe("stopped");
    expect(result.pid).toBeUndefined();
    expect(calls).toEqual(["which", "codex"]);
  });
});
