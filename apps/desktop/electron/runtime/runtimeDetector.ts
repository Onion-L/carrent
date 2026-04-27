import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RuntimeDescriptor, RuntimeRecord } from "../../src/shared/runtimes";
import { createProcessRunner, type ProcessRunner } from "./processRunner";

const DEFAULT_TIMEOUT_MS = 5000;
const MAX_ERROR_LENGTH = 120;
const DETECTION_CWD = os.homedir();

interface RuntimeDetectorDeps {
  pathExists?: (targetPath: string) => Promise<boolean>;
  run?: ProcessRunner["run"];
  platform?: NodeJS.Platform;
}

export async function detectRuntime(
  runtime: RuntimeDescriptor,
  deps: RuntimeDetectorDeps = {},
): Promise<RuntimeRecord> {
  const run = deps.run ?? createProcessRunner().run;
  const pathExists = deps.pathExists ?? defaultPathExists;
  const platform = deps.platform ?? process.platform;
  const checkedAt = new Date().toISOString();
  const lookupCommand = platform === "win32" ? "where" : "which";

  const commandLookup = await run(lookupCommand, [runtime.command], {
    cwd: DETECTION_CWD,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });

  if (!commandLookup.ok) {
    return {
      id: runtime.id,
      name: runtime.name,
      command: runtime.command,
      availability: "unavailable",
      status: "stopped",
      configuration: "unknown",
      verification: "never",
      lastCheckedAt: checkedAt,
      supportsModelPing: runtime.supportsModelPing,
    };
  }

  const detectedPath = firstNonEmptyLine(commandLookup.stdout);
  const versionResult = await run(runtime.command, runtime.versionArgs, {
    cwd: DETECTION_CWD,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  const configuration = await detectConfiguration(runtime, pathExists);
  const processStatus = await detectProcessStatus(runtime.command, platform, run);

  return {
    id: runtime.id,
    name: runtime.name,
    command: runtime.command,
    path: detectedPath || undefined,
    version: versionResult.ok
      ? firstNonEmptyLine(versionResult.stdout) ||
        firstNonEmptyLine(versionResult.stderr) ||
        undefined
      : undefined,
    availability: "detected",
    status: processStatus.status,
    configuration,
    verification: "never",
    lastCheckedAt: checkedAt,
    lastError: versionResult.ok
      ? undefined
      : summarizeError(versionResult.stderr, versionResult.stdout),
    supportsModelPing: runtime.supportsModelPing,
    pid: processStatus.pid,
  };
}

async function detectProcessStatus(
  command: string,
  platform: NodeJS.Platform,
  run: ProcessRunner["run"],
): Promise<{ status: "running" | "stopped"; pid?: number }> {
  if (platform === "win32") {
    const result = await run("tasklist", ["/FI", `IMAGENAME eq ${command}.exe`, "/NH"], {
      cwd: DETECTION_CWD,
    });
    if (result.ok && result.stdout.toLowerCase().includes(command.toLowerCase())) {
      const match = result.stdout.match(/(\d+)/);
      return { status: "running", pid: match ? Number(match[1]) : undefined };
    }
    return { status: "stopped" };
  }

  const result = await run("pgrep", ["-x", command], {
    cwd: DETECTION_CWD,
  });
  if (result.ok) {
    const pid = Number(firstNonEmptyLine(result.stdout));
    if (Number.isFinite(pid) && pid > 0) {
      return { status: "running", pid };
    }
  }
  return { status: "stopped" };
}

async function detectConfiguration(
  runtime: RuntimeDescriptor,
  pathExists: (targetPath: string) => Promise<boolean>,
) {
  for (const marker of runtime.configMarkers) {
    if (await pathExists(expandHomeDir(marker))) {
      return "configured" as const;
    }
  }

  return "missing" as const;
}

async function defaultPathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function expandHomeDir(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  if (!path.isAbsolute(inputPath)) {
    return path.join(os.homedir(), inputPath);
  }

  return inputPath;
}

function firstNonEmptyLine(value: string): string {
  return (
    value
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? ""
  );
}

function summarizeError(stderr: string, stdout: string): string | undefined {
  const source = firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);

  if (!source) {
    return undefined;
  }

  if (source.length <= MAX_ERROR_LENGTH) {
    return source;
  }

  return `${source.slice(0, MAX_ERROR_LENGTH - 3).trimEnd()}...`;
}
