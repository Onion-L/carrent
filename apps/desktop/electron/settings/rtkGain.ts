import { execFile } from "node:child_process";
import os from "node:os";
import type { RtkGainStats } from "../../src/shared/rtk";

const RTK_GAIN_TIMEOUT_MS = 10_000;
const EXTRA_CLI_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/opt/local/bin",
  `${os.homedir()}/.local/bin`,
  `${os.homedir()}/.bun/bin`,
];

type ExecFileRunner = (
  command: string,
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;

const defaultRunner: ExecFileRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr }));
        return;
      }

      resolve({ stdout, stderr });
    });
  });

export async function getRtkGainStats(
  deps: { runner?: ExecFileRunner } = {},
): Promise<RtkGainStats> {
  const lastCheckedAt = new Date().toISOString();
  const runner = deps.runner ?? defaultRunner;

  try {
    const { stdout } = await runner("rtk", ["gain"], {
      timeout: RTK_GAIN_TIMEOUT_MS,
      env: getCliEnv(),
    });
    return {
      ...parseRtkGain(stdout),
      available: true,
      lastCheckedAt,
    };
  } catch {
    try {
      const { stdout } = await runner(getShellPath(), ["-lc", "rtk gain"], {
        timeout: RTK_GAIN_TIMEOUT_MS,
        env: process.env,
      });
      return {
        ...parseRtkGain(stdout),
        available: true,
        lastCheckedAt,
      };
    } catch (fallbackError) {
      return {
        available: false,
        totalCommands: 0,
        inputTokens: 0,
        outputTokens: 0,
        tokensSaved: 0,
        efficiency: 0,
        lastCheckedAt,
        error: normalizeRtkError(fallbackError),
      };
    }
  }
}

export function parseRtkGain(output: string): Omit<RtkGainStats, "available" | "lastCheckedAt"> {
  return {
    totalCommands: parseIntegerField(output, "Total commands"),
    inputTokens: parseTokenField(output, "Input tokens"),
    outputTokens: parseTokenField(output, "Output tokens"),
    tokensSaved: parseTokenField(output, "Tokens saved"),
    efficiency: parseEfficiency(output),
  };
}

function parseIntegerField(output: string, label: string) {
  const match = new RegExp(`${escapeRegExp(label)}:\\s*([\\d,]+)`, "u").exec(output);
  if (!match) return 0;
  return Number.parseInt(match[1].replace(/,/gu, ""), 10) || 0;
}

function parseTokenField(output: string, label: string) {
  const match = new RegExp(`${escapeRegExp(label)}:\\s*([\\d,.]+)\\s*([KMB])?`, "iu").exec(output);
  if (!match) return 0;

  const value = Number.parseFloat(match[1].replace(/,/gu, ""));
  if (!Number.isFinite(value)) return 0;

  const unit = match[2]?.toUpperCase();
  const multiplier =
    unit === "B" ? 1_000_000_000 : unit === "M" ? 1_000_000 : unit === "K" ? 1_000 : 1;
  return Math.round(value * multiplier);
}

function parseEfficiency(output: string) {
  const savedLineMatch = /Tokens saved:\s*[\d,.]+\s*[KMB]?\s*\(([\d.]+)%\)/iu.exec(output);
  const meterMatch = /Efficiency meter:\s*.+?\s+([\d.]+)%/iu.exec(output);
  const value = Number.parseFloat(savedLineMatch?.[1] ?? meterMatch?.[1] ?? "0");
  return Number.isFinite(value) ? value : 0;
}

function getCliEnv(): NodeJS.ProcessEnv {
  const existingPath = process.env.PATH ?? "";
  const pathParts = [...EXTRA_CLI_PATHS, existingPath].filter(Boolean);
  return {
    ...process.env,
    PATH: pathParts.join(":"),
  };
}

function getShellPath() {
  const shell = process.env.SHELL;
  return shell && shell.startsWith("/") ? shell : "/bin/zsh";
}

function normalizeRtkError(error: unknown) {
  const stderr = readErrorStderr(error);
  if (isErrorWithCode(error, "ENOENT")) {
    return "rtk command not found";
  }
  return (
    stderr.trim() ||
    (error instanceof Error ? error.message : "") ||
    "Failed to read RTK gain stats."
  );
}

function readErrorStderr(error: unknown) {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    return typeof stderr === "string" ? stderr : "";
  }

  return "";
}

function isErrorWithCode(error: unknown, code: string) {
  return !!error && typeof error === "object" && "code" in error && error.code === code;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
