import type { RuntimeId } from "./runtimes";

export type RuntimeMode = "approval-required" | "auto-accept-edits" | "full-access";

export const DEFAULT_RUNTIME_MODE: RuntimeMode = "approval-required";

export function isRuntimeMode(value: unknown): value is RuntimeMode {
  return value === "approval-required" || value === "auto-accept-edits" || value === "full-access";
}

export function normalizeRuntimeMode(value: unknown): RuntimeMode {
  return isRuntimeMode(value) ? value : DEFAULT_RUNTIME_MODE;
}

export function getRuntimeModeLabel(mode: RuntimeMode, runtimeId?: RuntimeId) {
  void runtimeId;
  switch (mode) {
    case "approval-required":
      return "Approval required";
    case "auto-accept-edits":
      return "Auto";
    case "full-access":
      return "Yolo";
  }
}
