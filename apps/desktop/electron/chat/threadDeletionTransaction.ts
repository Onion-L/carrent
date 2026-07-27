import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  DeleteThreadDataRequest,
  ThreadDataDeletionReceipt,
  ThreadDeletionTransactionRequest,
} from "../../src/shared/chat";
import type {
  AppStateSnapshot,
  ProviderSessionSnapshot,
  WorkspaceSnapshot,
} from "../../src/shared/workspacePersistence";

export type ThreadDeletionJournal = {
  version: 1;
  operationId: string;
  phase: "preparing" | "committed";
  request: ThreadDeletionTransactionRequest;
  removedProviderSessions: Record<string, string>;
};

export type ThreadDeletionJournalStore = {
  load: () => Promise<ThreadDeletionJournal | null>;
  save: (journal: ThreadDeletionJournal) => Promise<void>;
  clear: () => Promise<void>;
};

type TransactionWorkspaceStore = {
  waitForWrites: () => Promise<void>;
  loadAppStateSnapshot: () => Promise<AppStateSnapshot | null>;
  loadWorkspaceSnapshot: () => Promise<WorkspaceSnapshot | null>;
  loadProviderSessions: () => Promise<ProviderSessionSnapshot>;
  saveProviderSessions: (snapshot: ProviderSessionSnapshot) => Promise<void>;
  saveAppStateSnapshot: (snapshot: AppStateSnapshot) => Promise<void>;
  saveWorkspaceSnapshot: (snapshot: WorkspaceSnapshot) => Promise<void>;
};

function removeThreadsFromAppState(
  snapshot: AppStateSnapshot,
  threadIds: string[],
): AppStateSnapshot {
  const ids = new Set(threadIds);
  return {
    ...snapshot,
    threads: snapshot.threads?.filter((thread) => !ids.has(thread.id)),
    threadDrafts: snapshot.threadDrafts?.filter((draft) => !ids.has(draft.threadId)),
    threadMessages: snapshot.threadMessages?.filter((message) => !ids.has(message.threadId)),
    threadRuns: snapshot.threadRuns?.filter((run) => !ids.has(run.threadId)),
    threadPromotionIntents: snapshot.threadPromotionIntents?.filter(
      (intent) => !ids.has(intent.threadId),
    ),
    lastThreadIdByWorkspace: snapshot.lastThreadIdByWorkspace
      ? Object.fromEntries(
          Object.entries(snapshot.lastThreadIdByWorkspace).filter(
            ([, threadId]) => !ids.has(threadId),
          ),
        )
      : undefined,
  };
}

function removeThreadsFromWorkspace(
  snapshot: WorkspaceSnapshot,
  threadIds: string[],
  fallbackActiveThreadId: string | null,
): WorkspaceSnapshot {
  const ids = new Set(threadIds);
  return {
    ...snapshot,
    projects: snapshot.projects.map((project) => ({
      ...project,
      threads: project.threads.filter((thread) => !ids.has(thread.id)),
    })),
    chats: snapshot.chats.filter((thread) => !ids.has(thread.id)),
    messages: snapshot.messages.filter((message) => !ids.has(message.threadId)),
    activeThreadId:
      snapshot.activeThreadId && ids.has(snapshot.activeThreadId)
        ? fallbackActiveThreadId
        : snapshot.activeThreadId,
    threadWork: snapshot.threadWork
      ? Object.fromEntries(
          Object.entries(snapshot.threadWork).filter(([threadId]) => !ids.has(threadId)),
        )
      : undefined,
  };
}

type TransactionAttachmentStore = {
  prepareDeletion: (operationId: string, storageKeys: string[]) => Promise<void>;
  commitDeletion: (operationId: string) => Promise<void>;
  rollbackDeletion: (operationId: string) => Promise<void>;
};

type TransactionSessionManager = {
  deleteThreadData: (request: DeleteThreadDataRequest) => Promise<ThreadDataDeletionReceipt | void>;
  rollbackThreadDataDeletion: (receipt: ThreadDataDeletionReceipt) => Promise<void>;
};

function removedProviderSessions(
  snapshot: ProviderSessionSnapshot,
  threadIds: string[],
): Record<string, string> {
  const suffixes = threadIds.map((threadId) => `:${threadId}`);
  return Object.fromEntries(
    Object.entries(snapshot.sessions).filter(([key]) =>
      suffixes.some((suffix) => key.endsWith(suffix)),
    ),
  );
}

async function retryTwice(operation: () => Promise<void>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await operation();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export function createThreadDeletionJournalStore(baseDir: string): ThreadDeletionJournalStore {
  const journalPath = join(baseDir, "thread-deletion-journal.json");

  return {
    async load() {
      try {
        return JSON.parse(await readFile(journalPath, "utf-8")) as ThreadDeletionJournal;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(journal) {
      await mkdir(baseDir, { recursive: true });
      const temporaryPath = `${journalPath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(temporaryPath, JSON.stringify(journal, null, 2), "utf-8");
      await rename(temporaryPath, journalPath);
    },
    async clear() {
      await rm(journalPath, { force: true });
    },
  };
}

async function restorePreparingTransaction(options: {
  journal: ThreadDeletionJournal;
  journalStore: ThreadDeletionJournalStore;
  workspaceStore: TransactionWorkspaceStore;
  attachmentStore: TransactionAttachmentStore;
}) {
  const rollbackErrors: unknown[] = [];
  const { journal } = options;
  const operations = [
    () => options.workspaceStore.saveAppStateSnapshot(journal.request.beforeAppState),
    () => options.workspaceStore.saveWorkspaceSnapshot(journal.request.beforeWorkspace),
    async () => {
      const current = await options.workspaceStore.loadProviderSessions();
      await options.workspaceStore.saveProviderSessions({
        version: 1,
        sessions: { ...current.sessions, ...journal.removedProviderSessions },
      });
    },
    () => options.attachmentStore.rollbackDeletion(journal.operationId),
  ];
  for (const operation of operations) {
    try {
      await retryTwice(operation);
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  if (rollbackErrors.length > 0) {
    throw new AggregateError(rollbackErrors, "Thread deletion recovery could not roll back.");
  }
  await options.journalStore.clear();
}

async function finishCommittedTransaction(options: {
  journal: ThreadDeletionJournal;
  journalStore: ThreadDeletionJournalStore;
  workspaceStore: TransactionWorkspaceStore;
  attachmentStore: TransactionAttachmentStore;
}) {
  const { journal } = options;
  await retryTwice(async () => {
    await options.attachmentStore.commitDeletion(journal.operationId);
    await options.journalStore.clear();
  });
}

export async function recoverThreadDeletionTransaction(options: {
  journalStore: ThreadDeletionJournalStore;
  workspaceStore: TransactionWorkspaceStore;
  attachmentStore: TransactionAttachmentStore;
}) {
  const journal = await options.journalStore.load();
  if (!journal) return;
  if (journal.phase === "committed") {
    await finishCommittedTransaction({ ...options, journal });
    return;
  }
  await restorePreparingTransaction({ ...options, journal });
}

export function createThreadDeletionTransactionManager(options: {
  journalStore: ThreadDeletionJournalStore;
  workspaceStore: TransactionWorkspaceStore;
  attachmentStore: TransactionAttachmentStore;
  sessionManager: TransactionSessionManager;
  createOperationId?: () => string;
  onCommitted?: (workspace: WorkspaceSnapshot) => void;
  onActiveChange?: (active: boolean) => void;
}) {
  let queue = Promise.resolve();

  const runExclusive = <T>(operation: () => Promise<T>) => {
    const result = queue.catch(() => {}).then(operation);
    queue = result.then(
      () => {},
      () => {},
    );
    return result;
  };

  return {
    deleteThread: (request: ThreadDeletionTransactionRequest) =>
      runExclusive(async () => {
        options.onActiveChange?.(true);
        let recoveryPending = false;
        try {
          await options.workspaceStore.waitForWrites();
          try {
            await recoverThreadDeletionTransaction(options);
          } catch (error) {
            recoveryPending = true;
            throw error;
          }
          if (await options.journalStore.load()) {
            recoveryPending = true;
            throw new Error("Previous Thread attachment cleanup is still pending.");
          }
          const beforeAppState = await options.workspaceStore.loadAppStateSnapshot();
          const beforeWorkspace = await options.workspaceStore.loadWorkspaceSnapshot();
          if (!beforeAppState || !beforeWorkspace) {
            throw new Error("Thread deletion requires persisted App State and workspace data.");
          }
          const transactionRequest: ThreadDeletionTransactionRequest = {
            ...request,
            beforeAppState,
            afterAppState: removeThreadsFromAppState(beforeAppState, request.threadData.threadIds),
            beforeWorkspace,
            afterWorkspace: removeThreadsFromWorkspace(
              beforeWorkspace,
              request.threadData.threadIds,
              request.afterWorkspace.activeThreadId,
            ),
          };
          const providerSnapshot = await options.workspaceStore.loadProviderSessions();
          const journal: ThreadDeletionJournal = {
            version: 1,
            operationId: options.createOperationId?.() ?? randomUUID(),
            phase: "preparing",
            request: transactionRequest,
            removedProviderSessions: removedProviderSessions(
              providerSnapshot,
              transactionRequest.threadData.threadIds,
            ),
          };
          await options.journalStore.save(journal);
          recoveryPending = true;

          let receipt: ThreadDataDeletionReceipt | null = null;
          try {
            await options.attachmentStore.prepareDeletion(
              journal.operationId,
              transactionRequest.threadData.attachmentStorageKeys,
            );
            const deletionReceipt = await options.sessionManager.deleteThreadData({
              ...transactionRequest.threadData,
              attachmentStorageKeys: [],
            });
            receipt = deletionReceipt ?? {
              threadIds: transactionRequest.threadData.threadIds,
              removedProviderSessions: journal.removedProviderSessions,
              detachedRuntimeSessions: {},
            };
            await options.workspaceStore.saveAppStateSnapshot(transactionRequest.afterAppState);
            await options.workspaceStore.saveWorkspaceSnapshot(transactionRequest.afterWorkspace);
            await options.journalStore.save({ ...journal, phase: "committed" });
            options.onCommitted?.(transactionRequest.afterWorkspace);
          } catch (error) {
            const rollbackErrors: unknown[] = [];
            const operations = [
              () => options.workspaceStore.saveAppStateSnapshot(transactionRequest.beforeAppState),
              () =>
                options.workspaceStore.saveWorkspaceSnapshot(transactionRequest.beforeWorkspace),
              ...(receipt
                ? [() => options.sessionManager.rollbackThreadDataDeletion(receipt!)]
                : []),
              () => options.attachmentStore.rollbackDeletion(journal.operationId),
            ];
            for (const operation of operations) {
              try {
                await retryTwice(operation);
              } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
              }
            }
            if (rollbackErrors.length > 0) {
              throw new AggregateError(
                [error, ...rollbackErrors],
                "Thread deletion failed and could not be fully rolled back.",
              );
            }
            await options.journalStore.clear();
            recoveryPending = false;
            throw error;
          }

          await finishCommittedTransaction({ ...options, journal });
          recoveryPending = false;
        } finally {
          if (!recoveryPending) {
            options.onActiveChange?.(false);
          }
        }
      }),
    waitForIdle: () => queue,
  };
}
