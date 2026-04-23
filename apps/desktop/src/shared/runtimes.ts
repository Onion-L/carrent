export type RuntimeAvailability = "detected" | "unavailable";

export type RuntimeConfigState = "configured" | "missing" | "unknown";

export type RuntimeVerificationState =
  | "never"
  | "passed"
  | "failed"
  | "unsupported";

export type RuntimeId = "codex" | "claude-code";

export interface RuntimeRecord {
  id: RuntimeId;
  name: string;
  command: string;
  path?: string;
  version?: string;
  availability: RuntimeAvailability;
  configuration: RuntimeConfigState;
  verification: RuntimeVerificationState;
  lastCheckedAt?: string;
  lastVerifiedAt?: string;
  lastError?: string;
  supportsModelPing: boolean;
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

export interface RuntimeDescriptorWithoutModelPing
  extends RuntimeDescriptorBase {
  supportsModelPing: false;
  verification: {
    modelPing?: never;
  };
}

export type RuntimeDescriptor =
  | RuntimeDescriptorWithModelPing
  | RuntimeDescriptorWithoutModelPing;
