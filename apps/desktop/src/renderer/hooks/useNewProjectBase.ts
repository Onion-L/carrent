import { useCallback, useEffect, useState } from "react";

import { useAppState } from "../context/AppStateContext";

/**
 * Resolves the base directory for newly created empty Projects, mirroring the
 * Main process: a per-creation override wins over the configured New Project
 * location, which wins over the dynamic default (~/CarrentProjects, reported
 * by Main so the per-user absolute path is never persisted).
 */
export function useNewProjectBase() {
  const { settings } = useAppState();
  const [defaultBase, setDefaultBase] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.carrent.projectDirectories
      .defaultBase()
      .then((result) => {
        if (!cancelled) setDefaultBase(result.baseDirectory);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const configuredBase = settings.newProjectLocation ?? null;
  const resolveBase = useCallback(
    (override?: string | null) => override ?? configuredBase ?? defaultBase,
    [configuredBase, defaultBase],
  );

  return { defaultBase, configuredBase, resolveBase };
}
