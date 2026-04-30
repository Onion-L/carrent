import type { RuntimeId } from "../../src/shared/runtimes";

export type ProviderApprovalCapability =
  | { supported: true; responseChannel: "stdin" | "pty" | "sdk" }
  | { supported: false; reason: string };

/**
 * Returns the approval capability for a given provider.
 *
 * Based on the provider-approval-spike.md findings (2026-04-27):
 * - Codex exec mode has no stdin-based interactive approval protocol
 * - Claude --print mode uses AskUserQuestion which only works in interactive TUI
 *
 * Both providers currently require interactive TUI mode for approval flows,
 * which is not available in our headless chat execution context.
 */
export function getProviderApprovalCapability(_runtimeId: RuntimeId): ProviderApprovalCapability {
  switch (_runtimeId) {
    case "codex":
      return {
        supported: false,
        reason:
          "Codex exec mode does not support interactive stdin-based approval. Approval requests require interactive TUI mode.",
      };
    case "claude-code":
      return {
        supported: false,
        reason:
          "Claude --print mode does not support interactive stdin-based approval. Approval requests use AskUserQuestion tool which requires interactive TUI.",
      };
    case "pi":
      return {
        supported: false,
        reason: "Pi provider does not support interactive approvals in this implementation.",
      };
    default:
      return {
        supported: false,
        reason: `Unknown provider: ${_runtimeId}`,
      };
  }
}

/**
 * Candidate permission request before being enriched with run metadata.
 */
export type ProviderPermissionCandidate = {
  id: string;
  provider: "codex" | "claude-code" | "pi";
  action: "edit" | "write" | "shell" | "read" | "network" | "unknown";
  title: string;
  description?: string;
  command?: string;
  filePath?: string;
  toolName?: string;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

/**
 * Extracts a permission request from a Codex JSON event payload.
 * Returns null if the payload is not a permission request event.
 *
 * Based on spike observations, Codex exec --json does not emit permission_request
 * events in the current implementation - it executes commands directly.
 * This function exists for future-proofing if Codex adds this protocol.
 */
export function extractCodexPermissionRequest(
  _payload: unknown,
): ProviderPermissionCandidate | null {
  const envelope = readObject(_payload);
  if (!envelope) {
    return null;
  }

  // Codex permission_request event structure (if added in future)
  // { type: "permission_request", id: "...", action: "...", file_path: "...", tool_name: "..." }
  if (envelope.type !== "permission_request") {
    return null;
  }

  const id = readString(envelope.id);
  const action = readString(envelope.action);
  const filePath = readString(envelope.file_path);
  const toolName = readString(envelope.tool_name);

  if (!id) {
    return null;
  }

  let normalizedAction: ProviderPermissionCandidate["action"] = "unknown";
  if (action === "edit" || action === "write") {
    normalizedAction = "edit";
  } else if (action === "shell" || action === "bash") {
    normalizedAction = "shell";
  } else if (action === "read") {
    normalizedAction = "read";
  } else if (action === "network") {
    normalizedAction = "network";
  }

  const title = filePath
    ? `${normalizedAction === "shell" ? "Run command" : "Edit file"}: ${filePath}`
    : `Permission request: ${action ?? "unknown"}`;

  return {
    id,
    provider: "codex",
    action: normalizedAction,
    title,
    description: `Codex permission request for ${action} operation`,
    filePath: filePath ?? undefined,
    toolName: toolName ?? undefined,
  };
}

/**
 * Extracts a permission request from a Claude stream-json event.
 * Returns null if the payload does not contain a permission-denied tool result.
 *
 * From spike observations, when Claude needs permission in --print mode with
 * stream-json output, it emits a tool_result with is_error:true containing
 * "Claude requested permissions to write to..." The AskUserQuestion tool
 * then fails because there's no interactive user.
 *
 * We detect this by checking for the permission denial error pattern.
 */
export function extractClaudePermissionRequest(
  _payload: unknown,
): ProviderPermissionCandidate | null {
  const envelope = readObject(_payload);
  if (!envelope) {
    return null;
  }

  // Claude permission denial comes as a tool_result with is_error
  // { type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "Claude requested permissions to..." }] } }
  if (envelope.type !== "user") {
    return null;
  }

  const message = readObject(envelope.message);
  const content = message?.content;

  if (!Array.isArray(content)) {
    return null;
  }

  for (const item of content) {
    const block = readObject(item);
    if (block?.type !== "tool_result" || block?.is_error !== true) {
      continue;
    }

    const contentText = typeof block.content === "string" ? block.content : null;
    if (!contentText) {
      continue;
    }

    // Detect permission request patterns
    const writeMatch = contentText.match(
      /Claude requested permissions? to (write|edit|read|execute|network)/i,
    );
    const toolMatch = contentText.match(/Claude requested permissions? to use ([\w]+)/i);

    if (writeMatch || toolMatch) {
      const actionStr = writeMatch ? writeMatch[1].toLowerCase() : "unknown";
      const toolName = toolMatch ? toolMatch[1] : undefined;

      let normalizedAction: ProviderPermissionCandidate["action"] = "unknown";
      if (actionStr === "write" || actionStr === "edit") {
        normalizedAction = "edit";
      } else if (actionStr === "execute" || actionStr === "shell") {
        normalizedAction = "shell";
      } else if (actionStr === "read") {
        normalizedAction = "read";
      } else if (actionStr === "network") {
        normalizedAction = "network";
      }

      // Extract file path if present
      const filePathMatch = contentText.match(/to (?:write|edit|read) `?([^`"]+)`?/i);

      return {
        id: `claude-perm-${Date.now()}`,
        provider: "claude-code",
        action: normalizedAction,
        title: `Claude permission request: ${actionStr}`,
        description: contentText,
        filePath: filePathMatch ? filePathMatch[1] : undefined,
        toolName,
      };
    }
  }

  return null;
}
