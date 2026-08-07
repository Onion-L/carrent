import { useCallback, useEffect, useRef, useState } from "react";

import type { SkillRecord } from "../../shared/skills";

export function useSkills(projectDir?: string) {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const nextSkills = await window.carrent.skills.list(projectDir);
      if (requestId === requestIdRef.current) {
        setSkills(nextSkills);
        setError(null);
      }
    } catch (err) {
      if (requestId === requestIdRef.current) {
        setError(err instanceof Error ? err.message : String(err));
        setSkills([]);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [projectDir]);

  useEffect(() => {
    void refresh();

    return () => {
      requestIdRef.current += 1;
    };
  }, [refresh]);

  return { skills, loading, error, refresh };
}
