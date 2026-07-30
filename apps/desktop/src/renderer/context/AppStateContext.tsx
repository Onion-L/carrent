import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  createEmptyAppStateSnapshot,
  getProjectWorkingDirectoryIdentity,
  normalizeAppStateSnapshot,
  normalizeProjectWorkingDirectory,
  type AppProjectRecord,
  type AppStateDiagnostic,
  type AppStateLoadResult,
  type AppStateSnapshot,
  type AppThreadMessageRecord,
  type AppThreadActionRecord,
  type AppThreadPromotionIntentRecord,
  type AppThreadRecord,
  type AppThreadRunStartInput,
  type AppThreadRunRecord,
  type AssociationThreadDraftRecord,
  type ThreadWorkDraftSnapshot,
  type ThreadWorkSnapshot,
  type WorkspaceProjectAssociationRecord,
  type WorkspaceRecord,
} from "../../shared/workspacePersistence";
import { DEFAULT_RUNTIME_MODE, type RuntimeMode } from "../../shared/runtimeMode";
import { DEFAULT_RUNTIME_ID, type RuntimeId } from "../../shared/runtimes";
import { getQueuedMessages } from "../hooks/chatMessageQueue";
import { hasLiveRunForThread } from "../hooks/useChatRun";
import { hasActiveThreadActionForThread } from "../hooks/useThreadActions";
import {
  applyThreadDeletionToAppState,
  type ThreadDeletionAppStateSnapshots,
  type ThreadDeletionScope,
} from "../../shared/chat";

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

type ProjectRelocationMutationResult = { ok: true } | { ok: false; error: string };

export type ProjectDirectoryStatus = "checking" | "available" | "unavailable";

type ArchiveNavigationIntent = {
  threadId: string;
  sourcePath: string;
  destinationPath: string;
};

type DeletionNavigationIntent = {
  sourcePath: string;
};

type PromoteDraftInput = AppThreadRunStartInput & {
  draftId: string;
  title: string;
  draft: ThreadWorkDraftSnapshot;
};

type CascadeDeletionScope = Exclude<ThreadDeletionScope, { kind: "threads" }>;
type CascadeCleanup = (
  threadIds: string[],
  snapshots: ThreadDeletionAppStateSnapshots,
) => Promise<void>;

function createRecoveryResult(
  stage: AppStateDiagnostic["stage"],
  summary: string,
  diagnostics: AppStateDiagnostic[] = [],
): AppStateLoadResult {
  return {
    status: "recovery-required",
    diagnostics: [
      ...diagnostics,
      {
        appVersion: "unknown",
        subsystem: "app-state",
        stage,
        summary,
        dataPath: "unknown",
        occurredAt: new Date().toISOString(),
      },
    ],
  };
}

type AppStateContextValue = {
  hasHydrated: boolean;
  recoveryDiagnostics: AppStateDiagnostic[] | null;
  recoveryNotice: "legacy-reset" | "full-reset" | null;
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  threads: AppThreadRecord[];
  threadDrafts: AssociationThreadDraftRecord[];
  threadMessages: AppThreadMessageRecord[];
  threadRuns: AppThreadRunRecord[];
  threadActions: AppThreadActionRecord[];
  threadPromotionIntents: AppThreadPromotionIntentRecord[];
  threadWork: Record<string, ThreadWorkSnapshot>;
  lastThreadIdByWorkspace: Record<string, string>;
  activeWorkspaceId: string | null;
  projectDirectoryStatusById: Record<string, ProjectDirectoryStatus>;
  archiveNavigation: ArchiveNavigationIntent | null;
  setArchiveNavigation: (navigation: ArchiveNavigationIntent | null) => void;
  deletionNavigation: DeletionNavigationIntent | null;
  setDeletionNavigation: (navigation: DeletionNavigationIntent | null) => void;
  rereadAppState: () => Promise<boolean>;
  fullResetAppState: () => Promise<boolean>;
  clearRecoveryNotice: () => void;
  createWorkspace: (
    name: string,
    projectDirectories?: string[],
  ) => Promise<WorkspaceMutationResult>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<WorkspaceMutationResult>;
  selectWorkspace: (workspaceId: string) => Promise<boolean>;
  rememberThreadLocation: (workspaceId: string, threadId: string) => Promise<boolean>;
  addProject: (workspaceId: string, workingDirectory: string) => Promise<ProjectMutationResult>;
  recheckProjectDirectory: (projectId: string) => Promise<boolean>;
  relocateProject: (
    projectId: string,
    targetDirectory: string,
  ) => Promise<ProjectRelocationMutationResult>;
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
  openThreadDraft: (
    workspaceId: string,
    projectId: string,
  ) => Promise<AssociationThreadDraftRecord | null>;
  updateThreadDraft: (draftId: string, draft: ThreadWorkDraftSnapshot | null) => Promise<boolean>;
  updateThreadDraftConfig: (
    draftId: string,
    config: {
      runtimeId: RuntimeId;
      runtimeModelId?: string;
      runtimeMode: RuntimeMode;
      planMode: boolean;
    },
  ) => Promise<boolean>;
  discardThreadDraft: (draftId: string) => Promise<boolean>;
  prepareThreadDraftPromotion: (input: PromoteDraftInput) => Promise<AppThreadRecord | null>;
  rollbackThreadDraftPromotion: (draft: AssociationThreadDraftRecord) => Promise<boolean>;
  updateThreadConfig: (
    threadId: string,
    config: Partial<
      Pick<AppThreadRecord, "runtimeId" | "runtimeModelId" | "runtimeMode" | "planMode">
    >,
  ) => Promise<boolean>;
  updateThreadContent: (
    update: (content: {
      threads: AppThreadRecord[];
      threadMessages: AppThreadMessageRecord[];
      threadWork: Record<string, ThreadWorkSnapshot>;
    }) => {
      threads: AppThreadRecord[];
      threadMessages: AppThreadMessageRecord[];
      threadWork: Record<string, ThreadWorkSnapshot>;
    },
  ) => void;
  recordThreadRun: (input: AppThreadRunStartInput & { threadId: string }) => Promise<boolean>;
  rollbackThreadRun: (threadId: string, runId: string, messageId: string) => Promise<boolean>;
  recordThreadAction: (action: AppThreadActionRecord) => Promise<boolean>;
  archiveThread: (threadId: string) => Promise<boolean>;
  restoreThread: (threadId: string) => Promise<boolean>;
  permanentlyDeleteThread: (
    threadId: string,
    cleanup: (snapshots: ThreadDeletionAppStateSnapshots) => Promise<void>,
  ) => Promise<boolean>;
  removeAssociation: (
    workspaceId: string,
    projectId: string,
    cleanup: CascadeCleanup,
  ) => Promise<boolean>;
  deleteWorkspace: (workspaceId: string, cleanup: CascadeCleanup) => Promise<boolean>;
};

const EMPTY_APP_STATE = createEmptyAppStateSnapshot();

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

function valuesEqual(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyRecordChanges<T extends object>(base: T, intended: T, latest: T): T {
  const merged = { ...latest } as T;
  const baseRecord = base as Record<string, unknown>;
  const intendedRecord = intended as Record<string, unknown>;
  const mergedRecord = merged as Record<string, unknown>;

  for (const key of new Set([...Object.keys(baseRecord), ...Object.keys(intendedRecord)])) {
    if (valuesEqual(baseRecord[key], intendedRecord[key])) continue;
    if (Object.hasOwn(intendedRecord, key)) {
      mergedRecord[key] = intendedRecord[key];
    } else {
      delete mergedRecord[key];
    }
  }
  return merged;
}

function mergeRecordList<T extends { id: string }>(base: T[], intended: T[], latest: T[]): T[] {
  const baseById = new Map(base.map((record) => [record.id, record]));
  const intendedById = new Map(intended.map((record) => [record.id, record]));
  const mergedById = new Map(latest.map((record) => [record.id, record]));

  for (const [id, baseRecord] of baseById) {
    const intendedRecord = intendedById.get(id);
    if (!intendedRecord) {
      mergedById.delete(id);
      continue;
    }
    const latestRecord = mergedById.get(id);
    mergedById.set(
      id,
      latestRecord ? applyRecordChanges(baseRecord, intendedRecord, latestRecord) : intendedRecord,
    );
  }
  for (const [id, intendedRecord] of intendedById) {
    if (!baseById.has(id)) mergedById.set(id, intendedRecord);
  }

  return [...mergedById.values()];
}

function mergeThreadWork(
  base: Record<string, ThreadWorkSnapshot>,
  intended: Record<string, ThreadWorkSnapshot>,
  latest: Record<string, ThreadWorkSnapshot>,
) {
  const merged = { ...latest };
  for (const [threadId, baseWork] of Object.entries(base)) {
    const intendedWork = intended[threadId];
    if (!intendedWork) {
      delete merged[threadId];
      continue;
    }
    merged[threadId] = latest[threadId]
      ? applyRecordChanges(baseWork, intendedWork, latest[threadId])
      : intendedWork;
  }
  for (const [threadId, intendedWork] of Object.entries(intended)) {
    if (!base[threadId]) merged[threadId] = intendedWork;
  }
  return merged;
}

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppStateSnapshot>(EMPTY_APP_STATE);
  const snapshotRef = useRef<AppStateSnapshot>(EMPTY_APP_STATE);
  const saveAppStateRef = useRef(window.carrent.appState.save);
  const mountedRef = useRef(true);
  const mutatingThreadIdsRef = useRef(new Set<string>());
  const startingRunThreadIdsRef = useRef(new Set<string>());
  const [hasHydrated, setHasHydrated] = useState(false);
  const [recoveryDiagnostics, setRecoveryDiagnostics] = useState<AppStateDiagnostic[] | null>(null);
  const [recoveryNotice, setRecoveryNotice] = useState<"legacy-reset" | "full-reset" | null>(null);
  const [projectDirectoryStatusById, setProjectDirectoryStatusById] = useState<
    Record<string, ProjectDirectoryStatus>
  >({});
  const [archiveNavigation, setArchiveNavigation] = useState<ArchiveNavigationIntent | null>(null);
  const [deletionNavigation, setDeletionNavigation] = useState<DeletionNavigationIntent | null>(
    null,
  );
  const threadContentSaveTimerRef = useRef<number | null>(null);

  const applyLoadResult = useCallback((result: AppStateLoadResult) => {
    if (result.status === "recovery-required") {
      snapshotRef.current = EMPTY_APP_STATE;
      setSnapshot(EMPTY_APP_STATE);
      setRecoveryDiagnostics(result.diagnostics);
      return false;
    }
    const normalized = normalizeAppStateSnapshot(result.snapshot);
    if (!normalized) {
      setRecoveryDiagnostics([
        {
          appVersion: "unknown",
          subsystem: "app-state",
          stage: "validate",
          summary: "The App State response failed Renderer validation.",
          dataPath: "unknown",
          occurredAt: new Date().toISOString(),
        },
      ]);
      return false;
    }
    snapshotRef.current = normalized;
    setSnapshot(normalized);
    setRecoveryDiagnostics(null);
    setRecoveryNotice(result.notice ?? null);
    return true;
  }, []);

  useEffect(() => {
    let cancelled = false;

    window.carrent.appState
      .load()
      .then((result) => {
        if (!cancelled) applyLoadResult(result);
      })
      .catch((error) => {
        console.error("[app-state] failed to load", error);
        if (!cancelled) {
          applyLoadResult(
            createRecoveryResult(
              "read",
              error instanceof Error ? error.message : "App State could not be read.",
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setHasHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [applyLoadResult]);

  const rereadAppState = useCallback(async () => {
    try {
      return applyLoadResult(await window.carrent.appState.reread());
    } catch (error) {
      return applyLoadResult(
        createRecoveryResult(
          "read",
          error instanceof Error ? error.message : "App State could not be re-read.",
          recoveryDiagnostics ?? [],
        ),
      );
    }
  }, [applyLoadResult, recoveryDiagnostics]);

  const fullResetAppState = useCallback(async () => {
    try {
      return applyLoadResult(await window.carrent.appState.fullReset());
    } catch (error) {
      return applyLoadResult(
        createRecoveryResult(
          "reset-write",
          error instanceof Error ? error.message : "App State reset failed.",
          recoveryDiagnostics ?? [],
        ),
      );
    }
  }, [applyLoadResult, recoveryDiagnostics]);

  useEffect(() => {
    let cancelled = false;
    const projectIds = new Set(snapshot.projects.map((project) => project.id));
    setProjectDirectoryStatusById((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([projectId]) => projectIds.has(projectId)),
      ) as Record<string, ProjectDirectoryStatus>;
      snapshot.projects.forEach((project) => {
        next[project.id] ??= "checking";
      });
      return next;
    });

    void Promise.all(
      snapshot.projects.map(async (project) => {
        try {
          const result = await window.carrent.projectDirectories.check(project.workingDirectory);
          if (!cancelled) {
            setProjectDirectoryStatusById((current) => ({
              ...current,
              [project.id]: result.available ? "available" : "unavailable",
            }));
          }
        } catch {
          if (!cancelled) {
            setProjectDirectoryStatusById((current) => ({
              ...current,
              [project.id]: "unavailable",
            }));
          }
        }
      }),
    );

    return () => {
      cancelled = true;
    };
  }, [snapshot.projects]);

  const persist = useCallback(async (nextSnapshot: AppStateSnapshot) => {
    const contentAtStart = snapshotRef.current;
    const normalized = normalizeAppStateSnapshot(nextSnapshot);
    if (!normalized) throw new Error("Invalid App State snapshot.");
    await saveAppStateRef.current(normalized);
    if (!mountedRef.current) return;
    const latest = snapshotRef.current;
    const committed =
      latest === contentAtStart
        ? normalized
        : {
            ...normalized,
            threads: mergeRecordList(
              contentAtStart.threads ?? [],
              normalized.threads ?? [],
              latest.threads ?? [],
            ),
            threadMessages: mergeRecordList(
              contentAtStart.threadMessages ?? [],
              normalized.threadMessages ?? [],
              latest.threadMessages ?? [],
            ),
            threadActions: mergeRecordList(
              contentAtStart.threadActions ?? [],
              normalized.threadActions ?? [],
              latest.threadActions ?? [],
            ),
            threadWork: mergeThreadWork(
              contentAtStart.threadWork ?? {},
              normalized.threadWork ?? {},
              latest.threadWork ?? {},
            ),
          };
    snapshotRef.current = committed;
    setSnapshot(committed);
  }, []);

  const updateThreadContent = useCallback(
    (
      update: (content: {
        threads: AppThreadRecord[];
        threadMessages: AppThreadMessageRecord[];
        threadWork: Record<string, ThreadWorkSnapshot>;
      }) => {
        threads: AppThreadRecord[];
        threadMessages: AppThreadMessageRecord[];
        threadWork: Record<string, ThreadWorkSnapshot>;
      },
    ) => {
      if (!mountedRef.current) return;
      const current = snapshotRef.current;
      const content = update({
        threads: current.threads ?? [],
        threadMessages: current.threadMessages ?? [],
        threadWork: current.threadWork ?? {},
      });
      const next = { ...current, ...content };
      snapshotRef.current = next;
      setSnapshot(next);
      window.carrent.appState.stage(next);

      if (threadContentSaveTimerRef.current !== null) {
        window.clearTimeout(threadContentSaveTimerRef.current);
      }
      threadContentSaveTimerRef.current = window.setTimeout(() => {
        threadContentSaveTimerRef.current = null;
        void persist(snapshotRef.current).catch((error) => {
          console.error("[app-state] failed to save Thread content", error);
        });
      }, 250);
    },
    [persist],
  );

  useEffect(() => {
    mountedRef.current = true;
    const flushPendingThreadContent = () => {
      if (threadContentSaveTimerRef.current !== null) {
        window.clearTimeout(threadContentSaveTimerRef.current);
        threadContentSaveTimerRef.current = null;
        const normalized = normalizeAppStateSnapshot(snapshotRef.current);
        if (normalized) {
          void saveAppStateRef.current(normalized).catch(() => {
            // Best-effort flush while the Main Window is closing.
          });
        }
      }
    };

    window.addEventListener("beforeunload", flushPendingThreadContent);
    return () => {
      window.removeEventListener("beforeunload", flushPendingThreadContent);
      flushPendingThreadContent();
      mountedRef.current = false;
    };
  }, []);

  const createWorkspace = useCallback(
    async (value: string, projectDirectories: string[] = []): Promise<WorkspaceMutationResult> => {
      const validation = validateWorkspaceName(snapshot.workspaces, value);
      if (validation.error) return { ok: false, error: validation.error };

      const workspace: WorkspaceRecord = {
        id: `workspace-${crypto.randomUUID()}`,
        name: validation.name,
        order: snapshot.workspaces.length,
      };
      const projects = [...snapshot.projects];
      const associations = [...snapshot.associations];
      const seenDirectoryIdentities = new Set<string>();

      projectDirectories.forEach((value) => {
        const workingDirectory = normalizeProjectWorkingDirectory(value);
        if (!workingDirectory) return;
        const workingDirectoryIdentity = getProjectWorkingDirectoryIdentity(workingDirectory);
        if (seenDirectoryIdentities.has(workingDirectoryIdentity)) return;
        seenDirectoryIdentities.add(workingDirectoryIdentity);

        const existingProject = projects.find(
          (project) =>
            getProjectWorkingDirectoryIdentity(project.workingDirectory) ===
            workingDirectoryIdentity,
        );
        const project: AppProjectRecord = existingProject ?? {
          id: `project-${crypto.randomUUID()}`,
          name: projectNameFromWorkingDirectory(workingDirectory),
          workingDirectory,
        };
        if (!existingProject) projects.push(project);
        associations.push({
          workspaceId: workspace.id,
          projectId: project.id,
          order: seenDirectoryIdentities.size - 1,
          defaultRuntimeId: DEFAULT_RUNTIME_ID,
          defaultRuntimeMode: DEFAULT_RUNTIME_MODE,
        });
      });

      try {
        await persist({
          ...snapshot,
          workspaces: [...snapshot.workspaces, workspace],
          projects,
          associations,
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

  const rememberThreadLocation = useCallback(
    async (workspaceId: string, threadId: string) => {
      const thread = (snapshot.threads ?? []).find(
        (item) => item.id === threadId && item.workspaceId === workspaceId && !item.archived,
      );
      if (!thread) return false;
      if (
        snapshot.activeWorkspaceId === workspaceId &&
        snapshot.lastThreadIdByWorkspace?.[workspaceId] === threadId
      ) {
        return false;
      }

      await persist({
        ...snapshot,
        activeWorkspaceId: workspaceId,
        lastThreadIdByWorkspace: {
          ...snapshot.lastThreadIdByWorkspace,
          [workspaceId]: threadId,
        },
      });
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
      if (!workingDirectory) {
        return { ok: false, error: "Project Working Directory is required." };
      }

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

  const recheckProjectDirectory = useCallback(async (projectId: string) => {
    const project = snapshotRef.current.projects.find((item) => item.id === projectId);
    if (!project) return false;
    setProjectDirectoryStatusById((current) => ({ ...current, [projectId]: "checking" }));
    try {
      const result = await window.carrent.projectDirectories.check(project.workingDirectory);
      setProjectDirectoryStatusById((current) => ({
        ...current,
        [projectId]: result.available ? "available" : "unavailable",
      }));
      return result.available;
    } catch {
      setProjectDirectoryStatusById((current) => ({
        ...current,
        [projectId]: "unavailable",
      }));
      return false;
    }
  }, []);

  const relocateProject = useCallback(
    async (
      projectId: string,
      targetDirectory: string,
    ): Promise<ProjectRelocationMutationResult> => {
      try {
        const result = await window.carrent.projectDirectories.relocate({
          projectId,
          targetDirectory,
        });
        const normalized = normalizeAppStateSnapshot(result.appState);
        if (!normalized) throw new Error("Project relocation returned invalid App State.");
        snapshotRef.current = normalized;
        setSnapshot(normalized);
        setProjectDirectoryStatusById((current) => ({
          ...current,
          [projectId]: "available",
        }));
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Project could not be relocated.",
        };
      }
    },
    [],
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

  const openThreadDraft = useCallback(
    async (workspaceId: string, projectId: string) => {
      const existing = (snapshot.threadDrafts ?? []).find(
        (draft) => draft.workspaceId === workspaceId && draft.projectId === projectId,
      );
      if (existing) return existing;

      const association = snapshot.associations.find(
        (item) => item.workspaceId === workspaceId && item.projectId === projectId,
      );
      if (!association) return null;

      const draft: AssociationThreadDraftRecord = {
        id: `draft-${crypto.randomUUID()}`,
        threadId: `thread-${crypto.randomUUID()}`,
        workspaceId,
        projectId,
        content: "",
        attachedSkillNames: [],
        attachments: [],
        runtimeId: association.defaultRuntimeId,
        ...(association.defaultRuntimeModelId
          ? { runtimeModelId: association.defaultRuntimeModelId }
          : {}),
        runtimeMode: association.defaultRuntimeMode,
        planMode: false,
      };

      try {
        await persist({
          ...snapshot,
          threads: snapshot.threads ?? [],
          threadDrafts: [...(snapshot.threadDrafts ?? []), draft],
          threadMessages: snapshot.threadMessages ?? [],
          threadRuns: snapshot.threadRuns ?? [],
          threadPromotionIntents: snapshot.threadPromotionIntents ?? [],
        });
        return draft;
      } catch {
        return null;
      }
    },
    [persist, snapshot],
  );

  const updateThreadDraft = useCallback(
    async (draftId: string, draft: ThreadWorkDraftSnapshot | null) => {
      const current = snapshotRef.current;
      const existing = (current.threadDrafts ?? []).find((item) => item.id === draftId);
      if (!existing) return false;
      try {
        await persist({
          ...current,
          threadDrafts: (current.threadDrafts ?? []).map((item) =>
            item.id === draftId
              ? {
                  ...item,
                  content: draft?.content ?? "",
                  composerState: draft?.composerState,
                  attachedSkillNames: draft?.attachedSkillNames ?? [],
                  attachments: draft?.attachments ?? [],
                }
              : item,
          ),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist],
  );

  const updateThreadDraftConfig = useCallback(
    async (
      draftId: string,
      config: {
        runtimeId: RuntimeId;
        runtimeModelId?: string;
        runtimeMode: RuntimeMode;
        planMode: boolean;
      },
    ) => {
      const current = snapshotRef.current;
      if (!(current.threadDrafts ?? []).some((item) => item.id === draftId)) return false;
      const runtimeModelId = config.runtimeModelId?.trim() || undefined;
      try {
        await persist({
          ...current,
          threadDrafts: (current.threadDrafts ?? []).map((item) => {
            if (item.id !== draftId) return item;
            const { runtimeModelId: _runtimeModelId, ...withoutModel } = item;
            return {
              ...withoutModel,
              runtimeId: config.runtimeId,
              ...(runtimeModelId ? { runtimeModelId } : {}),
              runtimeMode: config.runtimeMode,
              planMode: config.planMode,
            };
          }),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist],
  );

  const discardThreadDraft = useCallback(
    async (draftId: string) => {
      const current = snapshotRef.current;
      if (!(current.threadDrafts ?? []).some((item) => item.id === draftId)) return false;
      try {
        await persist({
          ...current,
          threadDrafts: (current.threadDrafts ?? []).filter((item) => item.id !== draftId),
          threadPromotionIntents: (current.threadPromotionIntents ?? []).filter(
            (intent) => intent.draftId !== draftId,
          ),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist],
  );

  const prepareThreadDraftPromotion = useCallback(
    async (input: PromoteDraftInput) => {
      const current = snapshotRef.current;
      const draft = (current.threadDrafts ?? []).find((item) => item.id === input.draftId);
      if (!draft) return null;
      const associationExists = current.associations.some(
        (item) => item.workspaceId === draft.workspaceId && item.projectId === draft.projectId,
      );
      if (
        !associationExists ||
        (current.threads ?? []).some((item) => item.id === draft.threadId)
      ) {
        return null;
      }

      const thread: AppThreadRecord = {
        id: draft.threadId,
        workspaceId: draft.workspaceId,
        projectId: draft.projectId,
        title: input.title,
        createdAt: input.startedAt,
        lastActivityAt: input.startedAt,
        runtimeId: input.runtimeId,
        ...(input.runtimeModelId ? { runtimeModelId: input.runtimeModelId } : {}),
        runtimeMode: input.runtimeMode,
        planMode: input.planMode,
      };
      const message: AppThreadMessageRecord = {
        id: input.messageId,
        threadId: draft.threadId,
        role: "user",
        content: input.message,
        createdAt: input.messageCreatedAt ?? input.startedAt,
        attachments: input.attachments,
      };
      const run: AppThreadRunRecord = {
        id: input.runId,
        threadId: draft.threadId,
        messageId: input.messageId,
        startedAt: input.startedAt,
        runtimeId: input.runtimeId,
        ...(input.runtimeModelId ? { runtimeModelId: input.runtimeModelId } : {}),
        runtimeMode: input.runtimeMode,
        planMode: input.planMode,
      };

      try {
        await persist({
          ...current,
          threads: [...(current.threads ?? []), thread],
          threadDrafts: (current.threadDrafts ?? []).filter((item) => item.id !== draft.id),
          threadMessages: [...(current.threadMessages ?? []), message],
          threadRuns: [...(current.threadRuns ?? []), run],
          threadPromotionIntents: (current.threadPromotionIntents ?? []).filter(
            (intent) => intent.draftId !== draft.id,
          ),
        });
        return thread;
      } catch {
        return null;
      }
    },
    [persist],
  );

  const updateThreadConfig = useCallback(
    async (
      threadId: string,
      config: Partial<
        Pick<AppThreadRecord, "runtimeId" | "runtimeModelId" | "runtimeMode" | "planMode">
      >,
    ) => {
      const current = snapshotRef.current;
      if (!(current.threads ?? []).some((item) => item.id === threadId)) return false;
      try {
        await persist({
          ...current,
          threads: (current.threads ?? []).map((thread) => {
            if (thread.id !== threadId) return thread;
            const next = { ...thread, ...config };
            if (!next.runtimeModelId) delete next.runtimeModelId;
            return next;
          }),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist],
  );

  const rollbackThreadDraftPromotion = useCallback(
    async (draft: AssociationThreadDraftRecord) => {
      const current = snapshotRef.current;
      const restored: AppStateSnapshot = {
        ...current,
        threads: (current.threads ?? []).filter((thread) => thread.id !== draft.threadId),
        threadDrafts: [
          ...(current.threadDrafts ?? []).filter((item) => item.id !== draft.id),
          draft,
        ],
        threadMessages: (current.threadMessages ?? []).filter(
          (message) => message.threadId !== draft.threadId,
        ),
        threadRuns: (current.threadRuns ?? []).filter((run) => run.threadId !== draft.threadId),
        threadWork: Object.fromEntries(
          Object.entries(current.threadWork ?? {}).filter(
            ([threadId]) => threadId !== draft.threadId,
          ),
        ),
        threadPromotionIntents: (current.threadPromotionIntents ?? []).filter(
          (intent) => intent.draftId !== draft.id,
        ),
      };
      try {
        await persist(restored);
        return true;
      } catch {
        snapshotRef.current = restored;
        setSnapshot(restored);
        window.carrent.appState.stage(restored);
        return true;
      }
    },
    [persist],
  );

  const recordThreadRun = useCallback(
    async (input: AppThreadRunStartInput & { threadId: string }) => {
      const current = snapshotRef.current;
      if (
        mutatingThreadIdsRef.current.has(input.threadId) ||
        !(current.threads ?? []).some((thread) => thread.id === input.threadId && !thread.archived)
      ) {
        return false;
      }
      startingRunThreadIdsRef.current.add(input.threadId);
      const message: AppThreadMessageRecord = {
        id: input.messageId,
        threadId: input.threadId,
        role: "user",
        content: input.message,
        // Preserve the optimistic user message's createdAt so it cannot sort
        // after the assistant placeholder created alongside it.
        createdAt: input.messageCreatedAt ?? input.startedAt,
        attachments: input.attachments,
      };
      const run: AppThreadRunRecord = {
        id: input.runId,
        threadId: input.threadId,
        messageId: input.messageId,
        startedAt: input.startedAt,
        runtimeId: input.runtimeId,
        ...(input.runtimeModelId ? { runtimeModelId: input.runtimeModelId } : {}),
        runtimeMode: input.runtimeMode,
        planMode: input.planMode,
      };
      try {
        await persist({
          ...current,
          threads: (current.threads ?? []).map((thread) =>
            thread.id === input.threadId ? { ...thread, lastActivityAt: input.startedAt } : thread,
          ),
          threadMessages: (current.threadMessages ?? []).some(
            (existing) => existing.id === message.id,
          )
            ? current.threadMessages
            : [...(current.threadMessages ?? []), message],
          threadRuns: [...(current.threadRuns ?? []), run],
        });
        return true;
      } catch {
        return false;
      } finally {
        startingRunThreadIdsRef.current.delete(input.threadId);
      }
    },
    [persist],
  );

  const rollbackThreadRun = useCallback(
    async (threadId: string, runId: string, messageId: string) => {
      try {
        await persist({
          ...snapshot,
          threadMessages: (snapshot.threadMessages ?? []).filter(
            (message) => message.id !== messageId,
          ),
          threadRuns: (snapshot.threadRuns ?? []).filter((run) => run.id !== runId),
          threads: (snapshot.threads ?? []).map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  lastActivityAt:
                    (snapshot.threadMessages ?? [])
                      .filter(
                        (message) => message.threadId === threadId && message.id !== messageId,
                      )
                      .at(-1)?.createdAt ?? thread.createdAt,
                }
              : thread,
          ),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist, snapshot],
  );

  const recordThreadAction = useCallback(
    async (action: AppThreadActionRecord) => {
      const current = snapshotRef.current;
      if (!(current.threads ?? []).some((thread) => thread.id === action.threadId)) {
        return false;
      }
      try {
        await persist({
          ...current,
          threads: (current.threads ?? []).map((thread) =>
            thread.id === action.threadId
              ? { ...thread, lastActivityAt: action.completedAt }
              : thread,
          ),
          threadActions: [...(current.threadActions ?? []), action],
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist],
  );

  const archiveThread = useCallback(
    async (threadId: string) => {
      const current = snapshotRef.current;
      const thread = (current.threads ?? []).find((item) => item.id === threadId && !item.archived);
      if (
        !thread ||
        mutatingThreadIdsRef.current.has(threadId) ||
        startingRunThreadIdsRef.current.has(threadId) ||
        hasLiveRunForThread(threadId) ||
        hasActiveThreadActionForThread(threadId) ||
        getQueuedMessages(threadId).length > 0
      ) {
        return false;
      }
      mutatingThreadIdsRef.current.add(threadId);

      const lastThreadIdByWorkspace = { ...current.lastThreadIdByWorkspace };
      if (lastThreadIdByWorkspace[thread.workspaceId] === threadId) {
        delete lastThreadIdByWorkspace[thread.workspaceId];
      }

      try {
        await persist({
          ...current,
          threads: (current.threads ?? []).map((item) =>
            item.id === threadId ? { ...item, archived: true } : item,
          ),
          lastThreadIdByWorkspace,
        });
        return true;
      } catch {
        return false;
      } finally {
        mutatingThreadIdsRef.current.delete(threadId);
      }
    },
    [persist],
  );

  const restoreThread = useCallback(
    async (threadId: string) => {
      const current = snapshotRef.current;
      const thread = (current.threads ?? []).find((item) => item.id === threadId && item.archived);
      if (!thread || mutatingThreadIdsRef.current.has(threadId)) return false;
      mutatingThreadIdsRef.current.add(threadId);

      try {
        await persist({
          ...current,
          threads: (current.threads ?? []).map((item) => {
            if (item.id !== threadId) return item;
            const { archived: _archived, ...restored } = item;
            return restored;
          }),
        });
        return true;
      } catch {
        return false;
      } finally {
        mutatingThreadIdsRef.current.delete(threadId);
      }
    },
    [persist],
  );

  const permanentlyDeleteThread = useCallback(
    async (
      threadId: string,
      cleanup: (snapshots: ThreadDeletionAppStateSnapshots) => Promise<void>,
    ) => {
      const current = snapshotRef.current;
      const thread = (current.threads ?? []).find((item) => item.id === threadId && item.archived);
      if (!thread || mutatingThreadIdsRef.current.has(threadId)) return false;
      mutatingThreadIdsRef.current.add(threadId);
      const next = applyThreadDeletionToAppState(current, [threadId]);

      try {
        await cleanup({ beforeAppState: current, afterAppState: next });
        const committed = applyThreadDeletionToAppState(snapshotRef.current, [threadId]);
        snapshotRef.current = committed;
        setSnapshot(committed);
        return true;
      } catch (error) {
        if (error instanceof AggregateError) throw error;
        return false;
      } finally {
        mutatingThreadIdsRef.current.delete(threadId);
      }
    },
    [],
  );

  const deleteCascade = useCallback(
    async (scope: CascadeDeletionScope, cleanup: CascadeCleanup) => {
      const current = snapshotRef.current;
      const targetExists =
        scope.kind === "association"
          ? current.associations.some(
              (association) =>
                association.workspaceId === scope.workspaceId &&
                association.projectId === scope.projectId,
            )
          : current.workspaces.some((workspace) => workspace.id === scope.workspaceId);
      if (!targetExists) return false;

      const affectedThreads = (current.threads ?? []).filter(
        (thread) =>
          thread.workspaceId === scope.workspaceId &&
          (scope.kind === "workspace" || thread.projectId === scope.projectId),
      );
      const affectedDrafts = (current.threadDrafts ?? []).filter(
        (draft) =>
          draft.workspaceId === scope.workspaceId &&
          (scope.kind === "workspace" || draft.projectId === scope.projectId),
      );
      const affectedThreadIds = [
        ...affectedThreads.map((thread) => thread.id),
        ...affectedDrafts.map((draft) => draft.threadId),
      ];
      if (
        affectedThreads.some(
          (thread) =>
            mutatingThreadIdsRef.current.has(thread.id) ||
            startingRunThreadIdsRef.current.has(thread.id) ||
            hasLiveRunForThread(thread.id) ||
            hasActiveThreadActionForThread(thread.id),
        )
      ) {
        return false;
      }
      affectedThreadIds.forEach((threadId) => mutatingThreadIdsRef.current.add(threadId));

      const next = applyThreadDeletionToAppState(current, affectedThreadIds, scope);

      try {
        await cleanup(affectedThreadIds, {
          beforeAppState: current,
          afterAppState: next,
          scope,
        });
        const committed = applyThreadDeletionToAppState(
          snapshotRef.current,
          affectedThreadIds,
          scope,
        );
        snapshotRef.current = committed;
        setSnapshot(committed);
        return true;
      } finally {
        affectedThreadIds.forEach((threadId) => mutatingThreadIdsRef.current.delete(threadId));
      }
    },
    [],
  );

  const removeAssociation = useCallback(
    (workspaceId: string, projectId: string, cleanup: CascadeCleanup) =>
      deleteCascade({ kind: "association", workspaceId, projectId }, cleanup),
    [deleteCascade],
  );

  const deleteWorkspace = useCallback(
    (workspaceId: string, cleanup: CascadeCleanup) =>
      deleteCascade({ kind: "workspace", workspaceId }, cleanup),
    [deleteCascade],
  );

  return (
    <AppStateContext.Provider
      value={{
        hasHydrated,
        recoveryDiagnostics,
        recoveryNotice,
        workspaces: snapshot.workspaces,
        projects: snapshot.projects,
        associations: snapshot.associations,
        threads: snapshot.threads ?? [],
        threadDrafts: snapshot.threadDrafts ?? [],
        threadMessages: snapshot.threadMessages ?? [],
        threadRuns: snapshot.threadRuns ?? [],
        threadActions: snapshot.threadActions ?? [],
        threadPromotionIntents: snapshot.threadPromotionIntents ?? [],
        threadWork: snapshot.threadWork ?? {},
        lastThreadIdByWorkspace: snapshot.lastThreadIdByWorkspace ?? {},
        activeWorkspaceId: snapshot.activeWorkspaceId,
        projectDirectoryStatusById,
        archiveNavigation,
        setArchiveNavigation,
        deletionNavigation,
        setDeletionNavigation,
        rereadAppState,
        fullResetAppState,
        clearRecoveryNotice: () => setRecoveryNotice(null),
        createWorkspace,
        renameWorkspace,
        selectWorkspace,
        rememberThreadLocation,
        addProject,
        recheckProjectDirectory,
        relocateProject,
        setProjectAlias,
        renameSharedProject,
        setAssociationDefaults,
        openThreadDraft,
        updateThreadDraft,
        updateThreadDraftConfig,
        discardThreadDraft,
        prepareThreadDraftPromotion,
        rollbackThreadDraftPromotion,
        updateThreadConfig,
        updateThreadContent,
        recordThreadRun,
        rollbackThreadRun,
        recordThreadAction,
        archiveThread,
        restoreThread,
        permanentlyDeleteThread,
        removeAssociation,
        deleteWorkspace,
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
