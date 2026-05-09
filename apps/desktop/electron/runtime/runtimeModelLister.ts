import os from "node:os";

import type {
  RuntimeDescriptor,
  RuntimeModelListResult,
  RuntimeModelRecord,
} from "../../src/shared/runtimes";
import { createProcessRunner, type ProcessRunner, type ProcessRunnerResult } from "./processRunner";

const PI_LIST_MODELS_TIMEOUT_MS = 10000;
const MAX_SUMMARY_CHARS = 240;
const LIST_MODELS_CWD = os.homedir();

interface RuntimeModelListerDeps {
  run?: ProcessRunner["run"];
  now?: () => Date;
}

export async function listRuntimeModels(
  runtime: RuntimeDescriptor,
  deps: RuntimeModelListerDeps = {},
): Promise<RuntimeModelListResult> {
  if (runtime.id !== "pi") {
    return {
      state: "unsupported",
      models: [],
    };
  }

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

  return {
    state: "listed",
    models: parsePiModelList(result.stdout),
    lastListedAt,
  };
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
