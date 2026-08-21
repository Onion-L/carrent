export type ChatPermissionAction = "edit" | "write" | "shell" | "read" | "network" | "unknown";

export type ChatPermissionOptionKind =
  | "allow_once"
  | "allow_session"
  | "allow_always"
  | "reject_once";

export type ChatPermissionOption = {
  optionId: string;
  name: string;
  kind: ChatPermissionOptionKind;
};

export type ChatPermissionRequest = {
  id: string;
  runId: string;
  requestKey?: string;
  threadId: string;
  provider: "core";
  action: ChatPermissionAction;
  title: string;
  description?: string;
  command?: string;
  filePath?: string;
  toolName?: string;
  options: ChatPermissionOption[];
  createdAt: string;
  expiresAt: string;
  warning?: boolean;
};

export type ChatPermissionResponse = {
  permissionId: string;
  runId: string;
  optionId: string;
};

export const CHAT_PERMISSION_TIMEOUT_MS = 60_000;

export function isChatPermissionOptionKind(value: unknown): value is ChatPermissionOptionKind {
  return (
    value === "allow_once" ||
    value === "allow_session" ||
    value === "allow_always" ||
    value === "reject_once"
  );
}

export function buildPermissionExpiry(createdAt: string, timeoutMs = CHAT_PERMISSION_TIMEOUT_MS) {
  return new Date(new Date(createdAt).getTime() + timeoutMs).toISOString();
}
