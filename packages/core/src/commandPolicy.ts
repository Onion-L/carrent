import path from "node:path";

import type { AccessMode, AgentApprovalAction } from "./types";
import { isPathInside } from "./paths";
import { prefixMatches, type PermissionRule, type PermissionRules } from "./rules";
import { findCommandWords, parseSegments } from "./shellCommand";

// Loose literal scans, kept as the backstop for commands the strict parser cannot prove.
const ABSOLUTE_PATH = /(?:^|\s|[><|;&])((?:\/[\w.@+~ -]+)+)/g;
const EXTERNAL_RELATIVE_PATH = /(?:^|\s|[><|;&])(?:\.\.\/|~\/)/;
const EXTERNAL_ENV_PATH = /\$(?:HOME|USERPROFILE)\b|\$\{(?:HOME|USERPROFILE)\}|%USERPROFILE%/i;
const SAFE_EXTERNAL_PATHS = new Set(["/dev/null"]);

const NETWORK_COMMANDS = new Set([
  "curl",
  "wget",
  "ssh",
  "scp",
  "sftp",
  "nc",
  "ncat",
  "telnet",
  "ftp",
  "gh",
  "npx",
  "bunx",
  "kubectl",
]);
const NETWORK_SUBCOMMANDS: Record<string, Set<string>> = {
  git: new Set(["fetch", "pull", "push", "clone", "ls-remote"]),
  npm: new Set(["ci", "install", "publish"]),
  pnpm: new Set(["add", "install", "publish"]),
  yarn: new Set(["add", "install", "publish"]),
  bun: new Set(["install", "add", "publish", "x"]),
  pip: new Set(["install"]),
  pipx: new Set(["install"]),
  uv: new Set(["add", "pip"]),
  cargo: new Set(["install", "publish"]),
  brew: new Set(["install", "update", "upgrade"]),
  docker: new Set(["login", "pull", "push"]),
};

// Loose backstop for unprovable commands, derived from the same tables so the
// two representations cannot drift.
const NETWORK_COMMAND = new RegExp(
  `(^|[;&|]\\s*|\\s)(${[
    ...NETWORK_COMMANDS,
    ...Object.entries(NETWORK_SUBCOMMANDS).map(
      ([command, subcommands]) => `${command}\\s+(${[...subcommands].join("|")})`,
    ),
  ].join("|")})\\b`,
  "i",
);

const DANGEROUS_COMMANDS = new Set([
  "sudo",
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

const RM_FORCE_FLAG = /^-[a-z]*[rf]/i;

function rmHasForceFlags(args: string[]): boolean {
  return args.some((arg) => RM_FORCE_FLAG.test(arg) || arg === "--force" || arg === "--recursive");
}

/** Danger patterns matched as argv prefixes over command positions. */
function isDangerousArgv(argv: string[]): boolean {
  const command = (argv[0] ?? "").toLowerCase();
  if (!command) return false;
  if (DANGEROUS_COMMANDS.has(command)) return true;
  if (command === "mkfs" || command.startsWith("mkfs.")) return true;

  const args = argv.slice(1);
  if (command === "rm") return rmHasForceFlags(args);
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

function isNetworkArgv(argv: string[]): boolean {
  const command = (argv[0] ?? "").toLowerCase();
  if (NETWORK_COMMANDS.has(command)) return true;
  return NETWORK_SUBCOMMANDS[command]?.has((argv[1] ?? "").toLowerCase()) ?? false;
}

function isPlainRmArgv(argv: string[]): boolean {
  return (argv[0] ?? "").toLowerCase() === "rm" && !rmHasForceFlags(argv.slice(1));
}

/**
 * Path candidates in an argv: bare non-flag tokens, `--flag=value` values,
 * and values joined onto short flags (`-o/tmp/x`). Without per-command
 * knowledge every candidate is scope-checked; over-checking only ever adds
 * a prompt, never removes one.
 */
function pathCandidates(argv: string[]): string[] {
  const candidates: string[] = [];
  for (const token of argv) {
    if (!token) continue;
    if (!token.startsWith("-")) {
      candidates.push(token);
      continue;
    }
    const longValue = /^--[^=]+=(.+)$/.exec(token);
    if (longValue) {
      candidates.push(longValue[1]);
      continue;
    }
    const slash = token.indexOf("/");
    if (slash > 1) candidates.push(token.slice(slash));
  }
  return candidates;
}

function isOutsidePath(token: string, projectRoot: string): boolean {
  if (SAFE_EXTERNAL_PATHS.has(token)) return false;
  return !isPathInside(projectRoot, path.resolve(projectRoot, token));
}

function looseOutsideScan(command: string, projectRoot: string): boolean {
  for (const match of command.matchAll(ABSOLUTE_PATH)) {
    const candidate = match[1]?.trim();
    if (
      candidate &&
      !SAFE_EXTERNAL_PATHS.has(candidate) &&
      !isPathInside(projectRoot, path.resolve(candidate))
    ) {
      return true;
    }
  }
  return EXTERNAL_RELATIVE_PATH.test(command) || EXTERNAL_ENV_PATH.test(command);
}

export type CommandClassification = {
  action: Extract<AgentApprovalAction, "shell" | "network" | "dangerous">;
  outsideProject: boolean;
  requiresApproval: boolean;
  blocked?: boolean;
};

function ruleMatches(rule: PermissionRule, commandWords: string[][], command: string): boolean {
  const hostMatches = rule.domain
    ? [...command.matchAll(/https?:\/\/([^\s/'"]+)/gi)].some((match) => {
        const host = match[1]?.toLowerCase().replace(/\.$/u, "");
        return host === rule.domain || host?.endsWith(`.${rule.domain}`);
      })
    : false;
  return hostMatches || commandWords.some((argv) => prefixMatches(rule.prefix, argv));
}

export function classifyCommand(
  command: string,
  workingDirectory: string,
  access: AccessMode,
  rules?: PermissionRules,
): CommandClassification {
  // Fail closed: an unparseable command is treated as dangerous.
  const commandWords = findCommandWords(command);
  const dangerous = commandWords === null || commandWords.some(isDangerousArgv);

  // Network and outside-project checks run on parser output when the command
  // is provable; the loose literal scans are the backstop when it is not.
  const segments = parseSegments(command);
  const network =
    segments === null ? NETWORK_COMMAND.test(command) : (commandWords ?? []).some(isNetworkArgv);
  const outsideProject =
    segments === null
      ? looseOutsideScan(command, workingDirectory)
      : segments.some((argv) =>
          pathCandidates(argv).some((token) => isOutsidePath(token, workingDirectory)),
        );
  const plainRm = (commandWords ?? []).some(isPlainRmArgv);

  const userForbidden =
    rules?.user.some(
      (rule) => rule.decision === "forbidden" && ruleMatches(rule, commandWords ?? [], command),
    ) ?? false;
  const projectForbidden =
    rules?.project.some(
      (rule) => rule.decision === "forbidden" && ruleMatches(rule, commandWords ?? [], command),
    ) ?? false;
  const projectPrompt =
    rules?.project.some(
      (rule) => rule.decision === "prompt" && ruleMatches(rule, commandWords ?? [], command),
    ) ?? false;
  const userAllow =
    rules?.user.some(
      (rule) => rule.decision === "allow" && ruleMatches(rule, commandWords ?? [], command),
    ) ?? false;
  const userPrompt =
    rules?.user.some(
      (rule) => rule.decision === "prompt" && ruleMatches(rule, commandWords ?? [], command),
    ) ?? false;

  const action = dangerous ? "dangerous" : network ? "network" : "shell";
  let requiresApproval: boolean;
  const blocked = userForbidden || projectForbidden;
  if (blocked) {
    requiresApproval = false;
  } else if (rules?.malformed || projectPrompt || userPrompt) {
    requiresApproval = true;
  } else if (outsideProject) {
    requiresApproval = true;
  } else if (userAllow) {
    // Explicit user rules are the only rules allowed to override built-in
    // danger/network heuristics. They never bypass the outside-project guard.
    requiresApproval = false;
  } else if (dangerous || network) {
    // Danger, network, and the outside-project invariant prompt in every mode.
    requiresApproval = true;
  } else if (access === "read-only") {
    requiresApproval = true;
  } else if (segments === null) {
    // Writable modes only run provably safe commands for free.
    requiresApproval = true;
  } else if (access === "workspace-write") {
    requiresApproval = plainRm;
  } else {
    requiresApproval = false;
  }
  return { action, outsideProject, requiresApproval, ...(blocked ? { blocked: true } : {}) };
}
