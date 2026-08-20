import type { AgentEvent, StreamFn } from "@earendil-works/pi-agent-core";

export type AgentMode = "ask" | "auto-edit" | "full-project";

export type ProviderProfileType = "anthropic" | "openai-compatible";

export type ProviderProfile = {
  id: string;
  type: ProviderProfileType;
  apiKey: string;
  baseUrl: string;
  modelId: string;
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
};

export type AgentApprovalDecision = "allow_once" | "allow_always" | "reject";

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
  | { type: "reasoning-delta"; delta: string }
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
  additionalReadPaths?: string[];
  systemPrompt?: string;
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
};
