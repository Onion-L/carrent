import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import type {
  DeleteThreadDataRequest,
  ThreadDataDeletionReceipt,
  ThreadDataDeletionOptions,
  ThreadDeletionScope,
  ThreadDeletionTransactionRequest,
} from "../../src/shared/chat";
import { applyThreadDeletionToAppState } from "../../src/shared/chat";
import type {
  AppStateSnapshot,
  ProviderSessionSnapshot,
} from "../../src/shared/workspacePersistence";

export type ThreadDeletionJournal = {
  version: 1;
  operationId: string;
  phase: "preparing" | "committed";
  /**
   * Attachment storage keys staged for deletion, so recovery can finish or roll
   * back the file phase. Requirement: the journal records only the operation,
   * target attachments, and file phase — not full before/after App State
   * Snapshots or Runtime Session content.
   */
  attachmentStorageKeys: string[];
  /**
   * Carried only by the JSON-era full-snapshot path so its recovery can restore
   * the pre-deletion snapshot and Runtime Sessions. The SQLite row-level path
   * omits these: the database transaction is authoritative, so a `preparing`
   * journal means the deletion rolled back and recovery only restores staged
   * attachment files.
   */
  request?: ThreadDeletionTransactionRequest;
  removedProviderSessions?: Record<string, string>;
};

export type ThreadDeletionJournalStore = {
  load: () => Promise<ThreadDeletionJournal | null>;
  save: (journal: ThreadDeletionJournal) => Promise<void>;
  clear: () => Promise<void>;
};

type TransactionAppStateStore = {
  waitForWrites: () => Promise<void>;
  loadAppStateSnapshot: () => Promise<AppStateSnapshot | null>;
  loadProviderSessions: () => Promise<ProviderSessionSnapshot>;
  saveProviderSessions: (snapshot: ProviderSessionSnapshot) => Promise<void>;
  saveAppStateSnapshot: (snapshot: AppStateSnapshot) => Promise<void>;
  /**
   * Optional row-level deletion (SQLite path). When present, the manager deletes
   * Thread-owned rows inside one database transaction instead of replacing the
   * full App State Snapshot, and uses the returned mappings for rollback.
   */
  deleteAppStateForThreads?: (
    operationId: string,
    threadIds: string[],
    scope?: ThreadDeletionScope,
    onCommitted?: (removedProviderSessions: Record<string, string>) => void,
  ) => Promise<{ removedProviderSessions: Record<string, string> }>;
  hasCommittedThreadDeletion?: (operationId: string) => Promise<boolean>;
  clearCommittedThreadDeletionMarker?: (operationId: string) => Promise<void>;
};

type TransactionAttachmentStore = {
  prepareDeletion: (operationId: string, storageKeys: string[]) => Promise<void>;
  commitDeletion: (operationId: string) => Promise<void>;
  rollbackDeletion: (operationId: string) => Promise<void>;
};

type TransactionSessionManager = {
  deleteThreadData: (
    request: DeleteThreadDataRequest,
    options?: ThreadDataDeletionOptions,
  ) => Promise<ThreadDataDeletionReceipt | void>;
  rollbackThreadDataDeletion: (receipt: ThreadDataDeletionReceipt) => Promise<void>;
  adoptCommittedProviderSessionDeletion?: (removedSessions: Record<string, string>) => void;
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

function collectScopedThreadIds(
  snapshot: AppStateSnapshot,
  requestedThreadIds: string[],
  scope?: ThreadDeletionScope,
): string[] {
  const ids = new Set(requestedThreadIds);
  if (scope?.kind === "association") {
    for (const thread of snapshot.threads ?? []) {
      if (thread.workspaceId === scope.workspaceId && thread.projectId === scope.projectId) {
        ids.add(thread.id);
      }
    }
  } else if (scope?.kind === "workspace") {
    for (const thread of snapshot.threads ?? []) {
      if (thread.workspaceId === scope.workspaceId) ids.add(thread.id);
    }
  }
  return [...ids];
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
  appStateStore: TransactionAppStateStore;
  attachmentStore: TransactionAttachmentStore;
}) {
  const rollbackErrors: unknown[] = [];
  const { journal } = options;
  // The JSON-era full-snapshot path carried the pre-deletion snapshot and
  // removed Provider Sessions in the journal so recovery can restore them. The
  // SQLite row-level path omits them: a `preparing` journal means the database
  // deletion rolled back, so recovery only needs to restore the staged
  // attachment files — the relational rows and Runtime Sessions are intact.
  const operations: Array<() => Promise<void>> = [];
  if (journal.request) {
    operations.push(() =>
      options.appStateStore.saveAppStateSnapshot(journal.request!.beforeAppState),
    );
    if (journal.removedProviderSessions) {
      operations.push(async () => {
        const current = await options.appStateStore.loadProviderSessions();
        await options.appStateStore.saveProviderSessions({
          version: 1,
          sessions: { ...current.sessions, ...journal.removedProviderSessions! },
        });
      });
    }
  }
  operations.push(() => options.attachmentStore.rollbackDeletion(journal.operationId));
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
  appStateStore: TransactionAppStateStore;
  attachmentStore: TransactionAttachmentStore;
}) {
  const { journal } = options;
  await retryTwice(async () => {
    await options.attachmentStore.commitDeletion(journal.operationId);
    await options.appStateStore.clearCommittedThreadDeletionMarker?.(journal.operationId);
    await options.journalStore.clear();
  });
}

export async function recoverThreadDeletionTransaction(options: {
  journalStore: ThreadDeletionJournalStore;
  appStateStore: TransactionAppStateStore;
  attachmentStore: TransactionAttachmentStore;
}) {
  const journal = await options.journalStore.load();
  if (!journal) return;
  const databaseCommitted =
    journal.phase === "committed" ||
    (options.appStateStore.hasCommittedThreadDeletion
      ? await options.appStateStore.hasCommittedThreadDeletion(journal.operationId)
      : false);
  if (databaseCommitted) {
    await finishCommittedTransaction({ ...options, journal });
    return;
  }
  await restorePreparingTransaction({ ...options, journal });
}

export function createThreadDeletionTransactionManager(options: {
  journalStore: ThreadDeletionJournalStore;
  appStateStore: TransactionAppStateStore;
  attachmentStore: TransactionAttachmentStore;
  sessionManager: TransactionSessionManager;
  createOperationId?: () => string;
  onActiveChange?: (active: boolean) => void;
  onSnapshotCommitted?: (snapshot: AppStateSnapshot) => void;
  onThreadsDeleted?: (threadIds: string[]) => void;
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
          await options.appStateStore.waitForWrites();
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
          const beforeAppState = await options.appStateStore.loadAppStateSnapshot();
          if (!beforeAppState) {
            throw new Error("Thread deletion requires persisted App State.");
          }
          const threadIds = collectScopedThreadIds(
            beforeAppState,
            request.threadData.threadIds,
            request.scope,
          );
          const afterAppState = applyThreadDeletionToAppState(
            beforeAppState,
            threadIds,
            request.scope,
          );
          const transactionRequest: ThreadDeletionTransactionRequest = {
            ...request,
            beforeAppState,
            afterAppState,
            threadData: { ...request.threadData, threadIds },
          };
          const deleteAppStateForThreads = options.appStateStore.deleteAppStateForThreads;
          if (
            deleteAppStateForThreads &&
            (!options.appStateStore.hasCommittedThreadDeletion ||
              !options.appStateStore.clearCommittedThreadDeletionMarker ||
              !options.sessionManager.adoptCommittedProviderSessionDeletion)
          ) {
            throw new Error("SQLite Thread deletion coordination is unavailable.");
          }
          // The SQLite row-level path writes a slim journal (operation, target
          // attachments, file phase) because the database transaction is
          // authoritative; the JSON-era full-snapshot path still carries the
          // before/after snapshot and removed sessions for its own recovery.
          const providerSnapshot = deleteAppStateForThreads
            ? null
            : await options.appStateStore.loadProviderSessions();
          const journal: ThreadDeletionJournal = {
            version: 1,
            operationId: options.createOperationId?.() ?? randomUUID(),
            phase: "preparing",
            attachmentStorageKeys: transactionRequest.threadData.attachmentStorageKeys,
            ...(deleteAppStateForThreads
              ? {}
              : {
                  request: transactionRequest,
                  removedProviderSessions: removedProviderSessions(
                    providerSnapshot!,
                    transactionRequest.threadData.threadIds,
                  ),
                }),
          };
          await options.journalStore.save(journal);
          recoveryPending = true;

          let receipt: ThreadDataDeletionReceipt | null = null;
          try {
            await options.attachmentStore.prepareDeletion(
              journal.operationId,
              transactionRequest.threadData.attachmentStorageKeys,
            );
            const deletionReceipt =
              transactionRequest.threadData.threadIds.length > 0
                ? await options.sessionManager.deleteThreadData(
                    {
                      ...transactionRequest.threadData,
                      attachmentStorageKeys: [],
                    },
                    deleteAppStateForThreads ? { deferProviderSessionDeletion: true } : undefined,
                  )
                : undefined;
            receipt = deletionReceipt ?? {
              threadIds: transactionRequest.threadData.threadIds,
              removedProviderSessions: journal.removedProviderSessions ?? {},
              detachedRuntimeSessions: {},
            };
            if (deleteAppStateForThreads) {
              // Row-level: delete the Thread-owned rows in one database
              // transaction. The transaction owns the whole relational deletion,
              // so a failure rolls back every deleted row and leaves the
              // pre-deletion state authoritative; the catch below restores the
              // staged attachments and Runtime Sessions.
              await deleteAppStateForThreads(
                journal.operationId,
                transactionRequest.threadData.threadIds,
                request.scope,
                (removedSessions) =>
                  options.sessionManager.adoptCommittedProviderSessionDeletion!(removedSessions),
              );
              try {
                options.onSnapshotCommitted?.(transactionRequest.afterAppState);
              } catch {
                // The in-memory authority can reload the committed database state.
              }
            } else {
              await options.appStateStore.saveAppStateSnapshot(transactionRequest.afterAppState);
              options.onSnapshotCommitted?.(transactionRequest.afterAppState);
              await options.journalStore.save({ ...journal, phase: "committed" });
            }
          } catch (error) {
            const rollbackErrors: unknown[] = [];
            const operations: Array<() => Promise<void>> = [];
            if (!deleteAppStateForThreads) {
              operations.push(() =>
                options.appStateStore.saveAppStateSnapshot(transactionRequest.beforeAppState),
              );
            }
            if (receipt) {
              operations.push(() => options.sessionManager.rollbackThreadDataDeletion(receipt!));
            }
            operations.push(() => options.attachmentStore.rollbackDeletion(journal.operationId));
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

          if (deleteAppStateForThreads) {
            try {
              await options.journalStore.save({ ...journal, phase: "committed" });
            } catch {
              // The database operation marker is authoritative. A preparing
              // file journal is therefore safely completed during recovery.
            }
          }

          try {
            options.onThreadsDeleted?.(transactionRequest.threadData.threadIds);
          } catch {
            // In-memory cleanup cannot roll back an already committed deletion.
          }

          try {
            await finishCommittedTransaction({ ...options, journal });
            recoveryPending = false;
          } catch {
            // The snapshots are committed. Keep the journal for cleanup retry,
            // but release the transaction lock so normal writes can continue.
            recoveryPending = false;
          }
        } finally {
          if (!recoveryPending) {
            options.onActiveChange?.(false);
          }
        }
      }),
    waitForIdle: () => queue,
  };
}
