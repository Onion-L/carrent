import { useEffect, useRef } from "react";
import type { WorkspaceSnapshot } from "../../shared/workspacePersistence";
import type { DraftThreadRecord } from "../lib/draftThreads";
import type { Message, ProjectRecord } from "../mock/uiShellData";

export function buildWorkspaceSnapshot({
  projects,
  messages,
  activeThreadId,
  drafts,
}: {
  projects: ProjectRecord[];
  messages: Message[];
  activeThreadId: string | null;
  drafts: DraftThreadRecord[];
}): WorkspaceSnapshot {
  return {
    version: 1,
    projects,
    messages,
    activeThreadId,
    drafts,
  };
}

export function shouldPersistWorkspaceSnapshot(
  hasHydrated: boolean,
  enabled: boolean,
): boolean {
  return hasHydrated && enabled;
}

export function useDebouncedWorkspaceSave(
  snapshot: WorkspaceSnapshot,
  enabled: boolean,
  delayMs = 500,
) {
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = setTimeout(() => {
      window.carrent.workspace
        .save(snapshot)
        .catch((error) => {
          console.error("[workspace] failed to save", error);
        });
    }, delayMs);

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [snapshot, enabled, delayMs]);
}
