import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import {
  APP_STATE_SNAPSHOT_VERSION,
  getProjectWorkingDirectoryIdentity,
  normalizeAppStateSnapshot,
  normalizeProjectWorkingDirectory,
  type AppProjectRecord,
  type AppStateSnapshot,
  type WorkspaceProjectAssociationRecord,
  type WorkspaceRecord,
} from "../../shared/workspacePersistence";
import { DEFAULT_RUNTIME_MODE, type RuntimeMode } from "../../shared/runtimeMode";
import { DEFAULT_RUNTIME_ID, type RuntimeId } from "../../shared/runtimes";

type WorkspaceMutationResult =
  | { ok: true; workspace: WorkspaceRecord }
  | { ok: false; error: string };

type ProjectMutationResult =
  | {
      ok: true;
      project: AppProjectRecord;
      association: WorkspaceProjectAssociationRecord;
      createdAssociation: boolean;
    }
  | { ok: false; error: string };

type AppStateContextValue = {
  hasHydrated: boolean;
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  activeWorkspaceId: string | null;
  createWorkspace: (name: string) => Promise<WorkspaceMutationResult>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<WorkspaceMutationResult>;
  selectWorkspace: (workspaceId: string) => Promise<boolean>;
  addProject: (workspaceId: string, workingDirectory: string) => Promise<ProjectMutationResult>;
  setProjectAlias: (workspaceId: string, projectId: string, alias: string) => Promise<boolean>;
  renameSharedProject: (projectId: string, name: string) => Promise<boolean>;
  setAssociationDefaults: (
    workspaceId: string,
    projectId: string,
    defaults: {
      runtimeId: RuntimeId;
      runtimeModelId?: string;
      runtimeMode: RuntimeMode;
    },
  ) => Promise<boolean>;
  moveAssociation: (
    workspaceId: string,
    projectId: string,
    direction: "up" | "down",
  ) => Promise<boolean>;
};

const EMPTY_APP_STATE: AppStateSnapshot = {
  version: APP_STATE_SNAPSHOT_VERSION,
  workspaces: [],
  projects: [],
  associations: [],
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

function projectNameFromWorkingDirectory(workingDirectory: string) {
  const normalized = normalizeProjectWorkingDirectory(workingDirectory);
  return normalized.split("/").at(-1) || normalized;
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
          ...snapshot,
          workspaces: [...snapshot.workspaces, workspace],
          activeWorkspaceId: workspace.id,
        });
        return { ok: true, workspace };
      } catch {
        return { ok: false, error: "Workspace could not be saved." };
      }
    },
    [persist, snapshot],
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

  const addProject = useCallback(
    async (workspaceId: string, value: string): Promise<ProjectMutationResult> => {
      if (!snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) {
        return { ok: false, error: "Workspace not found." };
      }

      const workingDirectory = normalizeProjectWorkingDirectory(value);
      if (!workingDirectory) return { ok: false, error: "Project directory is required." };

      const workingDirectoryIdentity = getProjectWorkingDirectoryIdentity(workingDirectory);
      const existingProject = snapshot.projects.find(
        (project) =>
          getProjectWorkingDirectoryIdentity(project.workingDirectory) === workingDirectoryIdentity,
      );
      const project: AppProjectRecord = existingProject ?? {
        id: `project-${crypto.randomUUID()}`,
        name: projectNameFromWorkingDirectory(workingDirectory),
        workingDirectory,
      };
      const existingAssociation = snapshot.associations.find(
        (association) =>
          association.workspaceId === workspaceId && association.projectId === project.id,
      );
      if (existingAssociation) {
        return {
          ok: true,
          project,
          association: existingAssociation,
          createdAssociation: false,
        };
      }

      const association: WorkspaceProjectAssociationRecord = {
        workspaceId,
        projectId: project.id,
        order: snapshot.associations.filter((item) => item.workspaceId === workspaceId).length,
        defaultRuntimeId: DEFAULT_RUNTIME_ID,
        defaultRuntimeMode: DEFAULT_RUNTIME_MODE,
      };

      try {
        await persist({
          ...snapshot,
          projects: existingProject ? snapshot.projects : [...snapshot.projects, project],
          associations: [...snapshot.associations, association],
        });
        return { ok: true, project, association, createdAssociation: true };
      } catch {
        return { ok: false, error: "Project could not be saved." };
      }
    },
    [persist, snapshot],
  );

  const setProjectAlias = useCallback(
    async (workspaceId: string, projectId: string, value: string) => {
      const alias = value.trim();
      const association = snapshot.associations.find(
        (item) => item.workspaceId === workspaceId && item.projectId === projectId,
      );
      if (!association) return false;

      try {
        await persist({
          ...snapshot,
          associations: snapshot.associations.map((item) => {
            if (item !== association) return item;
            const { alias: _alias, ...withoutAlias } = item;
            return alias ? { ...withoutAlias, alias } : withoutAlias;
          }),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist, snapshot],
  );

  const renameSharedProject = useCallback(
    async (projectId: string, value: string) => {
      const name = value.trim();
      if (!name || !snapshot.projects.some((project) => project.id === projectId)) return false;
      try {
        await persist({
          ...snapshot,
          projects: snapshot.projects.map((project) =>
            project.id === projectId ? { ...project, name } : project,
          ),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist, snapshot],
  );

  const setAssociationDefaults = useCallback(
    async (
      workspaceId: string,
      projectId: string,
      defaults: {
        runtimeId: RuntimeId;
        runtimeModelId?: string;
        runtimeMode: RuntimeMode;
      },
    ) => {
      const association = snapshot.associations.find(
        (item) => item.workspaceId === workspaceId && item.projectId === projectId,
      );
      if (!association) return false;
      const runtimeModelId = defaults.runtimeModelId?.trim() || undefined;

      try {
        await persist({
          ...snapshot,
          associations: snapshot.associations.map((item) => {
            if (item !== association) return item;
            const { defaultRuntimeModelId: _model, ...withoutModel } = item;
            return {
              ...withoutModel,
              defaultRuntimeId: defaults.runtimeId,
              ...(runtimeModelId ? { defaultRuntimeModelId: runtimeModelId } : {}),
              defaultRuntimeMode: defaults.runtimeMode,
            };
          }),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist, snapshot],
  );

  const moveAssociation = useCallback(
    async (workspaceId: string, projectId: string, direction: "up" | "down") => {
      const workspaceAssociations = snapshot.associations
        .filter((association) => association.workspaceId === workspaceId)
        .sort((left, right) => left.order - right.order);
      const currentIndex = workspaceAssociations.findIndex(
        (association) => association.projectId === projectId,
      );
      const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
      const current = workspaceAssociations[currentIndex];
      const target = workspaceAssociations[targetIndex];
      if (!current || !target) return false;

      try {
        await persist({
          ...snapshot,
          associations: snapshot.associations.map((association) => {
            if (association === current) return { ...association, order: target.order };
            if (association === target) return { ...association, order: current.order };
            return association;
          }),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist, snapshot],
  );

  return (
    <AppStateContext.Provider
      value={{
        hasHydrated,
        workspaces: snapshot.workspaces,
        projects: snapshot.projects,
        associations: snapshot.associations,
        activeWorkspaceId: snapshot.activeWorkspaceId,
        createWorkspace,
        renameWorkspace,
        selectWorkspace,
        addProject,
        setProjectAlias,
        renameSharedProject,
        setAssociationDefaults,
        moveAssociation,
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
