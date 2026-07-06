export type McpServerStatus = {
  enabled: boolean;
  running: boolean;
  url?: string;
  error?: string;
};

export function normalizeMcpServerStatus(value: unknown): McpServerStatus {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const running = typeof record.running === "boolean" ? record.running : false;
  const explicitEnabled = typeof record.enabled === "boolean" ? record.enabled : false;
  const url = typeof record.url === "string" && record.url.length > 0 ? record.url : undefined;
  const error =
    typeof record.error === "string" && record.error.length > 0 ? record.error : undefined;

  return {
    enabled: running || explicitEnabled,
    running,
    ...(url ? { url } : {}),
    ...(error ? { error } : {}),
  };
}
