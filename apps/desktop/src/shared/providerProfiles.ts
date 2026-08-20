export type ProviderProfileId = string;

export const DEFAULT_PROVIDER_PROFILE_ID: ProviderProfileId = "default";
const PROVIDER_PROFILE_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export type ProviderProfileRecord = {
  id: ProviderProfileId;
  name: string;
  type: "anthropic" | "openai-compatible";
  modelId: string;
  configured: boolean;
};

export function normalizeProviderProfileId(value: unknown): ProviderProfileId {
  return isProviderProfileId(value) ? value : DEFAULT_PROVIDER_PROFILE_ID;
}

export function normalizePersistedProviderProfileId(value: unknown): ProviderProfileId | null {
  return isProviderProfileId(value) ? value : null;
}

export function isProviderProfileId(value: unknown): value is ProviderProfileId {
  return typeof value === "string" && PROVIDER_PROFILE_ID_PATTERN.test(value);
}
