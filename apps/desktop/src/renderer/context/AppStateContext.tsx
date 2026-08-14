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
  DEFAULT_APP_STATE_SETTINGS,
  getProjectWorkingDirectoryIdentity,
  normalizeAppStateSnapshot,
  normalizeProjectWorkingDirectory,
  type AppProjectRecord,
  type AppStateDiagnostic,
  type AppStateLoadResult,
  type AppStateSettings,
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
import type { AppStateAuthorityState } from "../../shared/appStateAuthority";
import { DEFAULT_RUNTIME_MODE, type RuntimeMode } from "../../shared/runtimeMode";
import { DEFAULT_RUNTIME_ID, type RuntimeId } from "../../shared/runtimes";
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
  assistantMessageId: string;
  draftId: string;
  // Visible composer text. The Main Process derives the promoted Thread's
  // fallback title from this source; the Renderer never supplies a finished
  // title.
  titleSource: string;
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
  settings: AppStateSettings;
  hasPersistedSettings: boolean;
  updateSettings: (settings: AppStateSettings) => Promise<boolean>;
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
  recordThreadRun: (
    input: AppThreadRunStartInput & { threadId: string; assistantMessageId: string },
  ) => Promise<boolean>;
  rollbackThreadRun: (
    threadId: string,
    runId: string,
    messageId: string,
    assistantMessageId: string,
  ) => Promise<boolean>;
  recordThreadAction: (action: AppThreadActionRecord) => Promise<boolean>;
  archiveThread: (threadId: string) => Promise<boolean>;
  restoreThread: (threadId: string) => Promise<boolean>;
  permanentlyDeleteThread: (
    threadId: string,
    cleanup: (snapshots: ThreadDeletionAppStateSnapshots) => Promise<void>,
  ) => Promise<boolean>;
  removeThreadSnapshot: (
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

// Thread record fields the Thread content commands may patch.
type ThreadContentPatch = {
  title?: string;
  // The manual-title marker. A rename sets it to true; it flows through Main
  // Process authority so the marker persists across Carrent Windows and
  // protects a renamed title from later automatic-title updates.
  customTitle?: boolean;
  lastActivityAt?: string;
  pinned?: boolean;
  runChecklist?: AppThreadRecord["runChecklist"] | null;
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<AppStateSnapshot>(EMPTY_APP_STATE);
  const snapshotRef = useRef<AppStateSnapshot>(EMPTY_APP_STATE);
  const mountedRef = useRef(true);
  // Captured once: a provider must never talk to a bridge installed after it
  // mounted (e.g. a later test's bridge receiving an unmount-time flush).
  const appStateBridgeRef = useRef(window.carrent.appState);
  const mutatingThreadIdsRef = useRef(new Set<string>());
  const startingRunThreadIdsRef = useRef(new Set<string>());
  const revisionRef = useRef(0);
  const authoritySnapshotRef = useRef<AppStateSnapshot | null>(null);
  const revisionWaitersRef = useRef<Array<{ revision: number; resolve: () => void }>>([]);
  const authoritySubscriptionRef = useRef<{ dispose: () => void } | null>(null);
  const subscribingRef = useRef<Promise<void> | null>(null);
  // Optimistic Thread content edits not yet accepted by the authority:
  // `dirty*` holds unsubmitted edits, `inflight*` holds submitted edits until
  // their revision arrives in a broadcast.
  const dirtyContentThreadsRef = useRef(new Set<string>());
  const inflightContentRef = useRef(new Map<string, number>());
  const contentSubmissionRef = useRef(new Map<string, symbol>());
  const dirtyWorkThreadsRef = useRef(new Set<string>());
  const inflightWorkRef = useRef(new Map<string, number>());
  const workSubmissionRef = useRef(new Map<string, symbol>());
  const contentPatchRef = useRef(new Map<string, ThreadContentPatch>());
  // Message ids removed intentionally (e.g. edit-resend prune). Omitted ids in a
  // full-list flush are not deletes; only these explicit ids are.
  const pendingDeleteMessageIdsRef = useRef(new Map<string, Set<string>>());
  const contentFlushTimerRef = useRef<number | null>(null);
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

  // Applies a state broadcast by the Main-process authority. The broadcast
  // replaces local state wholesale, except for Threads with optimistic
  // (unsubmitted or in-flight) local edits — those keep their local Thread
  // record, messages, and Thread work until the authority catches up.
  const applyAuthorityState = useCallback((state: AppStateAuthorityState) => {
    const normalized = normalizeAppStateSnapshot(state.snapshot);
    if (!normalized) return;
    revisionRef.current = state.revision;
    authoritySnapshotRef.current = normalized;

    const broadcastThreadIds = new Set((normalized.threads ?? []).map((thread) => thread.id));
    const protectedContent = new Set<string>();
    for (const threadId of dirtyContentThreadsRef.current) protectedContent.add(threadId);
    for (const [threadId, revision] of inflightContentRef.current) {
      if (revision <= state.revision) {
        inflightContentRef.current.delete(threadId);
      } else {
        protectedContent.add(threadId);
      }
    }
    const protectedWork = new Set<string>();
    for (const threadId of dirtyWorkThreadsRef.current) protectedWork.add(threadId);
    for (const [threadId, revision] of inflightWorkRef.current) {
      if (revision <= state.revision) {
        inflightWorkRef.current.delete(threadId);
      } else {
        protectedWork.add(threadId);
      }
    }
    // Never resurrect content for Threads the authority deleted.
    for (const threadId of protectedContent) {
      if (broadcastThreadIds.has(threadId)) continue;
      protectedContent.delete(threadId);
      dirtyContentThreadsRef.current.delete(threadId);
      inflightContentRef.current.delete(threadId);
      contentSubmissionRef.current.delete(threadId);
      contentPatchRef.current.delete(threadId);
    }
    for (const threadId of protectedWork) {
      if (broadcastThreadIds.has(threadId)) continue;
      protectedWork.delete(threadId);
      dirtyWorkThreadsRef.current.delete(threadId);
      inflightWorkRef.current.delete(threadId);
      workSubmissionRef.current.delete(threadId);
    }

    const latest = snapshotRef.current;
    const merged: AppStateSnapshot = { ...normalized };
    if (protectedContent.size > 0) {
      merged.threads = (normalized.threads ?? []).map((thread) =>
        protectedContent.has(thread.id)
          ? ((latest.threads ?? []).find((item) => item.id === thread.id) ?? thread)
          : thread,
      );
      merged.threadMessages = [
        ...(normalized.threadMessages ?? []).filter(
          (message) => !protectedContent.has(message.threadId),
        ),
        ...(latest.threadMessages ?? []).filter((message) =>
          protectedContent.has(message.threadId),
        ),
      ];
    }
    if (protectedWork.size > 0) {
      const threadWork = { ...normalized.threadWork };
      for (const threadId of protectedWork) {
        const localWork = latest.threadWork?.[threadId];
        if (localWork) {
          threadWork[threadId] = localWork;
        } else {
          delete threadWork[threadId];
        }
      }
      merged.threadWork = threadWork;
    }

    snapshotRef.current = merged;
    setSnapshot(merged);
    const waiters = revisionWaitersRef.current;
    revisionWaitersRef.current = waiters.filter((waiter) => {
      if (waiter.revision > state.revision) return true;
      waiter.resolve();
      return false;
    });
  }, []);

  const ensureAuthoritySubscription = useCallback(() => {
    if (authoritySubscriptionRef.current) return Promise.resolve();
    subscribingRef.current ??= window.carrent.appState
      .subscribe()
      .then((state) => {
        if (!mountedRef.current) {
          void window.carrent.appState.unsubscribe();
          return;
        }
        applyAuthorityState(state);
        const disposeChanged = window.carrent.appState.onChanged(applyAuthorityState);
        authoritySubscriptionRef.current = {
          dispose: () => {
            disposeChanged();
            void window.carrent.appState.unsubscribe();
          },
        };
      })
      .catch((error) => {
        console.error("[app-state] failed to subscribe", error);
      })
      .finally(() => {
        subscribingRef.current = null;
      });
    return subscribingRef.current;
  }, [applyAuthorityState]);

  // Resolves once the local snapshot has caught up with an accepted command's
  // revision. The safety timeout keeps a missed broadcast from hanging the UI.
  const waitForRevision = useCallback((revision: number) => {
    if (revisionRef.current >= revision) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const waiter = { revision, resolve };
      revisionWaitersRef.current.push(waiter);
      window.setTimeout(() => {
        const waiters = revisionWaitersRef.current;
        const index = waiters.indexOf(waiter);
        if (index < 0) return;
        waiters.splice(index, 1);
        console.warn(`[app-state] timed out waiting for revision ${revision}`);
        resolve();
      }, 5_000);
    });
  }, []);

  // Reread and full reset deliver their snapshot directly (the authority's
  // replaceState does not broadcast), so the merge base is reset here and the
  // subscription is (re-)established after a recovery.
  const applyRereadResult = useCallback(
    (result: AppStateLoadResult) => {
      const ok = applyLoadResult(result);
      if (ok) {
        authoritySnapshotRef.current = snapshotRef.current;
        void ensureAuthoritySubscription();
      }
      return ok;
    },
    [applyLoadResult, ensureAuthoritySubscription],
  );

  useEffect(() => {
    let cancelled = false;

    window.carrent.appState
      .load()
      .then((result) => {
        if (cancelled) return;
        if (applyLoadResult(result)) void ensureAuthoritySubscription();
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
      authoritySubscriptionRef.current?.dispose();
      authoritySubscriptionRef.current = null;
    };
  }, [applyLoadResult, ensureAuthoritySubscription]);

  const rereadAppState = useCallback(async () => {
    try {
      return applyRereadResult(await window.carrent.appState.reread());
    } catch (error) {
      return applyLoadResult(
        createRecoveryResult(
          "read",
          error instanceof Error ? error.message : "App State could not be re-read.",
          recoveryDiagnostics ?? [],
        ),
      );
    }
  }, [applyLoadResult, applyRereadResult, recoveryDiagnostics]);

  const fullResetAppState = useCallback(async () => {
    try {
      return applyRereadResult(await window.carrent.appState.fullReset());
    } catch (error) {
      return applyLoadResult(
        createRecoveryResult(
          "reset-write",
          error instanceof Error ? error.message : "App State reset failed.",
          recoveryDiagnostics ?? [],
        ),
      );
    }
  }, [applyLoadResult, applyRereadResult, recoveryDiagnostics]);

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

  const sendCommand = useCallback(
    (type: string, payload: unknown, baseRevision?: number) =>
      appStateBridgeRef.current.command({
        commandId: crypto.randomUUID(),
        type,
        payload,
        ...(baseRevision !== undefined ? { baseRevision } : {}),
      }),
    [],
  );

  // Submits every pending optimistic Thread content edit (messages, Thread
  // record patches, Thread work) as bounded commands right away. Other
  // commands call this first so the authority always applies them on top of
  // the locally staged state. Commands run sequentially so each carries a
  // baseRevision that still matches after the previous accept.
  const flushPendingContent = useCallback(async () => {
    if (contentFlushTimerRef.current !== null) {
      window.clearTimeout(contentFlushTimerRef.current);
      contentFlushTimerRef.current = null;
    }

    // Bounded retries: a concurrent accepted command can advance the revision
    // between our capture and submit; re-dirty and try again with the latest.
    for (let attempt = 0; attempt < 4; attempt++) {
      const contentThreadIds = [...dirtyContentThreadsRef.current];
      const workThreadIds = [...dirtyWorkThreadsRef.current];
      if (contentThreadIds.length === 0 && workThreadIds.length === 0) return;

      let retryNeeded = false;
      for (const threadId of contentThreadIds) {
        const current = snapshotRef.current;
        const thread = (current.threads ?? []).find((item) => item.id === threadId);
        if (!thread) {
          dirtyContentThreadsRef.current.delete(threadId);
          contentPatchRef.current.delete(threadId);
          pendingDeleteMessageIdsRef.current.delete(threadId);
          continue;
        }
        dirtyContentThreadsRef.current.delete(threadId);
        const submission = Symbol(threadId);
        contentSubmissionRef.current.set(threadId, submission);
        inflightContentRef.current.set(threadId, Number.POSITIVE_INFINITY);
        const patch = contentPatchRef.current.get(threadId);
        contentPatchRef.current.delete(threadId);
        const deleteMessageIds = [...(pendingDeleteMessageIdsRef.current.get(threadId) ?? [])];
        pendingDeleteMessageIdsRef.current.delete(threadId);
        const messages = (current.threadMessages ?? []).filter(
          (message) => message.threadId === threadId,
        );
        try {
          const result = await sendCommand(
            "thread-content:update",
            {
              threadId,
              ...(patch && Object.keys(patch).length > 0 ? { thread: patch } : {}),
              messages,
              ...(deleteMessageIds.length > 0 ? { deleteMessageIds } : {}),
            },
            revisionRef.current,
          );
          if (contentSubmissionRef.current.get(threadId) !== submission) continue;
          contentSubmissionRef.current.delete(threadId);
          if (result.status === "accepted") {
            inflightContentRef.current.set(threadId, result.revision);
          } else {
            if (result.reason === "stale") {
              // Re-dirty before clearing inflight so a concurrent broadcast still
              // treats local optimistic content as protected.
              dirtyContentThreadsRef.current.add(threadId);
              if (patch && Object.keys(patch).length > 0) {
                contentPatchRef.current.set(threadId, {
                  ...contentPatchRef.current.get(threadId),
                  ...patch,
                });
              }
              if (deleteMessageIds.length > 0) {
                const pending = pendingDeleteMessageIdsRef.current.get(threadId) ?? new Set();
                for (const id of deleteMessageIds) pending.add(id);
                pendingDeleteMessageIdsRef.current.set(threadId, pending);
              }
              retryNeeded = true;
            }
            inflightContentRef.current.delete(threadId);
          }
        } catch (error) {
          if (contentSubmissionRef.current.get(threadId) === submission) {
            contentSubmissionRef.current.delete(threadId);
            inflightContentRef.current.delete(threadId);
          }
          throw error;
        }
      }
      for (const threadId of workThreadIds) {
        const current = snapshotRef.current;
        dirtyWorkThreadsRef.current.delete(threadId);
        const submission = Symbol(threadId);
        workSubmissionRef.current.set(threadId, submission);
        inflightWorkRef.current.set(threadId, Number.POSITIVE_INFINITY);
        const work = current.threadWork?.[threadId] ?? null;
        try {
          const result = await sendCommand(
            "thread-work:update",
            { threadId, work },
            revisionRef.current,
          );
          if (workSubmissionRef.current.get(threadId) !== submission) continue;
          workSubmissionRef.current.delete(threadId);
          if (result.status === "accepted") {
            inflightWorkRef.current.set(threadId, result.revision);
          } else {
            if (result.reason === "stale") {
              dirtyWorkThreadsRef.current.add(threadId);
              retryNeeded = true;
            }
            inflightWorkRef.current.delete(threadId);
          }
        } catch (error) {
          if (workSubmissionRef.current.get(threadId) === submission) {
            workSubmissionRef.current.delete(threadId);
            inflightWorkRef.current.delete(threadId);
          }
          throw error;
        }
      }
      if (!retryNeeded) return;
    }
  }, [sendCommand]);

  const scheduleContentFlush = useCallback(() => {
    if (contentFlushTimerRef.current !== null) {
      window.clearTimeout(contentFlushTimerRef.current);
    }
    contentFlushTimerRef.current = window.setTimeout(() => {
      contentFlushTimerRef.current = null;
      void flushPendingContent().catch((error) => {
        console.error("[app-state] failed to submit Thread content", error);
      });
    }, 250);
  }, [flushPendingContent]);

  const submitCommand = useCallback(
    async (type: string, payload: unknown) => {
      try {
        await flushPendingContent();
      } catch (error) {
        console.error("[app-state] failed to flush Thread content before command", error);
        return false;
      }
      const result = await sendCommand(type, payload);
      if (result.status !== "accepted") return false;
      await waitForRevision(result.revision);
      return true;
    },
    [flushPendingContent, sendCommand, waitForRevision],
  );

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
      const previous = {
        threads: current.threads ?? [],
        threadMessages: current.threadMessages ?? [],
        threadWork: current.threadWork ?? {},
      };
      const content = update(previous);
      snapshotRef.current = { ...current, ...content };
      setSnapshot(snapshotRef.current);

      // Diff the optimistic change into per-Thread commands.
      const previousThreadsById = new Map(previous.threads.map((thread) => [thread.id, thread]));
      for (const nextThread of content.threads) {
        const previousThread = previousThreadsById.get(nextThread.id);
        if (!previousThread) {
          console.warn(
            `[app-state] ignoring Thread record inserted outside commands: ${nextThread.id}`,
          );
          continue;
        }
        if (previousThread === nextThread) continue;
        const patch: ThreadContentPatch = {};
        if (previousThread.title !== nextThread.title) patch.title = nextThread.title;
        if ((previousThread.customTitle === true) !== (nextThread.customTitle === true)) {
          patch.customTitle = nextThread.customTitle === true;
        }
        if (previousThread.lastActivityAt !== nextThread.lastActivityAt) {
          patch.lastActivityAt = nextThread.lastActivityAt;
        }
        if ((previousThread.pinned ?? false) !== (nextThread.pinned ?? false)) {
          patch.pinned = nextThread.pinned === true;
        }
        if (previousThread.runChecklist !== nextThread.runChecklist) {
          patch.runChecklist = nextThread.runChecklist ?? null;
        }
        if (Object.keys(patch).length > 0) {
          contentPatchRef.current.set(nextThread.id, {
            ...contentPatchRef.current.get(nextThread.id),
            ...patch,
          });
          dirtyContentThreadsRef.current.add(nextThread.id);
        }
      }
      const messageThreadIds = new Set([
        ...previous.threadMessages.map((message) => message.threadId),
        ...content.threadMessages.map((message) => message.threadId),
      ]);
      for (const threadId of messageThreadIds) {
        const before = previous.threadMessages.filter((message) => message.threadId === threadId);
        const after = content.threadMessages.filter((message) => message.threadId === threadId);
        const beforeIds = new Set(before.map((message) => message.id));
        const afterIds = new Set(after.map((message) => message.id));
        const pendingDeletes = pendingDeleteMessageIdsRef.current.get(threadId) ?? new Set();
        let deletesChanged = false;
        for (const id of beforeIds) {
          if (!afterIds.has(id) && !pendingDeletes.has(id)) {
            pendingDeletes.add(id);
            deletesChanged = true;
          }
        }
        for (const id of afterIds) {
          if (pendingDeletes.delete(id)) deletesChanged = true;
        }
        if (pendingDeletes.size > 0) {
          pendingDeleteMessageIdsRef.current.set(threadId, pendingDeletes);
        } else if (deletesChanged) {
          pendingDeleteMessageIdsRef.current.delete(threadId);
        }
        if (
          before.length !== after.length ||
          before.some((message, index) => message !== after[index]) ||
          pendingDeletes.size > 0
        ) {
          dirtyContentThreadsRef.current.add(threadId);
        }
      }
      const workThreadIds = new Set([
        ...Object.keys(previous.threadWork),
        ...Object.keys(content.threadWork),
      ]);
      for (const threadId of workThreadIds) {
        if (previous.threadWork[threadId] !== content.threadWork[threadId]) {
          dirtyWorkThreadsRef.current.add(threadId);
        }
      }
      if (dirtyContentThreadsRef.current.size > 0 || dirtyWorkThreadsRef.current.size > 0) {
        scheduleContentFlush();
      }
    },
    [scheduleContentFlush],
  );

  useEffect(() => {
    mountedRef.current = true;
    const flushBeforeUnload = () => {
      void flushPendingContent().catch(() => {
        // Best-effort flush while the Main Window is closing.
      });
    };
    const disposeFlushRequest = appStateBridgeRef.current.onFlushRequest(() => {
      void flushPendingContent()
        .catch(() => {})
        .finally(() => {
          void appStateBridgeRef.current.flushDone();
        });
    });

    window.addEventListener("beforeunload", flushBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", flushBeforeUnload);
      disposeFlushRequest();
      flushBeforeUnload();
      mountedRef.current = false;
    };
  }, [flushPendingContent]);

  const createWorkspace = useCallback(
    async (value: string, projectDirectories: string[] = []): Promise<WorkspaceMutationResult> => {
      const validation = validateWorkspaceName(snapshot.workspaces, value);
      if (validation.error) return { ok: false, error: validation.error };

      const workspace: WorkspaceRecord = {
        id: `workspace-${crypto.randomUUID()}`,
        name: validation.name,
        order: snapshot.workspaces.length,
      };
      const projects: AppProjectRecord[] = [];
      const associations: WorkspaceProjectAssociationRecord[] = [];
      const seenDirectoryIdentities = new Set<string>();

      projectDirectories.forEach((value) => {
        const workingDirectory = normalizeProjectWorkingDirectory(value);
        if (!workingDirectory) return;
        const workingDirectoryIdentity = getProjectWorkingDirectoryIdentity(workingDirectory);
        if (seenDirectoryIdentities.has(workingDirectoryIdentity)) return;
        seenDirectoryIdentities.add(workingDirectoryIdentity);

        const existingProject = snapshot.projects.find(
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

      const created = await submitCommand("workspace:create", {
        workspace,
        projects,
        associations,
      });
      if (!created) return { ok: false, error: "Workspace could not be saved." };
      return { ok: true, workspace };
    },
    [snapshot, submitCommand],
  );

  const renameWorkspace = useCallback(
    async (workspaceId: string, value: string): Promise<WorkspaceMutationResult> => {
      const workspace = snapshot.workspaces.find((item) => item.id === workspaceId);
      if (!workspace) return { ok: false, error: "Workspace not found." };

      const validation = validateWorkspaceName(snapshot.workspaces, value, workspaceId);
      if (validation.error) return { ok: false, error: validation.error };

      const renamed = { ...workspace, name: validation.name };
      const saved = await submitCommand("workspace:rename", {
        workspaceId,
        name: validation.name,
      });
      if (!saved) return { ok: false, error: "Workspace could not be saved." };
      return { ok: true, workspace: renamed };
    },
    [snapshot, submitCommand],
  );

  const selectWorkspace = useCallback(
    async (workspaceId: string) => {
      if (workspaceId === snapshot.activeWorkspaceId) return false;
      if (!snapshot.workspaces.some((workspace) => workspace.id === workspaceId)) return false;

      return submitCommand("state:select-workspace", { workspaceId });
    },
    [snapshot, submitCommand],
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

      return submitCommand("state:remember-thread-location", { workspaceId, threadId });
    },
    [snapshot, submitCommand],
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

      const created = await submitCommand("project:add", {
        workspaceId,
        ...(existingProject ? { existingProjectId: existingProject.id } : {}),
        project,
        association,
      });
      if (!created) return { ok: false, error: "Project could not be saved." };
      return { ok: true, project, association, createdAssociation: true };
    },
    [snapshot, submitCommand],
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
        await window.carrent.projectDirectories.relocate({
          projectId,
          targetDirectory,
        });
        await window.carrent.terminal.closeProject(projectId);
        // The relocation transaction's committed snapshot reaches this window
        // through the authority broadcast.
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

      return submitCommand("project:set-alias", { workspaceId, projectId, alias });
    },
    [snapshot, submitCommand],
  );

  const renameSharedProject = useCallback(
    async (projectId: string, value: string) => {
      const name = value.trim();
      if (!name || !snapshot.projects.some((project) => project.id === projectId)) return false;
      return submitCommand("project:rename", { projectId, name });
    },
    [snapshot, submitCommand],
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

      return submitCommand("association:set-defaults", {
        workspaceId,
        projectId,
        defaults: {
          runtimeId: defaults.runtimeId,
          ...(runtimeModelId ? { runtimeModelId } : {}),
          runtimeMode: defaults.runtimeMode,
        },
      });
    },
    [snapshot, submitCommand],
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

      const result = await sendCommand("thread-draft:open", { workspaceId, projectId, draft });
      if (result.status !== "accepted") return null;
      await waitForRevision(result.revision);
      return (result.data as AssociationThreadDraftRecord | undefined) ?? null;
    },
    [snapshot, sendCommand, waitForRevision],
  );

  const updateThreadDraft = useCallback(
    async (draftId: string, draft: ThreadWorkDraftSnapshot | null) => {
      const current = snapshotRef.current;
      if (!(current.threadDrafts ?? []).some((item) => item.id === draftId)) return false;
      return submitCommand("thread-draft:update", { draftId, draft });
    },
    [submitCommand],
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
      return submitCommand("thread-draft:update-config", { draftId, config });
    },
    [submitCommand],
  );

  const discardThreadDraft = useCallback(
    async (draftId: string) => {
      const current = snapshotRef.current;
      if (!(current.threadDrafts ?? []).some((item) => item.id === draftId)) return false;
      return submitCommand("thread-draft:discard", { draftId });
    },
    [submitCommand],
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

      // No title field: the Main Process derives the promoted Thread's title
      // from `titleSource` and returns the authoritative record.
      const thread: Omit<AppThreadRecord, "title"> = {
        id: draft.threadId,
        workspaceId: draft.workspaceId,
        projectId: draft.projectId,
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
        localPathContexts: input.localPathContexts,
      };
      const assistantMessage: AppThreadMessageRecord = {
        id: input.assistantMessageId,
        threadId: draft.threadId,
        role: "assistant",
        content: "",
        createdAt: input.startedAt,
        attachments: [],
        runStatus: "running",
        runEventCount: 0,
      };
      const run: AppThreadRunRecord = {
        id: input.runId,
        threadId: draft.threadId,
        messageId: input.messageId,
        assistantMessageId: input.assistantMessageId,
        startedAt: input.startedAt,
        runtimeId: input.runtimeId,
        ...(input.runtimeModelId ? { runtimeModelId: input.runtimeModelId } : {}),
        runtimeMode: input.runtimeMode,
        planMode: input.planMode,
      };

      const result = await sendCommand("thread-draft:promote", {
        draftId: draft.id,
        threadId: draft.threadId,
        titleSource: input.titleSource,
        thread,
        message,
        assistantMessage,
        run,
      });
      if (result.status !== "accepted") return null;
      const data = result.data as { thread?: AppThreadRecord; created?: boolean } | undefined;
      // Another client promoted the draft first; this client must not send a
      // second initial message, so the promotion reads as failed here. The
      // broadcast converges every client on the one created Thread.
      if (data?.created !== true || !data.thread) return null;
      await waitForRevision(result.revision);
      return data.thread;
    },
    [sendCommand, waitForRevision],
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
      return submitCommand("thread:update-config", { threadId, config });
    },
    [submitCommand],
  );

  const rollbackThreadDraftPromotion = useCallback(
    async (draft: AssociationThreadDraftRecord) => {
      return submitCommand("thread-draft:rollback-promotion", { draft });
    },
    [submitCommand],
  );

  const recordThreadRun = useCallback(
    async (input: AppThreadRunStartInput & { threadId: string; assistantMessageId: string }) => {
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
      const assistantMessage: AppThreadMessageRecord = {
        id: input.assistantMessageId,
        threadId: input.threadId,
        role: "assistant",
        content: "",
        createdAt: input.startedAt,
        attachments: [],
        runStatus: "running",
        runEventCount: 0,
      };
      const run: AppThreadRunRecord = {
        id: input.runId,
        threadId: input.threadId,
        messageId: input.messageId,
        assistantMessageId: input.assistantMessageId,
        startedAt: input.startedAt,
        runtimeId: input.runtimeId,
        ...(input.runtimeModelId ? { runtimeModelId: input.runtimeModelId } : {}),
        runtimeMode: input.runtimeMode,
        planMode: input.planMode,
      };
      try {
        return await submitCommand("thread:record-run", {
          threadId: input.threadId,
          message,
          assistantMessage,
          run,
        });
      } finally {
        startingRunThreadIdsRef.current.delete(input.threadId);
      }
    },
    [submitCommand],
  );

  const rollbackThreadRun = useCallback(
    async (threadId: string, runId: string, messageId: string, assistantMessageId: string) => {
      return submitCommand("thread:rollback-run", {
        threadId,
        runId,
        messageId,
        assistantMessageId,
      });
    },
    [submitCommand],
  );

  const recordThreadAction = useCallback(
    async (action: AppThreadActionRecord) => {
      const current = snapshotRef.current;
      if (!(current.threads ?? []).some((thread) => thread.id === action.threadId)) {
        return false;
      }
      return submitCommand("thread:record-action", { action });
    },
    [submitCommand],
  );

  const archiveThread = useCallback(
    async (threadId: string) => {
      const current = snapshotRef.current;
      const thread = (current.threads ?? []).find((item) => item.id === threadId && !item.archived);
      // Live runs and queued messages are cleared by the caller before
      // archiving (see WorkspaceNavigationPane.handleArchive), so this no
      // longer guards on them — archiving is allowed mid-run.
      if (
        !thread ||
        mutatingThreadIdsRef.current.has(threadId) ||
        startingRunThreadIdsRef.current.has(threadId) ||
        hasActiveThreadActionForThread(threadId)
      ) {
        return false;
      }
      mutatingThreadIdsRef.current.add(threadId);

      try {
        return await submitCommand("thread:archive", { threadId });
      } finally {
        mutatingThreadIdsRef.current.delete(threadId);
      }
    },
    [submitCommand],
  );

  const restoreThread = useCallback(
    async (threadId: string) => {
      const current = snapshotRef.current;
      const thread = (current.threads ?? []).find((item) => item.id === threadId && item.archived);
      if (!thread || mutatingThreadIdsRef.current.has(threadId)) return false;
      mutatingThreadIdsRef.current.add(threadId);

      try {
        return await submitCommand("thread:restore", { threadId });
      } finally {
        mutatingThreadIdsRef.current.delete(threadId);
      }
    },
    [submitCommand],
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
        // The transaction commits and the authority adopts the committed
        // snapshot, broadcasting it to every window.
        await cleanup({ beforeAppState: current, afterAppState: next });
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
        // The deletion transaction persists the new snapshot; the authority
        // adopts it on commit and broadcasts to every window.
        await cleanup(affectedThreadIds, {
          beforeAppState: current,
          afterAppState: next,
          scope,
        });
        const remainingProjectIds = new Set(next.projects.map((project) => project.id));
        await Promise.all(
          current.projects
            .filter((project) => !remainingProjectIds.has(project.id))
            .map((project) => window.carrent.terminal.closeProject(project.id)),
        );
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

  const removeThreadSnapshot = useCallback(
    async (
      threadId: string,
      cleanup: (snapshots: ThreadDeletionAppStateSnapshots) => Promise<void>,
    ) => {
      const current = snapshotRef.current;
      if (
        !(current.threads ?? []).some((thread) => thread.id === threadId) ||
        mutatingThreadIdsRef.current.has(threadId)
      ) {
        return false;
      }
      mutatingThreadIdsRef.current.add(threadId);
      try {
        await cleanup({
          beforeAppState: current,
          afterAppState: applyThreadDeletionToAppState(current, [threadId]),
        });
        return true;
      } finally {
        mutatingThreadIdsRef.current.delete(threadId);
      }
    },
    [],
  );

  const updateSettings = useCallback(
    (settings: AppStateSettings) => submitCommand("settings:update", { settings }),
    [submitCommand],
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
        settings: snapshot.settings ?? DEFAULT_APP_STATE_SETTINGS,
        hasPersistedSettings: snapshot.settings !== undefined,
        updateSettings,
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
        removeThreadSnapshot,
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
