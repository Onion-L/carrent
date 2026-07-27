import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
  APP_STATE_SNAPSHOT_VERSION,
  normalizeAppStateSnapshot,
  type AppStateSnapshot,
  type WorkspaceRecord,
} from "../../shared/workspacePersistence";

type WorkspaceMutationResult =
  | { ok: true; workspace: WorkspaceRecord }
  | { ok: false; error: string };

type AppStateContextValue = {
  hasHydrated: boolean;
  workspaces: WorkspaceRecord[];
  activeWorkspaceId: string | null;
  createWorkspace: (name: string) => Promise<WorkspaceMutationResult>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<WorkspaceMutationResult>;
  selectWorkspace: (workspaceId: string) => Promise<boolean>;
};

const EMPTY_APP_STATE: AppStateSnapshot = {
  version: APP_STATE_SNAPSHOT_VERSION,
  workspaces: [],
  activeWorkspaceId: null,
};

const AppStateContext = createContext<AppStateContextValue | null>(null);

function validateWorkspaceName(
  workspaces: WorkspaceRecord[],
  name: string,
  currentWorkspaceId?: string,
) {
  const trimmed = name.trim();
  if (!trimmed) return { name: "", error: "Workspace name is required." };

  const normalizedName = trimmed.toLocaleLowerCase();
  const duplicate = workspaces.some(
    (workspace) =>
      workspace.id !== currentWorkspaceId && workspace.name.toLocaleLowerCase() === normalizedName,
  );
  if (duplicate) return { name: trimmed, error: "Workspace names must be unique." };

  return { name: trimmed, error: null };
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppStateSnapshot>(EMPTY_APP_STATE);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.carrent.appState
      .load()
      .then((loaded) => {
        if (cancelled) return;
        setSnapshot(normalizeAppStateSnapshot(loaded) ?? EMPTY_APP_STATE);
      })
      .catch((error) => {
        console.error("[app-state] failed to load", error);
        if (!cancelled) setSnapshot(EMPTY_APP_STATE);
      })
      .finally(() => {
        if (!cancelled) setHasHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const persist = useCallback(async (nextSnapshot: AppStateSnapshot) => {
    const normalized = normalizeAppStateSnapshot(nextSnapshot);
    if (!normalized) throw new Error("Invalid App State snapshot.");
    await window.carrent.appState.save(normalized);
    setSnapshot(normalized);
  }, []);

  const createWorkspace = useCallback(
    async (value: string): Promise<WorkspaceMutationResult> => {
      const validation = validateWorkspaceName(snapshot.workspaces, value);
      if (validation.error) return { ok: false, error: validation.error };

      const workspace: WorkspaceRecord = {
        id: `workspace-${crypto.randomUUID()}`,
        name: validation.name,
        order: snapshot.workspaces.length,
      };

      try {
        await persist({
          version: APP_STATE_SNAPSHOT_VERSION,
          workspaces: [...snapshot.workspaces, workspace],
          activeWorkspaceId: workspace.id,
        });
        return { ok: true, workspace };
      } catch {
        return { ok: false, error: "Workspace could not be saved." };
      }
    },
    [persist, snapshot.workspaces],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, value: string): Promise<WorkspaceMutationResult> => {
      const workspace = snapshot.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) return { ok: false, error: "Workspace not found." };

      const validation = validateWorkspaceName(snapshot.workspaces, value, workspaceId);
      if (validation.error) return { ok: false, error: validation.error };

      const renamed = { ...workspace, name: validation.name };
      try {
        await persist({
          ...snapshot,
          workspaces: snapshot.workspaces.map((item) => (item.id === workspaceId ? renamed : item)),
        });
        return { ok: true, workspace: renamed };
      } catch {
        return { ok: false, error: "Workspace could not be saved." };
      }
    },
    [persist, snapshot],
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      if (workspaceId === snapshot.activeWorkspaceId) return false;
      if (!snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) return false;

      await persist({ ...snapshot, activeWorkspaceId: workspaceId });
      return true;
    },
    [persist, snapshot],
  );

  return (
    <AppStateContext.Provider
      value={{
        hasHydrated,
        workspaces: snapshot.workspaces,
        activeWorkspaceId: snapshot.activeWorkspaceId,
        createWorkspace,
        renameWorkspace,
        selectWorkspace,
      }}
    >
      {children}
    </AppStateContext.Provider>
  );
}

export function useAppState() {
  const context = useContext(AppStateContext);
  if (!context) throw new Error("useAppState must be used within AppStateProvider");
  return context;
}
