import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

import type {
  RuntimeDescriptor,
  RuntimeModelListResult,
  RuntimeModelRecord,
} from "../../src/shared/runtimes";
import { createProcessRunner, type ProcessRunner, type ProcessRunnerResult } from "./processRunner";
import {
  createKimiAcpProcessTransportFactory,
  type KimiAcpTransportFactory,
} from "../chat/kimiAcpChat";

const PI_LIST_MODELS_TIMEOUT_MS = 10000;
const KIMI_LIST_MODELS_TIMEOUT_MS = 15000;
const MAX_SUMMARY_CHARS = 240;
const LIST_MODELS_CWD = os.homedir();

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

interface RuntimeModelListerDeps {
  run?: ProcessRunner["run"];
  now?: () => Date;
  kimiTransportFactory?: KimiAcpTransportFactory;
}

export async function listRuntimeModels(
  runtime: RuntimeDescriptor,
  deps: RuntimeModelListerDeps = {},
): Promise<RuntimeModelListResult> {
  if (runtime.id === "pi") {
    return listPiRuntimeModels(runtime, deps);
  }

  if (runtime.id === "kimi") {
    return listKimiRuntimeModels(LIST_MODELS_CWD, deps.kimiTransportFactory);
  }

  return {
    state: "unsupported",
    models: [],
  };
}

async function listPiRuntimeModels(
  runtime: RuntimeDescriptor,
  deps: RuntimeModelListerDeps,
): Promise<RuntimeModelListResult> {
  const run = deps.run ?? createProcessRunner().run;
  const now = deps.now ?? (() => new Date());
  const result = await run(runtime.command, ["--list-models"], {
    cwd: LIST_MODELS_CWD,
    timeoutMs: PI_LIST_MODELS_TIMEOUT_MS,
  });
  const lastListedAt = now().toISOString();

  if (!result.ok) {
    return {
      state: "failed",
      models: [],
      lastListedAt,
      lastError: summarizeFailure(result, "Runtime model list failed."),
    };
  }

  const models = parsePiModelList(`${result.stdout}\n${result.stderr}`);

  return {
    state: "listed",
    models,
    lastListedAt,
  };
}

export async function listKimiRuntimeModels(
  cwd: string,
  transportFactory: KimiAcpTransportFactory = createKimiAcpProcessTransportFactory(
    (command, args, options) =>
      spawn(command, args, {
        cwd: options.cwd,
        stdio: options.stdio,
        windowsHide: options.windowsHide,
      }) as ChildProcess,
  ),
): Promise<RuntimeModelListResult> {
  return new Promise((resolve) => {
    let nextId = 1;
    const pending = new Map<
      JsonRpcId,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();

    const transport = transportFactory({ cwd });

    const timeoutTimer = setTimeout(() => {
      transport.close();
      resolve({
        state: "failed",
        models: [],
        lastError: "Timed out waiting for Kimi models.",
      });
    }, KIMI_LIST_MODELS_TIMEOUT_MS);

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      transport.close();
    };

    transport.onMessage((message) => {
      if (message.id != null && pending.has(message.id as JsonRpcId)) {
        const handler = pending.get(message.id as JsonRpcId)!;
        pending.delete(message.id as JsonRpcId);
        if (message.error) {
          const errorObject = readObject(message.error);
          handler.reject(
            new Error(readString(errorObject?.message) ?? JSON.stringify(message.error)),
          );
        } else {
          handler.resolve(message.result);
        }
        return;
      }
    });

    transport.onError((error) => {
      cleanup();
      resolve({
        state: "failed",
        models: [],
        lastError: error.message,
      });
    });

    transport.onClose(({ stderr, signal, code }) => {
      cleanup();
      resolve({
        state: "failed",
        models: [],
        lastError: `Kimi ACP exited: ${stderr || signal || code || "unknown"}`,
      });
    });

    const send = (method: string, params: JsonObject): Promise<unknown> => {
      const id = nextId++;
      const message = { jsonrpc: "2.0", id, method, params };
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        transport.send(message);
      });
    };

    void (async () => {
      try {
        await send("initialize", {
          protocolVersion: 1,
          clientCapabilities: {
            fs: { readTextFile: true, writeTextFile: false },
            terminal: false,
          },
        });

        const result = await send("session/new", { cwd, mcpServers: [] });
        const sessionResult = readObject(result) ?? {};
        const modelConfig = findModelConfigOption(sessionResult.configOptions);

        if (!modelConfig) {
          cleanup();
          resolve({ state: "unsupported", models: [] });
          return;
        }

        const optionValues = readArray(modelConfig.options);
        const models: RuntimeModelRecord[] = [];
        for (const option of optionValues) {
          const optionObject = readObject(option);
          const value = readString(optionObject?.value);
          const name = readString(optionObject?.name);
          if (!value || !name) {
            continue;
          }
          models.push({
            id: value,
            name,
            source: "cli",
          });
        }

        cleanup();
        resolve({
          state: "listed",
          models,
          defaultModelId: readString(modelConfig.currentValue) ?? undefined,
        });
      } catch (error) {
        cleanup();
        resolve({
          state: "failed",
          models: [],
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
}

function findModelConfigOption(value: unknown): JsonObject | null {
  const options = readArray(value);
  const found = options.find((option) => {
    const optionObject = readObject(option);
    const id = readString(optionObject?.id)?.toLowerCase();
    const category = readString(optionObject?.category)?.toLowerCase();
    return id === "model" || category === "model";
  });
  return readObject(found) ?? null;
}

function readObject(value: unknown): JsonObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function parsePiModelList(stdout: string): RuntimeModelRecord[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const columns = line.split(/\s+/u);
      const [provider, model, contextWindow, maxOutput, thinking, images] = columns;

      if (
        columns.length !== 6 ||
        provider == null ||
        model == null ||
        contextWindow == null ||
        maxOutput == null ||
        thinking == null ||
        images == null ||
        (provider.toLowerCase() === "provider" && model.toLowerCase() === "model") ||
        !isYesNo(thinking) ||
        !isYesNo(images)
      ) {
        return [];
      }

      return [
        {
          id: `${provider}/${model}`,
          name: model,
          provider,
          source: "cli",
          contextWindow,
          maxOutput,
          supportsThinking: thinking === "yes",
          supportsImages: images === "yes",
        },
      ];
    });
}

function isYesNo(value: string): value is "yes" | "no" {
  return value === "yes" || value === "no";
}

function summarizeFailure(result: ProcessRunnerResult, fallbackMessage: string): string {
  if (result.timedOut) {
    return `${fallbackMessage} Timed out after ${PI_LIST_MODELS_TIMEOUT_MS}ms.`;
  }

  const source = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout);

  if (source) {
    return truncateSummary(source);
  }

  if (result.errorCode) {
    return `${fallbackMessage} (${result.errorCode})`;
  }

  if (result.exitCode != null) {
    return `${fallbackMessage} Exit code ${result.exitCode}.`;
  }

  return fallbackMessage;
}

function firstNonEmptyLine(value: string): string {
  return (
    value
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function truncateSummary(value: string): string {
  if (value.length <= MAX_SUMMARY_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_SUMMARY_CHARS - 3).trimEnd()}...`;
}
