import { useEffect, useState } from "react";

import type { SkillRecord } from "../../shared/skills";

export function useSkills() {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadSkills() {
      try {
        const nextSkills = await window.carrent.skills.list();
        if (!cancelled) {
          setSkills(nextSkills);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setSkills([]);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadSkills();

    return () => {
      cancelled = true;
    };
  }, []);

  return { skills, loading, error };
}
