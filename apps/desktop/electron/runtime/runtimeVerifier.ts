import type { RuntimeDescriptor, RuntimeVerificationResult } from "../../src/shared/runtimes";
import { createProcessRunner, type ProcessRunner, type ProcessRunnerResult } from "./processRunner";
import { cleanupTempWorkspace, createTempWorkspace } from "./tempWorkspace";

const LOCAL_CHECK_TIMEOUT_MS = 5000;
const MAX_SUMMARY_CHARS = 240;

interface RuntimeVerifierDeps {
  run?: ProcessRunner["run"];
  createTempWorkspace?: () => Promise<string>;
  cleanupTempWorkspace?: (workspacePath: string) => Promise<void>;
  now?: () => Date;
}

export async function runLocalCheck(
  runtime: RuntimeDescriptor,
  deps: RuntimeVerifierDeps = {},
): Promise<RuntimeVerificationResult> {
  const run = deps.run ?? createProcessRunner().run;
  const makeTempWorkspace = deps.createTempWorkspace ?? createTempWorkspace;
  const removeTempWorkspace = deps.cleanupTempWorkspace ?? cleanupTempWorkspace;
  const now = deps.now ?? (() => new Date());
  const workspacePath = await makeTempWorkspace();

  try {
    const result = await run(runtime.command, runtime.versionArgs, {
      cwd: workspacePath,
      timeoutMs: LOCAL_CHECK_TIMEOUT_MS,
    });
    return createVerificationResult(result, "Local check failed.", now);
  } finally {
    await removeTempWorkspace(workspacePath);
  }
}

export async function runModelPing(): Promise<RuntimeVerificationResult> {
  return { verification: "unsupported" };
}

function createVerificationResult(
  result: ProcessRunnerResult,
  fallbackMessage: string,
  now: () => Date,
): RuntimeVerificationResult {
  return {
    verification: result.ok ? "passed" : "failed",
    lastVerifiedAt: now().toISOString(),
    lastError: result.ok ? undefined : summarizeFailure(result, fallbackMessage),
  };
}

function summarizeFailure(result: ProcessRunnerResult, fallbackMessage: string): string {
  if (result.timedOut) return `${fallbackMessage} Timed out after ${LOCAL_CHECK_TIMEOUT_MS}ms.`;

  const source = firstNonEmptyLine(result.stderr) || firstNonEmptyLine(result.stdout);
  if (source) return truncateSummary(source);
  if (result.errorCode) return `${fallbackMessage} (${result.errorCode})`;
  if (result.exitCode != null) return `${fallbackMessage} Exit code ${result.exitCode}.`;
  return fallbackMessage;
}

function firstNonEmptyLine(value: string): string {
  return (
    value
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function truncateSummary(value: string): string {
  return value.length <= MAX_SUMMARY_CHARS
    ? value
    : `${value.slice(0, MAX_SUMMARY_CHARS - 3).trimEnd()}...`;
}
