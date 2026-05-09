import { describe, expect, it } from "bun:test";

import type { RuntimeDescriptor } from "../../src/shared/runtimes";
import { listRuntimeModels, parsePiModelList } from "./runtimeModelLister";

const SAMPLE_MODEL_TABLE = `provider    model                   context  max-out  thinking  images
deepseek    deepseek-v4-flash       1M       384K     yes       no
minimax-cn  MiniMax-M2.7-highspeed  204.8K   131.1K   yes       no
`;

function createPiRuntimeDescriptor(): RuntimeDescriptor {
  return {
    id: "pi",
    name: "pi",
    command: "pi",
    versionArgs: ["--version"],
    configMarkers: ["~/.pi"],
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

function createCodexRuntimeDescriptor(): RuntimeDescriptor {
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

function createFailureResult(stderr: string, stdout = "") {
  return {
    ok: false,
    exitCode: 1,
    stdout,
    stderr,
    signal: null,
    timedOut: false,
  };
}

describe("parsePiModelList", () => {
  it("maps sample table to expected records", () => {
    expect(parsePiModelList(SAMPLE_MODEL_TABLE)).toEqual([
      {
        id: "deepseek/deepseek-v4-flash",
        name: "deepseek-v4-flash",
        provider: "deepseek",
        source: "cli",
        contextWindow: "1M",
        maxOutput: "384K",
        supportsThinking: true,
        supportsImages: false,
      },
      {
        id: "minimax-cn/MiniMax-M2.7-highspeed",
        name: "MiniMax-M2.7-highspeed",
        provider: "minimax-cn",
        source: "cli",
        contextWindow: "204.8K",
        maxOutput: "131.1K",
        supportsThinking: true,
        supportsImages: false,
      },
    ]);
  });

  it("ignores blank and malformed rows", () => {
    expect(
      parsePiModelList(`

provider    model                   context  max-out  thinking  images
malformed
deepseek    deepseek-v4-flash       1M       384K     yes       no
minimax-cn  MiniMax-M2.7-highspeed
`),
    ).toEqual([
      {
        id: "deepseek/deepseek-v4-flash",
        name: "deepseek-v4-flash",
        provider: "deepseek",
        source: "cli",
        contextWindow: "1M",
        maxOutput: "384K",
        supportsThinking: true,
        supportsImages: false,
      },
    ]);
  });
});

describe("listRuntimeModels", () => {
  it("runs pi --list-models and returns listed with lastListedAt", async () => {
    const calls: Array<{
      command: string;
      args: string[];
      timeoutMs?: number;
    }> = [];

    const result = await listRuntimeModels(createPiRuntimeDescriptor(), {
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      run: async (command, args, options) => {
        calls.push({
          command,
          args,
          timeoutMs: options?.timeoutMs,
        });
        return createSuccessResult(SAMPLE_MODEL_TABLE);
      },
    });

    expect(result).toEqual({
      state: "listed",
      models: parsePiModelList(SAMPLE_MODEL_TABLE),
      lastListedAt: "2026-04-23T00:00:00.000Z",
    });
    expect(calls).toEqual([
      {
        command: "pi",
        args: ["--list-models"],
        timeoutMs: 10000,
      },
    ]);
  });

  it("returns unsupported for non-pi without invoking the CLI", async () => {
    let runCalls = 0;

    const result = await listRuntimeModels(createCodexRuntimeDescriptor(), {
      run: async () => {
        runCalls += 1;
        return createSuccessResult("");
      },
    });

    expect(result).toEqual({
      state: "unsupported",
      models: [],
    });
    expect(runCalls).toBe(0);
  });

  it("returns failed with lastError when the CLI fails", async () => {
    const result = await listRuntimeModels(createPiRuntimeDescriptor(), {
      now: () => new Date("2026-04-23T00:00:00.000Z"),
      run: async () => createFailureResult("\n  auth missing\n", "fallback output"),
    });

    expect(result).toEqual({
      state: "failed",
      models: [],
      lastListedAt: "2026-04-23T00:00:00.000Z",
      lastError: "auth missing",
    });
  });
});
