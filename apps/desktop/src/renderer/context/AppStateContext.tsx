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
  APP_STATE_SNAPSHOT_VERSION,
  getProjectWorkingDirectoryIdentity,
  normalizeAppStateSnapshot,
  normalizeProjectWorkingDirectory,
  type AppProjectRecord,
  type AppStateSnapshot,
  type AppThreadMessageRecord,
  type AppThreadPromotionIntentRecord,
  type AppThreadRecord,
  type AppThreadRunStartInput,
  type AppThreadRunRecord,
  type AssociationThreadDraftRecord,
  type ThreadWorkDraftSnapshot,
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

type PromoteDraftInput = AppThreadRunStartInput & {
  draftId: string;
  title: string;
  draft: ThreadWorkDraftSnapshot;
};

type AppStateContextValue = {
  hasHydrated: boolean;
  workspaces: WorkspaceRecord[];
  projects: AppProjectRecord[];
  associations: WorkspaceProjectAssociationRecord[];
  threads: AppThreadRecord[];
  threadDrafts: AssociationThreadDraftRecord[];
  threadMessages: AppThreadMessageRecord[];
  threadRuns: AppThreadRunRecord[];
  threadPromotionIntents: AppThreadPromotionIntentRecord[];
  lastThreadIdByWorkspace: Record<string, string>;
  activeWorkspaceId: string | null;
  createWorkspace: (name: string) => Promise<WorkspaceMutationResult>;
  renameWorkspace: (workspaceId: string, name: string) => Promise<WorkspaceMutationResult>;
  selectWorkspace: (workspaceId: string) => Promise<boolean>;
  rememberThreadLocation: (workspaceId: string, threadId: string) => Promise<boolean>;
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
  prepareThreadDraftPromotion: (
    input: PromoteDraftInput,
  ) => Promise<AppThreadPromotionIntentRecord | null>;
  commitThreadDraftPromotion: (draftId: string, runId: string) => Promise<AppThreadRecord | null>;
  rollbackThreadDraftPromotion: (draft: AssociationThreadDraftRecord) => Promise<boolean>;
  updateThreadConfig: (
    threadId: string,
    config: Partial<
      Pick<AppThreadRecord, "runtimeId" | "runtimeModelId" | "runtimeMode" | "planMode">
    >,
  ) => Promise<boolean>;
  recordThreadRun: (input: AppThreadRunStartInput & { threadId: string }) => Promise<boolean>;
  rollbackThreadRun: (threadId: string, runId: string, messageId: string) => Promise<boolean>;
};

const EMPTY_APP_STATE: AppStateSnapshot = {
  version: APP_STATE_SNAPSHOT_VERSION,
  workspaces: [],
  projects: [],
  associations: [],
  threads: [],
  threadDrafts: [],
  threadMessages: [],
  threadRuns: [],
  threadPromotionIntents: [],
  lastThreadIdByWorkspace: {},
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
  const snapshotRef = useRef<AppStateSnapshot>(EMPTY_APP_STATE);
  const [hasHydrated, setHasHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;

    window.carrent.appState
      .load()
      .then((loaded) => {
        if (cancelled) return;
        const normalized = normalizeAppStateSnapshot(loaded) ?? EMPTY_APP_STATE;
        snapshotRef.current = normalized;
        setSnapshot(normalized);
      })
      .catch((error) => {
        console.error("[app-state] failed to load", error);
        if (!cancelled) {
          snapshotRef.current = EMPTY_APP_STATE;
          setSnapshot(EMPTY_APP_STATE);
        }
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
    snapshotRef.current = normalized;
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

  const rememberThreadLocation = useCallback(
    async (workspaceId: string, threadId: string) => {
      const thread = (snapshot.threads ?? []).find(
        (item) => item.id === threadId && item.workspaceId === workspaceId,
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

      const { draftId: _draftId, title, draft: preparedDraft, ...runInput } = input;
      const intent: AppThreadPromotionIntentRecord = {
        draftId: draft.id,
        threadId: draft.threadId,
        workspaceId: draft.workspaceId,
        projectId: draft.projectId,
        title,
        ...runInput,
      };

      try {
        await persist({
          ...current,
          threadDrafts: (current.threadDrafts ?? []).map((item) =>
            item.id === draft.id
              ? {
                  ...item,
                  content: preparedDraft.content,
                  attachedSkillNames: preparedDraft.attachedSkillNames,
                  attachments: preparedDraft.attachments,
                  runtimeId: input.runtimeId,
                  ...(input.runtimeModelId
                    ? { runtimeModelId: input.runtimeModelId }
                    : { runtimeModelId: undefined }),
                  runtimeMode: input.runtimeMode,
                  planMode: input.planMode,
                }
              : item,
          ),
          threadPromotionIntents: [
            ...(current.threadPromotionIntents ?? []).filter((item) => item.draftId !== draft.id),
            intent,
          ],
        });
        return intent;
      } catch {
        return null;
      }
    },
    [persist],
  );

  const commitThreadDraftPromotion = useCallback(
    async (draftId: string, runId: string) => {
      const current = snapshotRef.current;
      const intent = (current.threadPromotionIntents ?? []).find(
        (item) => item.draftId === draftId && item.runId === runId,
      );
      const draft = (current.threadDrafts ?? []).find((item) => item.id === draftId);
      if (!intent || !draft) return null;

      const thread: AppThreadRecord = {
        id: intent.threadId,
        workspaceId: intent.workspaceId,
        projectId: intent.projectId,
        title: intent.title,
        createdAt: intent.startedAt,
        lastActivityAt: intent.startedAt,
        runtimeId: intent.runtimeId,
        ...(intent.runtimeModelId ? { runtimeModelId: intent.runtimeModelId } : {}),
        runtimeMode: intent.runtimeMode,
        planMode: intent.planMode,
      };
      const message: AppThreadMessageRecord = {
        id: intent.messageId,
        threadId: intent.threadId,
        role: "user",
        content: intent.message,
        createdAt: intent.startedAt,
        attachments: intent.attachments,
      };
      const run: AppThreadRunRecord = {
        id: intent.runId,
        threadId: intent.threadId,
        messageId: intent.messageId,
        startedAt: intent.startedAt,
        runtimeId: intent.runtimeId,
        ...(intent.runtimeModelId ? { runtimeModelId: intent.runtimeModelId } : {}),
        runtimeMode: intent.runtimeMode,
        planMode: intent.planMode,
      };

      try {
        await persist({
          ...current,
          threads: [...(current.threads ?? []), thread],
          threadDrafts: (current.threadDrafts ?? []).filter((item) => item.id !== draft.id),
          threadMessages: [...(current.threadMessages ?? []), message],
          threadRuns: [...(current.threadRuns ?? []), run],
          threadPromotionIntents: (current.threadPromotionIntents ?? []).filter(
            (item) => item.draftId !== draft.id,
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
      if (!(snapshot.threads ?? []).some((item) => item.id === threadId)) return false;
      try {
        await persist({
          ...snapshot,
          threads: (snapshot.threads ?? []).map((thread) => {
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
    [persist, snapshot],
  );

  const rollbackThreadDraftPromotion = useCallback(
    async (draft: AssociationThreadDraftRecord) => {
      const current = snapshotRef.current;
      try {
        await persist({
          ...current,
          threadDrafts: [
            ...(current.threadDrafts ?? []).filter((item) => item.id !== draft.id),
            draft,
          ],
          threadPromotionIntents: (current.threadPromotionIntents ?? []).filter(
            (intent) => intent.draftId !== draft.id,
          ),
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist],
  );

  const recordThreadRun = useCallback(
    async (input: AppThreadRunStartInput & { threadId: string }) => {
      if (!(snapshot.threads ?? []).some((thread) => thread.id === input.threadId)) return false;
      const message: AppThreadMessageRecord = {
        id: input.messageId,
        threadId: input.threadId,
        role: "user",
        content: input.message,
        createdAt: input.startedAt,
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
          ...snapshot,
          threads: (snapshot.threads ?? []).map((thread) =>
            thread.id === input.threadId ? { ...thread, lastActivityAt: input.startedAt } : thread,
          ),
          threadMessages: [...(snapshot.threadMessages ?? []), message],
          threadRuns: [...(snapshot.threadRuns ?? []), run],
        });
        return true;
      } catch {
        return false;
      }
    },
    [persist, snapshot],
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

  return (
    <AppStateContext.Provider
      value={{
        hasHydrated,
        workspaces: snapshot.workspaces,
        projects: snapshot.projects,
        associations: snapshot.associations,
        threads: snapshot.threads ?? [],
        threadDrafts: snapshot.threadDrafts ?? [],
        threadMessages: snapshot.threadMessages ?? [],
        threadRuns: snapshot.threadRuns ?? [],
        threadPromotionIntents: snapshot.threadPromotionIntents ?? [],
        lastThreadIdByWorkspace: snapshot.lastThreadIdByWorkspace ?? {},
        activeWorkspaceId: snapshot.activeWorkspaceId,
        createWorkspace,
        renameWorkspace,
        selectWorkspace,
        rememberThreadLocation,
        addProject,
        setProjectAlias,
        renameSharedProject,
        setAssociationDefaults,
        moveAssociation,
        openThreadDraft,
        updateThreadDraft,
        updateThreadDraftConfig,
        discardThreadDraft,
        prepareThreadDraftPromotion,
        commitThreadDraftPromotion,
        rollbackThreadDraftPromotion,
        updateThreadConfig,
        recordThreadRun,
        rollbackThreadRun,
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
