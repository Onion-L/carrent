export type RuntimeAvailability = "detected" | "unavailable";

export type RuntimeStatus = "running" | "stopped";

export type RuntimeConfigState = "configured" | "missing" | "unknown";

export type RuntimeVerificationState = "never" | "passed" | "failed" | "unsupported";

export type RuntimeId = "kimi" | "codex" | "claude-code" | "pi";

export const DEFAULT_RUNTIME_ID: RuntimeId = "kimi";

export const runtimeIds: RuntimeId[] = ["kimi", "codex", "claude-code", "pi"];

export interface RuntimeRecord {
  id: RuntimeId;
  name: string;
  command: string;
  path?: string;
  version?: string;
  availability: RuntimeAvailability;
  enabled: boolean;
  status: RuntimeStatus;
  configuration: RuntimeConfigState;
  verification: RuntimeVerificationState;
  lastCheckedAt?: string;
  lastVerifiedAt?: string;
  lastRestartedAt?: string;
  lastError?: string;
  supportsModelPing: boolean;
  pid?: number;
}

export interface RuntimeLocalCheck {
  mayUseTokens: false;
}

export interface RuntimeModelPingRequest {
  prompt: string;
  mayUseTokens: true;
}

export interface RuntimeVerificationResult {
  verification: RuntimeVerificationState;
  lastVerifiedAt?: string;
  lastError?: string;
}

export type RuntimeModelSource = "cli";

export interface RuntimeModelRecord {
  id: string;
  name: string;
  provider?: string;
  source: RuntimeModelSource;
  contextWindow?: string;
  maxOutput?: string;
  supportsThinking?: boolean;
  supportsImages?: boolean;
}

export type RuntimeModelListState = "listed" | "unsupported" | "failed";

export interface RuntimeModelListResult {
  state: RuntimeModelListState;
  models: RuntimeModelRecord[];
  defaultModelId?: string;
  lastListedAt?: string;
  lastError?: string;
}

interface RuntimeDescriptorBase {
  id: RuntimeId;
  name: string;
  command: string;
  versionArgs: string[];
  configMarkers: string[];
  detection: {
    localCheck: RuntimeLocalCheck;
  };
}

export interface RuntimeDescriptorWithModelPing extends RuntimeDescriptorBase {
  supportsModelPing: true;
  verification: {
    modelPing: RuntimeModelPingRequest;
  };
}

export interface RuntimeDescriptorWithoutModelPing extends RuntimeDescriptorBase {
  supportsModelPing: false;
  verification: {
    modelPing?: never;
  };
}

export type RuntimeDescriptor = RuntimeDescriptorWithModelPing | RuntimeDescriptorWithoutModelPing;

export const runtimeNameMap: Record<RuntimeId, string> = {
  kimi: "Kimi Code",
  codex: "Codex",
  "claude-code": "Claude Code",
  pi: "pi",
};

export function normalizeRuntimeId(value: unknown): RuntimeId {
  return runtimeIds.includes(value as RuntimeId) ? (value as RuntimeId) : DEFAULT_RUNTIME_ID;
}
