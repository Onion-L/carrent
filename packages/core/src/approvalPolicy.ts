import { realpath } from "node:fs/promises";
import path from "node:path";

import type { AccessMode, AgentApprovalAction } from "./types";
import { classifyCommand } from "./commandPolicy";
import { parseSegments } from "./shellCommand";
import { canonicalizePath, isPathInside, resolveToolPath } from "./paths";
import type { PermissionRules } from "./rules";
import { prefixMatches } from "./rules";

export type ToolApprovalClassification = {
  action: AgentApprovalAction;
  requiresApproval: boolean;
  title: string;
  description?: string;
  path?: string;
  command?: string;
  allowAlwaysKey: string;
  normalizedCommand?: string;
  warning?: boolean;
  networkHost?: string;
  blocked?: boolean;
};

const READ_TOOLS = ["read", "grep", "find", "ls"];

export function extractNetworkHost(command: string): string | undefined {
  const matches = command.match(/https?:\/\/([^\s/'"]+)/gi) ?? [];
  if (matches.length === 0) return undefined;
  const candidate = matches[0];
  if (!candidate) return undefined;
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function readPathArgument(toolName: string, args: Record<string, unknown>): string | null {
  if ([...READ_TOOLS, "write", "edit"].includes(toolName)) {
    return typeof args.path === "string" ? args.path : ".";
  }
  return null;
}

function isProtectedProjectPath(canonical: string, projectRoot: string): boolean {
  return (
    isPathInside(path.join(projectRoot, ".git"), canonical) ||
    isPathInside(path.join(projectRoot, ".carrent"), canonical)
  );
}

export async function classifyToolApproval(options: {
  toolName: string;
  args: unknown;
  workingDirectory: string;
  access: AccessMode;
  rules?: PermissionRules;
}): Promise<ToolApprovalClassification> {
  const args =
    typeof options.args === "object" && options.args !== null
      ? (options.args as Record<string, unknown>)
      : {};
  const projectRoot = await realpath(options.workingDirectory);

  if (options.toolName === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    const classification = classifyCommand(command, projectRoot, options.access, options.rules);
    const normalizedCommand =
      parseSegments(command)?.flat().join(" ") ?? command.trim().replace(/\s+/g, " ");
    return {
      action: classification.action,
      requiresApproval: classification.requiresApproval,
      title:
        classification.action === "dangerous"
          ? "Run a potentially destructive command"
          : classification.action === "network"
            ? "Run a network command"
            : classification.outsideProject
              ? "Run a command that accesses files outside the project"
              : "Run a shell command",
      command,
      allowAlwaysKey: `${classification.action}:${normalizedCommand}`,
      normalizedCommand,
      warning: classification.action === "dangerous",
      ...(classification.blocked ? { blocked: true } : {}),
      ...(classification.action === "network" && extractNetworkHost(command)
        ? { networkHost: extractNetworkHost(command) }
        : {}),
    };
  }

  const inputPath = readPathArgument(options.toolName, args);
  if (inputPath !== null) {
    const resolved = resolveToolPath(projectRoot, inputPath);
    const canonical = await canonicalizePath(resolved);
    const outsideProject = !isPathInside(projectRoot, canonical);
    const writes = options.toolName === "write" || options.toolName === "edit";
    const action: AgentApprovalAction = writes ? "write" : "read";
    const ruleInput = [action, canonical];
    const blocked =
      options.rules?.user.some(
        (rule) => rule.decision === "forbidden" && prefixMatches(rule.prefix, ruleInput),
      ) ||
      options.rules?.project.some(
        (rule) => rule.decision === "forbidden" && prefixMatches(rule.prefix, ruleInput),
      );
    const explicitlyAllowed = options.rules?.user.some(
      (rule) => rule.decision === "allow" && prefixMatches(rule.prefix, ruleInput),
    );
    // Reads are free in every mode. Writes prompt outside the project in every
    // mode (the invariant), always under read-only, and for .git/.carrent
    // unless the mode is full-access.
    const requiresApproval = blocked
      ? false
      : explicitlyAllowed
        ? false
        : writes
          ? outsideProject ||
            options.access === "read-only" ||
            (isProtectedProjectPath(canonical, projectRoot) && options.access !== "full-access")
          : false;
    return {
      action,
      requiresApproval,
      title: `${writes ? "Modify" : "Read"} ${outsideProject ? "an external path" : "project files"}`,
      description: path.relative(projectRoot, canonical) || ".",
      path: canonical,
      allowAlwaysKey: `${action}:${canonical}`,
      ...(blocked ? { blocked: true } : {}),
    };
  }

  return {
    action: "dangerous",
    requiresApproval: true,
    title: `Run unknown tool ${options.toolName}`,
    allowAlwaysKey: `unknown:${options.toolName}`,
  };
}
