export type McpServerStatus = {
  enabled: boolean;
  running: boolean;
  error?: string;
};

export function normalizeMcpServerStatus(value: unknown): McpServerStatus {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const running = typeof record.running === "boolean" ? record.running : false;
  const explicitEnabled = typeof record.enabled === "boolean" ? record.enabled : false;
  const error =
    typeof record.error === "string" && record.error.length > 0 ? record.error : undefined;

  return {
    enabled: running || explicitEnabled,
    running,
    ...(error ? { error } : {}),
  };
}
