import path from "node:path";
import fs from "node:fs";
import type { ProcessRunner } from "../runtime/processRunner";
import type { ChatTurnRequest } from "../../src/shared/chat";
import { runtimeNameMap, type RuntimeId } from "../../src/shared/runtimes";
import {
  DEFAULT_RUNTIME_MODE,
  getClaudeRuntimeModeArgs,
  getCodexRuntimeModeArgs,
  type RuntimeMode,
} from "../../src/shared/runtimeMode";
import { buildChatPrompt } from "./chatPrompt";

export interface ChatRunnerResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface ChatRunner {
  run: (request: ChatTurnRequest) => Promise<ChatRunnerResult>;
}

export type RuntimeCommandOptions = {
  allowLegacyRuntimeCommands?: boolean;
};

function getProjectlessChatCwd() {
  try {
    const { app } = require("electron");
    return path.join(app.getPath("userData"), "carrent-chat");
  } catch {
    return path.join(process.env.APPDATA || process.env.HOME || "/tmp", "carrent-chat");
  }
}

function resolveRequestCwd(request: ChatTurnRequest) {
  if (request.workspace.kind === "project") {
    return request.workspace.projectPath;
  }
  const cwd = getProjectlessChatCwd();
  fs.mkdirSync(cwd, { recursive: true });
  return cwd;
}

export function createChatRunner(
  processRunner: ProcessRunner,
  options: RuntimeCommandOptions = {},
): ChatRunner {
  return {
    async run(request) {
      const prompt = buildChatPrompt(request);

      let command: string;
      let args: string[];
      try {
        ({ command, args } = getRuntimeCommand(
          request.runtimeId,
          prompt,
          request.runtimeMode,
          request.runtimeModelId,
          options,
        ));
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Runtime is unavailable.",
        };
      }

      const result = await processRunner.run(command, args, {
        cwd: resolveRequestCwd(request),
        timeoutMs: 120_000,
      });

      if (result.timedOut) {
        return { ok: false, error: "Command timed out. Try again or simplify your request." };
      }

      if (!result.ok) {
        const err = result.stderr.trim() || `Command exited with code ${result.exitCode}`;
        return { ok: false, error: err };
      }

      const text = result.stdout.trim();
      if (!text) {
        return { ok: false, error: "Received empty response from runtime." };
      }

      return { ok: true, text };
    },
  };
}

export function getRuntimeCommand(
  runtimeId: RuntimeId,
  prompt: string,
  runtimeMode: RuntimeMode = DEFAULT_RUNTIME_MODE,
  runtimeModelId?: string,
  options: RuntimeCommandOptions = {},
): { command: string; args: string[] } {
  const unavailableMessage = getRuntimeCommandUnavailableMessage(runtimeId, options);
  if (unavailableMessage) {
    throw new Error(unavailableMessage);
  }

  switch (runtimeId) {
    case "kimi":
      throw new Error(getKimiAcpUnavailableMessage());
    case "codex":
      return {
        command: "codex",
        args: [
          "exec",
          "--skip-git-repo-check",
          "--ephemeral",
          ...getCodexRuntimeModeArgs(runtimeMode),
          prompt,
        ],
      };
    case "claude-code":
      return {
        command: "claude",
        args: ["--print", ...getClaudeRuntimeModeArgs(runtimeMode), prompt],
      };
    case "pi":
      return {
        command: "pi",
        args: [...(runtimeModelId ? ["--model", runtimeModelId] : []), "-p", prompt],
      };
    default:
      throw new Error(`Unknown runtime: ${runtimeId}`);
  }
}

export function getRuntimeCommandUnavailableMessage(
  runtimeId: RuntimeId,
  options: RuntimeCommandOptions = {},
) {
  if (runtimeId === "kimi") {
    return getKimiAcpUnavailableMessage();
  }

  if (!options.allowLegacyRuntimeCommands) {
    return `${runtimeNameMap[runtimeId]} is unavailable in Carrent V1. Use Kimi Code.`;
  }

  return null;
}

function getKimiAcpUnavailableMessage() {
  return "Kimi Code chat runs through ACP and is not supported by the legacy command runner.";
}
