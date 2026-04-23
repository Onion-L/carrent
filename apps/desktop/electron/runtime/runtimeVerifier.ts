import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  RuntimeDescriptor,
  RuntimeVerificationResult,
} from "../../src/shared/runtimes";
import {
  createProcessRunner,
  type ProcessRunner,
  type ProcessRunnerResult,
} from "./processRunner";
import {
  cleanupTempWorkspace,
  createTempWorkspace,
} from "./tempWorkspace";

const LOCAL_CHECK_TIMEOUT_MS = 5000;
const MODEL_PING_TIMEOUT_MS = 15000;
const MAX_SUMMARY_CHARS = 240;
const FIXED_MODEL_PING_PROMPT = "Reply with exactly OK.";

interface ModelPingCommand {
  args: string[];
  responseSource: "stdout" | "file";
  outputFilePath?: string;
}

interface RuntimeVerifierDeps {
  run?: ProcessRunner["run"];
  createTempWorkspace?: () => Promise<string>;
  cleanupTempWorkspace?: (workspacePath: string) => Promise<void>;
  readFile?: (filePath: string) => Promise<string>;
  now?: () => Date;
}

export async function runLocalCheck(
  runtime: RuntimeDescriptor,
  deps: RuntimeVerifierDeps = {},
): Promise<RuntimeVerificationResult> {
  const run = deps.run ?? createProcessRunner().run;
  const makeTempWorkspace = deps.createTempWorkspace ?? createTempWorkspace;
  const removeTempWorkspace =
    deps.cleanupTempWorkspace ?? cleanupTempWorkspace;
  const now = deps.now ?? (() => new Date());
  const workspacePath = await makeTempWorkspace();

  try {
    const result = await run(runtime.command, runtime.versionArgs, {
      cwd: workspacePath,
      timeoutMs: LOCAL_CHECK_TIMEOUT_MS,
    });

    return createVerificationResult(
      result,
      "Local check failed.",
      LOCAL_CHECK_TIMEOUT_MS,
      now,
    );
  } finally {
    await removeTempWorkspace(workspacePath);
  }
}

export async function runModelPing(
  runtime: RuntimeDescriptor,
  deps: RuntimeVerifierDeps = {},
): Promise<RuntimeVerificationResult> {
  const now = deps.now ?? (() => new Date());
  const readTextFile = deps.readFile ?? defaultReadFile;
  const buildArgs = getModelPingArgs(runtime);

  if (buildArgs == null) {
    return {
      verification: "unsupported",
    };
  }

  const run = deps.run ?? createProcessRunner().run;
  const makeTempWorkspace = deps.createTempWorkspace ?? createTempWorkspace;
  const removeTempWorkspace =
    deps.cleanupTempWorkspace ?? cleanupTempWorkspace;
  const workspacePath = await makeTempWorkspace();
  const command = buildArgs(workspacePath);

  try {
    const result = await run(runtime.command, command.args, {
      cwd: workspacePath,
      timeoutMs: MODEL_PING_TIMEOUT_MS,
    });

    if (!result.ok) {
      return createVerificationResult(
        result,
        "Model ping failed.",
        MODEL_PING_TIMEOUT_MS,
        now,
      );
    }

    const response = await readModelPingResponse(readTextFile, result.stdout, command);

    if (response === "OK") {
      return {
        verification: "passed",
        lastVerifiedAt: now().toISOString(),
      };
    }

    return {
      verification: "failed",
      lastVerifiedAt: now().toISOString(),
      lastError: truncateSummary(
        response.length > 0
          ? `Unexpected model ping response: ${response}`
          : "Model ping failed. Empty response.",
      ),
    };
  } finally {
    await removeTempWorkspace(workspacePath);
  }
}

function getModelPingArgs(
  runtime: RuntimeDescriptor,
): ((workspacePath: string) => ModelPingCommand) | null {
  if (!runtime.supportsModelPing || runtime.verification.modelPing == null) {
    return null;
  }

  switch (runtime.id) {
    case "codex":
      return (workspacePath) => {
        const outputFilePath = path.join(workspacePath, "model-ping.txt");

        return {
          args: [
            "exec",
            "--skip-git-repo-check",
            "--ephemeral",
            "--output-last-message",
            outputFilePath,
            FIXED_MODEL_PING_PROMPT,
          ],
          responseSource: "file",
          outputFilePath,
        };
      };
    case "claude-code":
      return () => ({
        args: [
          "--print",
          "--output-format",
          "text",
          "--no-session-persistence",
          "--tools",
          "",
          FIXED_MODEL_PING_PROMPT,
        ],
        responseSource: "stdout",
      });
    default:
      return null;
  }
}

function createVerificationResult(
  result: ProcessRunnerResult,
  fallbackMessage: string,
  timeoutMs: number,
  now: () => Date,
): RuntimeVerificationResult {
  return {
    verification: result.ok ? "passed" : "failed",
    lastVerifiedAt: now().toISOString(),
    lastError: result.ok
      ? undefined
      : summarizeFailure(result, fallbackMessage, timeoutMs),
  };
}

function summarizeFailure(
  result: ProcessRunnerResult,
  fallbackMessage: string,
  timeoutMs: number,
): string {
  if (result.timedOut) {
    return `${fallbackMessage} Timed out after ${timeoutMs}ms.`;
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

async function readModelPingResponse(
  readTextFile: (filePath: string) => Promise<string>,
  stdout: string,
  command: ModelPingCommand,
): Promise<string> {
  if (command.responseSource === "stdout") {
    return normalizeResponse(stdout);
  }

  if (command.outputFilePath == null) {
    return "";
  }

  try {
    return normalizeResponse(await readTextFile(command.outputFilePath));
  } catch {
    return "";
  }
}

function firstNonEmptyLine(value: string): string {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0) ?? "";
}

function truncateSummary(value: string): string {
  if (value.length <= MAX_SUMMARY_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_SUMMARY_CHARS - 3).trimEnd()}...`;
}

function normalizeResponse(value: string): string {
  return value.trim();
}

async function defaultReadFile(filePath: string): Promise<string> {
  return readFile(filePath, "utf8");
}
