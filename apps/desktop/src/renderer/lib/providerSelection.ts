import type { ProviderProfileId, ProviderProfileRecord } from "../../shared/providerProfiles";

export function getProviderProfileOptions(profiles: ProviderProfileRecord[]) {
  return profiles;
}

export function isProviderProfileAvailable(
  profileId: ProviderProfileId,
  profiles: ProviderProfileRecord[],
) {
  return profiles.some((profile) => profile.id === profileId && profile.configured);
}
