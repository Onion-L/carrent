export type ProviderProfileType = "anthropic" | "openai-compatible";

export type ProviderProfileView = {
  id: string;
  type: ProviderProfileType;
  baseUrl: string;
  modelId: string;
  thinking?: boolean;
  hasApiKey: boolean;
};

export type AgentAuthView = {
  path: string;
  activeProfileId: string;
  profiles: ProviderProfileView[];
};

export type SaveAgentAuthRequest = {
  activeProfileId: string;
  profiles: Array<Omit<ProviderProfileView, "hasApiKey"> & { apiKey?: string }>;
};
