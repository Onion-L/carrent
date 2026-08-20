import path from "node:path";

import type { AgentApprovalAction, AgentMode } from "./types";
import { isPathInside } from "./paths";

const NETWORK_COMMAND =
  /(^|[;&|]\s*|\s)(curl|wget|ssh|scp|sftp|nc|ncat|telnet|ftp|gh\b|git\s+(fetch|pull|push|clone|ls-remote)|npm\s+(ci|install|publish)|npx\b|pnpm\s+(add|install|publish)|yarn\s+(add|install|publish)|bun\s+(install|add|publish|x)|bunx\b|pipx?\s+install|uv\s+(add|pip)|cargo\s+(install|publish)|brew\s+(install|update|upgrade)|docker\s+(login|pull|push)|kubectl\b)\b/i;
const DANGEROUS_COMMAND =
  /(^|[;&|]\s*|\s)(sudo\b|rm\b|rmdir\b|unlink\b|shred\b|truncate\b|dd\s+.*\bof=|mkfs\b|shutdown\b|reboot\b|diskutil\s+erase|find\s+.*\s-delete\b|git\s+reset\s+--hard\b|git\s+clean\s+-[a-z]*f|git\s+(checkout|restore)\s+--\b|git\s+branch\s+-[dD]\b|git\s+push\s+.*--force(?:-with-lease)?\b|chmod\s+-R\b|chown\s+-R\b|kill(?:all)?\b|pkill\b)/i;
const ABSOLUTE_PATH = /(?:^|\s|[><|;&])((?:\/[\w.@+~ -]+)+)/g;
const EXTERNAL_RELATIVE_PATH = /(?:^|\s|[><|;&])(?:\.\.\/|~\/)/;
const EXTERNAL_ENV_PATH = /\$(?:HOME|USERPROFILE)\b|\$\{(?:HOME|USERPROFILE)\}|%USERPROFILE%/i;
const SAFE_EXTERNAL_PATHS = new Set(["/dev/null"]);

export type CommandClassification = {
  action: Extract<AgentApprovalAction, "shell" | "network" | "dangerous">;
  outsideProject: boolean;
  requiresApproval: boolean;
};

export function classifyCommand(
  command: string,
  workingDirectory: string,
  mode: AgentMode,
): CommandClassification {
  const dangerous = DANGEROUS_COMMAND.test(command);
  const network = NETWORK_COMMAND.test(command);
  let outsideProject = false;
  for (const match of command.matchAll(ABSOLUTE_PATH)) {
    const candidate = match[1]?.trim();
    if (
      candidate &&
      !SAFE_EXTERNAL_PATHS.has(candidate) &&
      !isPathInside(workingDirectory, path.resolve(candidate))
    ) {
      outsideProject = true;
      break;
    }
  }
  if (EXTERNAL_RELATIVE_PATH.test(command) || EXTERNAL_ENV_PATH.test(command)) {
    outsideProject = true;
  }
  const action = dangerous ? "dangerous" : network ? "network" : "shell";
  return {
    action,
    outsideProject,
    requiresApproval: dangerous || network || outsideProject || mode !== "full-project",
  };
}
