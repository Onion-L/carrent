import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

import { createEditDiff } from "./edit-diff";
import { resolveToolPath } from "./paths";

const MAX_OUTPUT_BYTES = 200_000;
const DEFAULT_READ_LINES = 2_000;

export type FileToolDetails = {
  path: string;
  diff?: string;
  bytes?: number;
};

export type ProcessToolDetails = {
  command: string;
  cwd: string;
  exitCode: number | null;
};

function textResult<T>(text: string, details: T) {
  return { content: [{ type: "text" as const, text }], details };
}

function truncateOutput(value: string): string {
  if (Buffer.byteLength(value, "utf8") <= MAX_OUTPUT_BYTES) return value;
  return `${value.slice(0, MAX_OUTPUT_BYTES)}\n[output truncated]`;
}

async function runProcess(options: {
  command: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("Tool execution was cancelled.")));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("Tool execution timed out.")));
    }, options.timeoutMs ?? 120_000);
    child.stdout?.on("data", (chunk) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      if (stderr.length < MAX_OUTPUT_BYTES) stderr += String(chunk);
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (exitCode) => finish(() => resolve({ stdout, stderr, exitCode })));
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
  });
}

export function createAgentTools(workingDirectory: string): AgentTool[] {
  const read: AgentTool = {
    name: "read",
    label: "Read",
    description:
      "Read a UTF-8 text file. Paths may be absolute or relative to the project directory.",
    parameters: Type.Object({
      path: Type.String(),
      offset: Type.Optional(Type.Number({ minimum: 1 })),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 5000 })),
    }),
    execute: async (_id, params) => {
      const input = params as { path: string; offset?: number; limit?: number };
      const filePath = resolveToolPath(workingDirectory, input.path);
      const content = await readFile(filePath, "utf8");
      const lines = content.split("\n");
      const offset = Math.max(1, Math.floor(input.offset ?? 1));
      const limit = Math.min(5_000, Math.floor(input.limit ?? DEFAULT_READ_LINES));
      const selected = lines.slice(offset - 1, offset - 1 + limit);
      const numbered = selected.map((line, index) => `${offset + index}: ${line}`).join("\n");
      return textResult(truncateOutput(numbered), { path: filePath, bytes: content.length });
    },
  };

  const write: AgentTool = {
    name: "write",
    label: "Write",
    description: "Create or replace a UTF-8 text file.",
    parameters: Type.Object({ path: Type.String(), content: Type.String() }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const input = params as { path: string; content: string };
      const filePath = resolveToolPath(workingDirectory, input.path);
      let previous = "";
      try {
        previous = await readFile(filePath, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, input.content, "utf8");
      const diff = createEditDiff(filePath, previous, input.content);
      return textResult(`Wrote ${Buffer.byteLength(input.content, "utf8")} bytes to ${filePath}`, {
        path: filePath,
        bytes: Buffer.byteLength(input.content, "utf8"),
        diff,
      });
    },
  };

  const edit: AgentTool = {
    name: "edit",
    label: "Edit",
    description:
      "Replace an exact text fragment in a UTF-8 file. By default the old text must occur exactly once.",
    parameters: Type.Object({
      path: Type.String(),
      oldText: Type.String({ minLength: 1 }),
      newText: Type.String(),
      replaceAll: Type.Optional(Type.Boolean()),
    }),
    executionMode: "sequential",
    execute: async (_id, params) => {
      const input = params as {
        path: string;
        oldText: string;
        newText: string;
        replaceAll?: boolean;
      };
      const filePath = resolveToolPath(workingDirectory, input.path);
      const previous = await readFile(filePath, "utf8");
      const occurrences = previous.split(input.oldText).length - 1;
      if (occurrences === 0) throw new Error("The requested text was not found in the file.");
      if (!input.replaceAll && occurrences !== 1) {
        throw new Error(`The requested text occurs ${occurrences} times; provide a unique match.`);
      }
      const next = input.replaceAll
        ? previous.split(input.oldText).join(input.newText)
        : previous.replace(input.oldText, input.newText);
      await writeFile(filePath, next, "utf8");
      const diff = createEditDiff(filePath, previous, next);
      return textResult(diff, { path: filePath, bytes: Buffer.byteLength(next, "utf8"), diff });
    },
  };

  const bash: AgentTool = {
    name: "bash",
    label: "Bash",
    description: "Run a shell command in the project directory and return stdout and stderr.",
    parameters: Type.Object({
      command: Type.String({ minLength: 1 }),
      timeoutMs: Type.Optional(Type.Number({ minimum: 1000, maximum: 600000 })),
    }),
    executionMode: "sequential",
    execute: async (_id, params, signal) => {
      const input = params as { command: string; timeoutMs?: number };
      const shell = process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/zsh";
      const args =
        process.platform === "win32" ? ["/d", "/s", "/c", input.command] : ["-lc", input.command];
      const result = await runProcess({
        command: shell,
        args,
        cwd: workingDirectory,
        signal,
        timeoutMs: input.timeoutMs,
      });
      const output = truncateOutput(
        [result.stdout, result.stderr]
          .filter(Boolean)
          .join(result.stdout && result.stderr ? "\n" : ""),
      );
      if (result.exitCode !== 0) {
        throw new Error(output || `Command exited with code ${result.exitCode}.`);
      }
      return textResult(output || "Command completed with no output.", {
        command: input.command,
        cwd: workingDirectory,
        exitCode: result.exitCode,
      });
    },
  };

  const grep: AgentTool = {
    name: "grep",
    label: "Grep",
    description: "Search file contents with ripgrep.",
    parameters: Type.Object({
      pattern: Type.String({ minLength: 1 }),
      path: Type.Optional(Type.String()),
      glob: Type.Optional(Type.String()),
      maxResults: Type.Optional(Type.Number({ minimum: 1, maximum: 1000 })),
    }),
    execute: async (_id, params, signal) => {
      const input = params as {
        pattern: string;
        path?: string;
        glob?: string;
        maxResults?: number;
      };
      const searchPath = resolveToolPath(workingDirectory, input.path ?? ".");
      const args = [
        "--line-number",
        "--color",
        "never",
        "--max-count",
        String(input.maxResults ?? 200),
      ];
      if (input.glob) args.push("--glob", input.glob);
      args.push("--", input.pattern, searchPath);
      const result = await runProcess({ command: "rg", args, cwd: workingDirectory, signal });
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(result.stderr || `rg exited with code ${result.exitCode}.`);
      }
      return textResult(truncateOutput(result.stdout) || "No matches found.", {
        command: `rg ${args.join(" ")}`,
        cwd: workingDirectory,
        exitCode: result.exitCode,
      });
    },
  };

  const find: AgentTool = {
    name: "find",
    label: "Find",
    description: "Find files by glob pattern using ripgrep's file index.",
    parameters: Type.Object({
      pattern: Type.String({ minLength: 1 }),
      path: Type.Optional(Type.String()),
    }),
    execute: async (_id, params, signal) => {
      const input = params as { pattern: string; path?: string };
      const searchPath = resolveToolPath(workingDirectory, input.path ?? ".");
      const args = ["--files", "--glob", input.pattern, searchPath];
      const result = await runProcess({ command: "rg", args, cwd: workingDirectory, signal });
      if (result.exitCode !== 0 && result.exitCode !== 1) {
        throw new Error(result.stderr || `rg exited with code ${result.exitCode}.`);
      }
      return textResult(truncateOutput(result.stdout) || "No files found.", {
        command: `rg ${args.join(" ")}`,
        cwd: workingDirectory,
        exitCode: result.exitCode,
      });
    },
  };

  const ls: AgentTool = {
    name: "ls",
    label: "List Directory",
    description: "List the immediate entries in a directory.",
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    execute: async (_id, params) => {
      const input = params as { path?: string };
      const directory = resolveToolPath(workingDirectory, input.path ?? ".");
      const entries = await readdir(directory, { withFileTypes: true });
      const output = entries
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((entry) => `${entry.isDirectory() ? "d" : "f"} ${entry.name}`)
        .join("\n");
      return textResult(output || "Directory is empty.", { path: directory });
    },
  };

  return [read, write, edit, bash, grep, find, ls];
}
