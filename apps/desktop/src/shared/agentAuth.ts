export type ProviderProfileType = "anthropic" | "openai-compatible" | "kimi-coding";
export type ProviderAuthType = "api_key" | "oauth";

export type ProviderProfileView = {
  id: string;
  type: ProviderProfileType;
  baseUrl: string;
  modelId: string;
  thinking?: boolean;
  hasApiKey: boolean;
  authType?: ProviderAuthType;
  oauthSupported?: boolean;
  models?: Array<{ id: string; name: string }>;
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
