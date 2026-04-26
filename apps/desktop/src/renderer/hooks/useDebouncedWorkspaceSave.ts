import { useEffect, useRef } from "react";
import type { WorkspaceSnapshot } from "../../shared/workspacePersistence";
import type { DraftThreadRecord } from "../lib/draftThreads";
import type { AgentRecord, Message, ProjectRecord } from "../mock/uiShellData";

export function buildWorkspaceSnapshot({
  projects,
  messages,
  activeThreadId,
  drafts,
  agents,
}: {
  projects: ProjectRecord[];
  messages: Message[];
  activeThreadId: string | null;
  drafts: DraftThreadRecord[];
  agents?: AgentRecord[];
}): WorkspaceSnapshot {
  return {
    version: 1,
    projects,
    messages,
    activeThreadId,
    drafts,
    agents,
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
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  useEffect(() => {
    if (!enabled) {
      return;
    }

    window.carrent.workspace.remember(snapshot);

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

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (enabled) {
        window.carrent.workspace.save(snapshotRef.current).catch(() => {
          // Best-effort flush on window close.
        });
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [enabled]);
}
