import { realpath } from "node:fs/promises";
import path from "node:path";

import type { AccessMode, AgentApprovalAction } from "./types";
import { classifyCommand } from "./commandPolicy";
import { canonicalizePath, isPathInside, resolveToolPath } from "./paths";

export type ToolApprovalClassification = {
  action: AgentApprovalAction;
  requiresApproval: boolean;
  title: string;
  description?: string;
  path?: string;
  command?: string;
  allowAlwaysKey: string;
};

const READ_TOOLS = ["read", "grep", "find", "ls"];

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
}): Promise<ToolApprovalClassification> {
  const args =
    typeof options.args === "object" && options.args !== null
      ? (options.args as Record<string, unknown>)
      : {};
  const projectRoot = await realpath(options.workingDirectory);

  if (options.toolName === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    const classification = classifyCommand(command, projectRoot, options.access);
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
      allowAlwaysKey: `${classification.action}:${command}`,
    };
  }

  const inputPath = readPathArgument(options.toolName, args);
  if (inputPath !== null) {
    const resolved = resolveToolPath(projectRoot, inputPath);
    const canonical = await canonicalizePath(resolved);
    const outsideProject = !isPathInside(projectRoot, canonical);
    const writes = options.toolName === "write" || options.toolName === "edit";
    const action: AgentApprovalAction = writes ? "write" : "read";
    // Reads are free in every mode. Writes prompt outside the project in every
    // mode (the invariant), always under read-only, and for .git/.carrent
    // unless the mode is full-access.
    const requiresApproval = writes
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
    };
  }

  return {
    action: "dangerous",
    requiresApproval: true,
    title: `Run unknown tool ${options.toolName}`,
    allowAlwaysKey: `unknown:${options.toolName}`,
  };
}
