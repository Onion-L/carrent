export type ChatPermissionAction = "edit" | "write" | "shell" | "read" | "network" | "unknown";

export type ChatPermissionOptionKind = "allow_once" | "allow_always" | "reject_once";

export type ChatPermissionOption = {
  optionId: string;
  name: string;
  kind: ChatPermissionOptionKind;
};

export type ChatPlanReview = {
  content: string;
};

export type ChatPermissionRequest = {
  id: string;
  runId: string;
  requestKey?: string;
  threadId: string;
  provider: "kimi" | "codex" | "claude-code" | "pi";
  action: ChatPermissionAction;
  title: string;
  description?: string;
  command?: string;
  filePath?: string;
  toolName?: string;
  options: ChatPermissionOption[];
  planReview?: ChatPlanReview;
  createdAt: string;
  expiresAt: string;
};

export type ChatPermissionResponse = {
  permissionId: string;
  runId: string;
  optionId: string;
};

export const CHAT_PERMISSION_TIMEOUT_MS = 60_000;

export function isChatPermissionOptionKind(value: unknown): value is ChatPermissionOptionKind {
  return value === "allow_once" || value === "allow_always" || value === "reject_once";
}

export function buildPermissionExpiry(createdAt: string, timeoutMs = CHAT_PERMISSION_TIMEOUT_MS) {
  return new Date(new Date(createdAt).getTime() + timeoutMs).toISOString();
}
