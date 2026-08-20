import { useCallback, useEffect, useState } from "react";

import type { ProviderProfileRecord } from "../../shared/providerProfiles";

export function useProviderProfiles() {
  const [profiles, setProfiles] = useState<ProviderProfileRecord[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const auth = await window.carrent.agentAuth.load();
      setActiveProfileId(auth.activeProfileId);
      setProfiles(
        auth.profiles.map((profile) => ({
          id: profile.id,
          name: profile.id,
          type: profile.type,
          modelId: profile.modelId,
          configured: Boolean(profile.authType),
        })),
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);
  return { profiles, activeProfileId, loading, refresh };
}
