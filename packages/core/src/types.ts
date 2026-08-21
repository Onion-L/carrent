import type { AgentEvent, StreamFn } from "@earendil-works/pi-agent-core";
import type { Credential } from "@earendil-works/pi-ai";
import type { PermissionRules } from "./rules";

export type AgentMode = "ask" | "auto-edit" | "full-project";

/** Access axis of the permission model; `AgentMode` values double as preset ids over it (ADR 0015). */
export type AccessMode = "read-only" | "workspace-write" | "full-access";

export function accessModeOf(mode: AgentMode): AccessMode {
  switch (mode) {
    case "ask":
      return "read-only";
    case "auto-edit":
      return "workspace-write";
    case "full-project":
      return "full-access";
  }
}

export type ProviderProfileType = "anthropic" | "openai-compatible" | "kimi-coding";

export type ProviderProfileModel = { id: string; name: string };

export type ProviderProfile = {
  id: string;
  type: ProviderProfileType;
  apiKey?: string;
  credential?: Credential;
  baseUrl: string;
  modelId: string;
  thinking?: boolean;
  /** User-selected model list; when absent the provider catalog applies. */
  models?: ProviderProfileModel[];
};

export type AgentAuthFile = {
  version: 1;
  activeProfileId: string;
  profiles: Record<string, ProviderProfile>;
};

export type AgentTranscriptMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentApprovalAction = "read" | "write" | "shell" | "network" | "dangerous";

export type AgentApprovalRequest = {
  id: string;
  toolCallId: string;
  toolName: string;
  action: AgentApprovalAction;
  title: string;
  description?: string;
  path?: string;
  command?: string;
  allowAlwaysKey: string;
  normalizedCommand?: string;
  warning?: boolean;
  networkHost?: string;
};

export type AgentApprovalDecision = "allow_once" | "allow_session" | "allow_always" | "reject";

export type AgentCoreEvent =
  | {
      type: "run-context";
      systemPrompt: string;
      messages: unknown[];
      model: {
        profileId: string;
        providerType: ProviderProfileType;
        baseUrl: string;
        modelId: string;
      };
      tools: Array<{
        name: string;
        label: string;
        description: string;
        parameters: unknown;
      }>;
    }
  | { type: "text-delta"; delta: string }
  | { type: "thinking_delta"; delta: string }
  | { type: "tool-start"; toolCallId: string; toolName: string; args: unknown }
  | { type: "tool-update"; toolCallId: string; toolName: string; update: unknown }
  | {
      type: "tool-end";
      toolCallId: string;
      toolName: string;
      result: unknown;
      isError: boolean;
    }
  | { type: "agent-event"; event: AgentEvent };

export type AgentRunInput = {
  id: string;
  workingDirectory: string;
  profile: ProviderProfile;
  mode: AgentMode;
  transcript: AgentTranscriptMessage[];
  prompt: string;
  systemPrompt?: string;
  rules?: PermissionRules;
  trustedProject?: boolean;
  requestApproval: (request: AgentApprovalRequest) => Promise<AgentApprovalDecision>;
  onEvent?: (event: AgentCoreEvent) => void | Promise<void>;
};

export type AgentRunResult = {
  text: string;
  messages: unknown[];
};

export type AgentRunHandle = {
  result: Promise<AgentRunResult>;
  cancel: () => void;
};

export type AgentCoreDependencies = {
  streamFn?: StreamFn;
  now?: () => number;
  homeDirectory?: string;
  clientVersion?: string;
};
