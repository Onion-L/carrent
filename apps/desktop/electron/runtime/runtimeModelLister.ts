import os from "node:os";
import { spawn, type ChildProcess } from "node:child_process";

import type { RuntimeDescriptor, RuntimeModelListResult } from "../../src/shared/runtimes";
import {
  createKimiAcpProcessTransportFactory,
  type KimiAcpTransportFactory,
} from "../chat/kimiAcpChat";

const KIMI_LIST_MODELS_TIMEOUT_MS = 15000;
const LIST_MODELS_CWD = os.homedir();

type JsonRpcId = string | number;
type JsonObject = Record<string, unknown>;

interface RuntimeModelListerDeps {
  kimiTransportFactory?: KimiAcpTransportFactory;
}

export async function listRuntimeModels(
  _runtime: RuntimeDescriptor,
  deps: RuntimeModelListerDeps = {},
): Promise<RuntimeModelListResult> {
  return listKimiRuntimeModels(LIST_MODELS_CWD, deps.kimiTransportFactory);
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
  abortSignal?: AbortSignal,
): Promise<RuntimeModelListResult> {
  if (abortSignal?.aborted) {
    return { state: "failed", models: [], lastError: "Kimi model listing cancelled." };
  }
  return new Promise((resolve) => {
    let nextId = 1;
    let settled = false;
    const pending = new Map<
      JsonRpcId,
      { resolve: (value: unknown) => void; reject: (error: Error) => void }
    >();
    const transport = transportFactory({ cwd });
    const finish = (result: RuntimeModelListResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      abortSignal?.removeEventListener("abort", handleAbort);
      const error = new Error(result.lastError ?? "Kimi model listing finished.");
      for (const request of pending.values()) request.reject(error);
      pending.clear();
      let closing: void | Promise<void>;
      try {
        closing = transport.close();
      } catch {
        closing = undefined;
      }
      void Promise.resolve(closing)
        .catch(() => {})
        .then(() => resolve(result));
    };
    const handleAbort = () =>
      finish({ state: "failed", models: [], lastError: "Kimi model listing cancelled." });
    const timeoutTimer = setTimeout(
      () =>
        finish({
          state: "failed",
          models: [],
          lastError: "Timed out waiting for Kimi models.",
        }),
      KIMI_LIST_MODELS_TIMEOUT_MS,
    );
    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    transport.onMessage((message) => {
      if (settled) return;
      if (message.id == null || !pending.has(message.id as JsonRpcId)) return;
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
    });
    transport.onError((error) => {
      finish({ state: "failed", models: [], lastError: error.message });
    });
    transport.onClose(({ stderr, signal: exitSignal, code }) => {
      finish({
        state: "failed",
        models: [],
        lastError: `Kimi ACP exited: ${stderr || exitSignal || code || "unknown"}`,
      });
    });

    const send = (method: string, params: JsonObject): Promise<unknown> => {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        transport.send({ jsonrpc: "2.0", id, method, params });
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
          finish({ state: "unsupported", models: [] });
          return;
        }

        const models = readArray(modelConfig.options).flatMap((option) => {
          const optionObject = readObject(option);
          const id = readString(optionObject?.value);
          const name = readString(optionObject?.name);
          return id && name ? [{ id, name, source: "cli" as const }] : [];
        });
        finish({
          state: "listed",
          models,
          defaultModelId: readString(modelConfig.currentValue) ?? undefined,
        });
      } catch (error) {
        finish({
          state: "failed",
          models: [],
          lastError: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  });
}

function findModelConfigOption(value: unknown): JsonObject | null {
  return (
    readObject(
      readArray(value).find((option) => {
        const item = readObject(option);
        return (
          readString(item?.id)?.toLowerCase() === "model" ||
          readString(item?.category)?.toLowerCase() === "model"
        );
      }),
    ) ?? null
  );
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
