export type RuntimeMode = "approval-required" | "auto-accept-edits" | "full-access";

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "approval-required";

export function isRuntimeMode(value: unknown): value is RuntimeMode {
  return value === "approval-required" || value === "auto-accept-edits" || value === "full-access";
}

export function normalizeRuntimeMode(value: unknown): RuntimeMode {
  return isRuntimeMode(value) ? value : DEFAULT_RUNTIME_MODE;
}

export function getRuntimeModeLabel(mode: RuntimeMode) {
  switch (mode) {
    case "approval-required":
      return "Approval required";
    case "auto-accept-edits":
      return "Auto-accept edits";
    case "full-access":
      return "Full access";
  }
}

export function getCodexRuntimeModeArgs(mode: RuntimeMode): string[] {
  switch (mode) {
    case "approval-required":
      return ["--sandbox", "read-only", "-c", 'approval_policy="on-request"'];
    case "auto-accept-edits":
      return ["--sandbox", "workspace-write", "-c", 'approval_policy="on-request"'];
    case "full-access":
      return ["--dangerously-bypass-approvals-and-sandbox"];
  }
}

export function getClaudeRuntimeModeArgs(mode: RuntimeMode): string[] {
  switch (mode) {
    case "approval-required":
      return ["--permission-mode", "default"];
    case "auto-accept-edits":
      return ["--permission-mode", "acceptEdits"];
    case "full-access":
      return ["--dangerously-skip-permissions"];
  }
}
