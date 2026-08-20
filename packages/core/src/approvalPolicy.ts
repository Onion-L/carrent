import { realpath } from "node:fs/promises";
import path from "node:path";

import type { AgentMode, AgentApprovalAction } from "./types";
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

function readPathArgument(toolName: string, args: Record<string, unknown>): string | null {
  if (["read", "write", "edit", "grep", "find", "ls"].includes(toolName)) {
    return typeof args.path === "string" ? args.path : ".";
  }
  return null;
}

export async function classifyToolApproval(options: {
  toolName: string;
  args: unknown;
  workingDirectory: string;
  mode: AgentMode;
  additionalReadPaths?: string[];
}): Promise<ToolApprovalClassification> {
  const args =
    typeof options.args === "object" && options.args !== null
      ? (options.args as Record<string, unknown>)
      : {};
  const projectRoot = await realpath(options.workingDirectory);

  if (options.toolName === "bash") {
    const command = typeof args.command === "string" ? args.command : "";
    const classification = classifyCommand(command, projectRoot, options.mode);
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
    const authorizedReadRoots = writes
      ? []
      : await Promise.all(
          (options.additionalReadPaths ?? []).map((candidate) =>
            canonicalizePath(resolveToolPath(projectRoot, candidate)),
          ),
        );
    const authorizedRead = authorizedReadRoots.some((root) => isPathInside(root, canonical));
    const action: AgentApprovalAction = writes ? "write" : "read";
    const requiresApproval =
      (outsideProject && !authorizedRead) || (writes && options.mode === "ask");
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
