import type { ProcessRunner } from "../runtime/processRunner";
import type { ChatTurnRequest } from "../../src/shared/chat";
import { buildChatPrompt } from "./chatPrompt";

export interface ChatRunnerResult {
  ok: boolean;
  text?: string;
  error?: string;
}

export interface ChatRunner {
  run: (request: ChatTurnRequest) => Promise<ChatRunnerResult>;
}

export function createChatRunner(processRunner: ProcessRunner): ChatRunner {
  return {
    async run(request) {
      const prompt = buildChatPrompt(request);

      const { command, args } = getRuntimeCommand(request.runtimeId, prompt);

      const result = await processRunner.run(command, args, {
        cwd: request.projectPath,
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
        return { ok: false, error: "Received empty response from agent." };
      }

      return { ok: true, text };
    },
  };
}

export function getRuntimeCommand(
  runtimeId: "codex" | "claude-code",
  prompt: string,
): { command: string; args: string[] } {
  switch (runtimeId) {
    case "codex":
      return {
        command: "codex",
        args: ["exec", "--skip-git-repo-check", "--ephemeral", prompt],
      };
    case "claude-code":
      return {
        command: "claude",
        args: ["--print", prompt],
      };
    default:
      throw new Error(`Unknown runtime: ${runtimeId}`);
  }
}
