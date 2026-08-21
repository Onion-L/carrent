import path from "node:path";

import type { AgentApprovalAction, AgentMode } from "./types";
import { isPathInside } from "./paths";
import { findCommandWords } from "./shellCommand";

const NETWORK_COMMAND =
  /(^|[;&|]\s*|\s)(curl|wget|ssh|scp|sftp|nc|ncat|telnet|ftp|gh\b|git\s+(fetch|pull|push|clone|ls-remote)|npm\s+(ci|install|publish)|npx\b|pnpm\s+(add|install|publish)|yarn\s+(add|install|publish)|bun\s+(install|add|publish|x)|bunx\b|pipx?\s+install|uv\s+(add|pip)|cargo\s+(install|publish)|brew\s+(install|update|upgrade)|docker\s+(login|pull|push)|kubectl\b)\b/i;
const ABSOLUTE_PATH = /(?:^|\s|[><|;&])((?:\/[\w.@+~ -]+)+)/g;
const EXTERNAL_RELATIVE_PATH = /(?:^|\s|[><|;&])(?:\.\.\/|~\/)/;
const EXTERNAL_ENV_PATH = /\$(?:HOME|USERPROFILE)\b|\$\{(?:HOME|USERPROFILE)\}|%USERPROFILE%/i;
const SAFE_EXTERNAL_PATHS = new Set(["/dev/null"]);

const DANGEROUS_COMMANDS = new Set([
  "sudo",
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "truncate",
  "shutdown",
  "reboot",
  "kill",
  "killall",
  "pkill",
]);

/** Danger patterns matched as argv prefixes over command positions; the port of the former DANGEROUS_COMMAND regex. */
function isDangerousArgv(argv: string[]): boolean {
  const command = (argv[0] ?? "").toLowerCase();
  if (!command) return false;
  if (DANGEROUS_COMMANDS.has(command)) return true;
  if (command === "mkfs" || command.startsWith("mkfs.")) return true;

  const args = argv.slice(1);
  if (command === "dd") return args.some((arg) => /^of=/i.test(arg));
  if (command === "diskutil") return (argv[1] ?? "").toLowerCase().startsWith("erase");
  if (command === "find") return args.some((arg) => arg.toLowerCase() === "-delete");
  if (command === "chmod" || command === "chown") {
    return args.some((arg) => arg.toLowerCase() === "-r");
  }

  if (command !== "git") return false;
  const subcommand = (argv[1] ?? "").toLowerCase();
  const subArgs = argv.slice(2);
  switch (subcommand) {
    case "reset":
      return subArgs.some((arg) => arg.toLowerCase() === "--hard");
    case "clean":
      return subArgs.some((arg) => /^-[a-z]*f/i.test(arg));
    case "checkout":
    case "restore":
      return subArgs.includes("--");
    case "branch":
      return subArgs.some((arg) => arg === "-d" || arg === "-D");
    case "push":
      return subArgs.some((arg) => /^--force(-with-lease)?(=|$)/i.test(arg));
    default:
      return false;
  }
}

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
  // Fail closed: an unparseable command is treated as dangerous.
  const commandWords = findCommandWords(command);
  const dangerous = commandWords === null || commandWords.some(isDangerousArgv);
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
