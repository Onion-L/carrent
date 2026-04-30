export type ChatPermissionAction = "edit" | "write" | "shell" | "read" | "network" | "unknown";

export type ChatPermissionDecision = "approved" | "denied";

export type ChatPermissionRequest = {
  id: string;
  runId: string;
  requestKey?: string;
  threadId: string;
  provider: "codex" | "claude-code" | "pi";
  action: ChatPermissionAction;
  title: string;
  description?: string;
  command?: string;
  filePath?: string;
  toolName?: string;
  createdAt: string;
  expiresAt: string;
};

export type ChatPermissionResponse = {
  permissionId: string;
  runId: string;
  decision: ChatPermissionDecision;
};

export const CHAT_PERMISSION_TIMEOUT_MS = 60_000;

export function isChatPermissionDecision(value: unknown): value is ChatPermissionDecision {
  return value === "approved" || value === "denied";
}

export function buildPermissionExpiry(createdAt: string, timeoutMs = CHAT_PERMISSION_TIMEOUT_MS) {
  return new Date(new Date(createdAt).getTime() + timeoutMs).toISOString();
}
